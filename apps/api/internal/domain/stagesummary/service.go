// Package stagesummary contains the domain logic for Milestone 7's 阶段性产出:
// rolling a window of a user's experiences into a periodic summary and an
// optional "stage medal". It is deliberately transport-agnostic so the HTTP
// handler (manual trigger) and the worker (scheduled trigger) share one code
// path and one set of invariants.
package stagesummary

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/integrations/agent"
	"gorm.io/gorm"
)

// PeriodType enumerates the supported roll-up windows.
type PeriodType string

const (
	PeriodWeek  PeriodType = "week"
	PeriodMonth PeriodType = "month"
)

// Valid reports whether p is a supported period type.
func (p PeriodType) Valid() bool {
	return p == PeriodWeek || p == PeriodMonth
}

// label returns the Chinese hint passed to the Agent for framing.
func (p PeriodType) label() string {
	if p == PeriodMonth {
		return "本月"
	}
	return "本周"
}

// ErrNoExperiences is returned when a window contains no completed experiences
// worth summarizing. Callers (especially the scheduler) treat this as a benign
// skip rather than a failure.
var ErrNoExperiences = errors.New("no experiences in period")

// Service generates and persists stage summaries.
type Service struct {
	db          *gorm.DB
	agentClient *agent.Client
	logger      *slog.Logger
}

func NewService(db *gorm.DB, agentClient *agent.Client, logger *slog.Logger) *Service {
	return &Service{db: db, agentClient: agentClient, logger: logger}
}

// PeriodBounds returns the [start, end) window for the period containing the
// reference time t. Weeks start on Monday 00:00; months on the 1st 00:00. All
// computation is done in t's location.
func PeriodBounds(p PeriodType, t time.Time) (start, end time.Time) {
	if p == PeriodMonth {
		start = time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location())
		end = start.AddDate(0, 1, 0)
		return start, end
	}
	// Week: roll back to Monday.
	weekday := int(t.Weekday()) // Sunday=0..Saturday=6
	offset := (weekday + 6) % 7 // days since Monday
	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	start = day.AddDate(0, 0, -offset)
	end = start.AddDate(0, 0, 7)
	return start, end
}

// GenerateInput parameterizes a single stage-summary generation.
type GenerateInput struct {
	UserID       string
	Period       PeriodType
	PeriodStart  time.Time
	PeriodEnd    time.Time
	Trigger      string // "manual" | "scheduled"
	AgentRuntime *agent.AgentRuntimePayload
}

// Generate produces a stage summary for the given user and window. It is
// idempotent: if a summary already exists for (user, period_type, period_start)
// the existing row is returned untouched. When the window has no experiences it
// returns ErrNoExperiences and persists nothing.
//
// On success it writes the StageSummary and a best-effort in-app notification.
func (s *Service) Generate(ctx context.Context, in GenerateInput) (*database.StageSummary, error) {
	if !in.Period.Valid() {
		return nil, fmt.Errorf("invalid period type %q", in.Period)
	}
	if in.Trigger == "" {
		in.Trigger = "manual"
	}

	// Idempotency guard: return any existing summary for this exact window.
	var existing database.StageSummary
	err := s.db.Where(
		"user_id = ? AND period_type = ? AND period_start = ?",
		in.UserID, string(in.Period), in.PeriodStart,
	).First(&existing).Error
	if err == nil {
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("check existing stage summary: %w", err)
	}

	// Collect the user's experiences in [start, end). We summarize experiences
	// that have a summary (collected enough to be meaningful) and fall back to
	// the title otherwise.
	var experiences []database.Experience
	if err := s.db.Where(
		"user_id = ? AND created_at >= ? AND created_at < ?",
		in.UserID, in.PeriodStart, in.PeriodEnd,
	).Order("created_at ASC").Find(&experiences).Error; err != nil {
		return nil, fmt.Errorf("load experiences: %w", err)
	}

	items := make([]agent.StageExperienceItem, 0, len(experiences))
	for i := range experiences {
		exp := &experiences[i]
		item := agent.StageExperienceItem{}
		if exp.Title != nil {
			item.Title = *exp.Title
		}
		if exp.Summary != nil {
			item.Summary = *exp.Summary
		}
		if exp.OccurredAt != nil {
			item.OccurredAt = exp.OccurredAt.Format("2006-01-02")
		}
		// Skip entirely empty experiences (no title and no summary).
		if item.Title == "" && item.Summary == "" {
			continue
		}
		items = append(items, item)
	}

	if len(items) == 0 {
		return nil, ErrNoExperiences
	}

	// Call the Agent to produce the roll-up.
	agentResp, err := s.agentClient.GenerateStageSummary(ctx, &agent.GenerateStageSummaryRequest{
		PeriodLabel:  in.Period.label(),
		Experiences:  items,
		AgentRuntime: in.AgentRuntime,
	})
	if err != nil {
		return nil, fmt.Errorf("agent stage summary: %w", err)
	}

	memoryWeight := normalizeWeight(agentResp.MemoryWeight)
	highlightsJSON := marshalHighlights(agentResp.Highlights)
	story := agentResp.Story

	summary := database.StageSummary{
		UserID:          in.UserID,
		PeriodType:      string(in.Period),
		PeriodStart:     in.PeriodStart,
		PeriodEnd:       in.PeriodEnd,
		Status:          "completed",
		Title:           agentResp.Title,
		SummaryText:     agentResp.Summary,
		Story:           &story,
		MemoryWeight:    memoryWeight,
		HighlightsJSON:  highlightsJSON,
		ExperienceCount: len(items),
		GeneratedBy:     "agent",
		Trigger:         in.Trigger,
	}

	txErr := s.db.Transaction(func(tx *gorm.DB) error {
		// Re-check inside the transaction to close the race between two
		// concurrent triggers (manual + scheduled) for the same window. The
		// unique index on (user_id, period_type, period_start) is the ultimate
		// guard; this just turns a would-be constraint error into a clean return.
		var dup database.StageSummary
		dupErr := tx.Where(
			"user_id = ? AND period_type = ? AND period_start = ?",
			in.UserID, string(in.Period), in.PeriodStart,
		).First(&dup).Error
		if dupErr == nil {
			summary = dup
			return nil
		}
		if !errors.Is(dupErr, gorm.ErrRecordNotFound) {
			return dupErr
		}

		return tx.Create(&summary).Error
	})
	if txErr != nil {
		return nil, fmt.Errorf("persist stage summary: %w", txErr)
	}

	// Best-effort notification — never fail generation because of it.
	s.notify(in.UserID, &summary)

	return &summary, nil
}

func (s *Service) notify(userID string, summary *database.StageSummary) {
	periodLabel := "本周"
	if summary.PeriodType == string(PeriodMonth) {
		periodLabel = "本月"
	}
	body := fmt.Sprintf("%s阶段回顾已生成：%s", periodLabel, summary.Title)
	dataMap := map[string]string{"stage_summary_id": summary.ID, "period_type": summary.PeriodType}
	dataBytes, _ := json.Marshal(dataMap)
	dataStr := string(dataBytes)

	n := database.Notification{
		UserID: userID,
		Type:   "stage_summary",
		Title:  "新的阶段回顾",
		Body:   &body,
		Data:   &dataStr,
	}
	if err := s.db.Create(&n).Error; err != nil {
		s.logger.Error("failed to write stage summary notification", "error", err, "user_id", userID)
	}
}

func normalizeWeight(w string) string {
	switch w {
	case "light", "medium", "heavy":
		return w
	default:
		return "medium"
	}
}

func marshalHighlights(highlights []string) *string {
	if len(highlights) == 0 {
		return nil
	}
	b, err := json.Marshal(highlights)
	if err != nil {
		return nil
	}
	s := string(b)
	return &s
}
