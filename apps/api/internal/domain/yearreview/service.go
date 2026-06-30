// Package yearreview contains the domain logic for Milestone 9's annual review:
// collecting a user's yearly medals, stage summaries and growth profile
// snapshot, asking Agent for a structured long narrative, and persisting it.
// Transport-agnostic so the HTTP handler (manual) and worker (scheduled) share
// one code path.
package yearreview

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

const (
	// medalSelectLimit caps how many medals we feed to the Agent. We pick the
	// heaviest memories first so the narrative reflects what mattered most.
	medalSelectLimit = 20
	stageSelectLimit = 12
)

// ErrNoData is returned when the year has no medals and no stage summaries.
// Callers treat this as a benign skip, not a failure.
var ErrNoData = errors.New("no data for year review")

// ErrAlreadyExists is returned when a review already exists for the year.
var ErrAlreadyExists = errors.New("year review already exists")

type Service struct {
	db          *gorm.DB
	agentClient *agent.Client
	logger      *slog.Logger
}

func NewService(db *gorm.DB, agentClient *agent.Client, logger *slog.Logger) *Service {
	return &Service{db: db, agentClient: agentClient, logger: logger}
}

type GenerateInput struct {
	UserID  string
	Year    int
	Trigger string // "manual" | "scheduled" | "year_end"
}

// Generate produces an annual review for the given user and year. It is
// idempotent: if a review already exists it returns ErrAlreadyExists.
func (s *Service) Generate(ctx context.Context, in GenerateInput) (*database.AnnualReview, error) {
	if in.UserID == "" {
		return nil, fmt.Errorf("user_id is required")
	}
	if in.Year < 2020 || in.Year > 2100 {
		return nil, fmt.Errorf("year must be between 2020 and 2100")
	}
	if in.Trigger == "" {
		in.Trigger = "manual"
	}

	// Idempotency guard.
	var existing database.AnnualReview
	err := s.db.Where("user_id = ? AND year = ?", in.UserID, in.Year).First(&existing).Error
	if err == nil {
		return nil, ErrAlreadyExists
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("check existing year review: %w", err)
	}

	// Collect signals.
	medals, err := s.loadMedals(in.UserID, in.Year)
	if err != nil {
		return nil, err
	}
	stages, err := s.loadStageSummaries(in.UserID, in.Year)
	if err != nil {
		return nil, err
	}
	if len(medals) == 0 && len(stages) == 0 {
		return nil, ErrNoData
	}

	experienceCount, err := s.countExperiences(in.UserID, in.Year)
	if err != nil {
		s.logger.Warn("failed to count experiences for year review", "error", err, "user_id", in.UserID)
	}

	growthSnapshot := s.loadGrowthSnapshot(in.UserID)

	// Call Agent.
	agentResp, err := s.agentClient.GenerateYearReview(ctx, &agent.GenerateYearReviewRequest{
		Year:           in.Year,
		Medals:         medals,
		StageSummaries: stages,
		GrowthProfile:  growthSnapshot,
		Stats: agent.YearReviewStats{
			MedalCount:        len(medals),
			ExperienceCount:   experienceCount,
			StageSummaryCount: len(stages),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("agent year review: %w", err)
	}

	review := database.AnnualReview{
		UserID:               in.UserID,
		Year:                 in.Year,
		Status:               "completed",
		Title:                agentResp.Title,
		Narrative:            agentResp.Narrative,
		AnnualThemesJSON:     marshalJSON(agentResp.AnnualThemes),
		MilestoneMedalsJSON:  marshalJSON(agentResp.MilestoneMedals),
		GrowthArcJSON:        marshalJSON(agentResp.GrowthArc),
		EmotionArcJSON:       marshalJSON(agentResp.EmotionArc),
		KeywordEvolutionJSON: marshalJSON(agentResp.KeywordEvolution),
		MedalCount:           len(medals),
		StageSummaryCount:    len(stages),
		ExperienceCount:      experienceCount,
		GeneratedBy:          "agent",
		Trigger:              in.Trigger,
	}

	txErr := s.db.Transaction(func(tx *gorm.DB) error {
		// Re-check inside transaction to close the race.
		var dup database.AnnualReview
		dupErr := tx.Where("user_id = ? AND year = ?", in.UserID, in.Year).First(&dup).Error
		if dupErr == nil {
			review = dup
			return nil
		}
		if !errors.Is(dupErr, gorm.ErrRecordNotFound) {
			return dupErr
		}
		return tx.Create(&review).Error
	})
	if txErr != nil {
		return nil, fmt.Errorf("persist year review: %w", txErr)
	}

	// Best-effort notification and growth insight.
	s.notify(in.UserID, &review)
	s.writeYearInsight(in.UserID, in.Trigger, agentResp)

	return &review, nil
}

// loadMedals collects the user's medals for the year, preferring heavy
// memories, and joins medal_versions for richer context.
func (s *Service) loadMedals(userID string, year int) ([]agent.YearMedalItem, error) {
	yearStart := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	yearEnd := yearStart.AddDate(1, 0, 0)

	type row struct {
		ID           string
		Title        string
		ShortReason  string
		MemoryWeight string
		CreatedAt    time.Time
		MeaningFocus *string
		Story        *string
	}
	var rows []row
	if err := s.db.Table("medals").
		Select(`medals.id, medals.title, medals.short_reason, medals.memory_weight, medals.created_at,
			medal_versions.meaning_focus, medal_versions.story`).
		Joins("LEFT JOIN medal_versions ON medal_versions.id = medals.current_version_id").
		Where("medals.user_id = ? AND medals.created_at >= ? AND medals.created_at < ?", userID, yearStart, yearEnd).
		Order("medals.memory_weight DESC, medals.created_at ASC").
		Limit(medalSelectLimit).
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("load medals for year review: %w", err)
	}

	items := make([]agent.YearMedalItem, 0, len(rows))
	for _, r := range rows {
		item := agent.YearMedalItem{
			ID:           r.ID,
			Title:        r.Title,
			ShortReason:  r.ShortReason,
			MemoryWeight: r.MemoryWeight,
			CreatedAt:    r.CreatedAt.Format("2006-01-02"),
		}
		if r.MeaningFocus != nil {
			item.MeaningFocus = *r.MeaningFocus
		}
		if r.Story != nil {
			item.Story = *r.Story
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *Service) loadStageSummaries(userID string, year int) ([]agent.YearStageItem, error) {
	yearStart := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	yearEnd := yearStart.AddDate(1, 0, 0)

	var rows []database.StageSummary
	if err := s.db.Where("user_id = ? AND status = ? AND period_start >= ? AND period_start < ?", userID, "completed", yearStart, yearEnd).
		Order("period_start ASC").
		Limit(stageSelectLimit).
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load stage summaries for year review: %w", err)
	}

	items := make([]agent.YearStageItem, 0, len(rows))
	for _, r := range rows {
		item := agent.YearStageItem{
			PeriodType:  r.PeriodType,
			PeriodStart: r.PeriodStart.Format("2006-01-02"),
			Title:       r.Title,
			Summary:     r.SummaryText,
		}
		if r.Story != nil {
			item.Story = *r.Story
		}
		if r.HighlightsJSON != nil {
			item.Highlights = stringArrayFromJSON(r.HighlightsJSON)
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *Service) countExperiences(userID string, year int) (int, error) {
	yearStart := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	yearEnd := yearStart.AddDate(1, 0, 0)
	var count int64
	if err := s.db.Model(&database.Experience{}).
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, yearStart, yearEnd).
		Count(&count).Error; err != nil {
		return 0, err
	}
	return int(count), nil
}

func (s *Service) loadGrowthSnapshot(userID string) *agent.GrowthProfileSnapshot {
	var profile database.GrowthProfile
	if err := s.db.Where("user_id = ?", userID).First(&profile).Error; err != nil {
		return nil
	}
	snapshot := &agent.GrowthProfileSnapshot{}
	if profile.TraitKeywordsJSON != nil {
		snapshot.TraitKeywords = stringArrayFromJSON(profile.TraitKeywordsJSON)
	}
	if profile.GrowthKeywordsJSON != nil {
		snapshot.GrowthKeywords = stringArrayFromJSON(profile.GrowthKeywordsJSON)
	}
	if profile.SummaryText != nil {
		snapshot.SummaryText = *profile.SummaryText
	}
	return snapshot
}

func (s *Service) notify(userID string, review *database.AnnualReview) {
	body := fmt.Sprintf("%d 年度回顾已生成：%s", review.Year, review.Title)
	dataMap := map[string]string{"year": fmt.Sprintf("%d", review.Year)}
	dataBytes, _ := json.Marshal(dataMap)
	dataStr := string(dataBytes)

	n := database.Notification{
		UserID: userID,
		Type:   "year_review",
		Title:  "年度回顾已生成",
		Body:   &body,
		Data:   &dataStr,
	}
	if err := s.db.Create(&n).Error; err != nil {
		s.logger.Error("failed to write year review notification", "error", err, "user_id", userID)
	}
}

// writeYearInsight writes a period_type=year growth insight so the growth
// profile system can pick up the annual signal on the next refresh.
func (s *Service) writeYearInsight(userID, trigger string, resp *agent.GenerateYearReviewResponse) {
	title := fmt.Sprintf("年度回顾：%s", resp.Title)
	keywords := resp.AnnualThemes
	signals := map[string]interface{}{
		"year":           resp.Title,
		"themes":         resp.AnnualThemes,
		"milestoneCount": len(resp.MilestoneMedals),
	}
	record := database.GrowthInsight{
		UserID:       userID,
		PeriodType:   "year",
		Title:        title,
		SummaryText:  truncate(resp.Narrative, 500),
		KeywordsJSON: marshalJSON(keywords),
		SignalsJSON:  marshalJSON(signals),
		GeneratedBy:  "agent",
		Trigger:      trigger,
	}
	if err := s.db.Create(&record).Error; err != nil {
		s.logger.Error("failed to write year insight", "error", err, "user_id", userID)
	}
}

// Delete removes an annual review so the user can regenerate it.
func (s *Service) Delete(userID string, year int) error {
	result := s.db.Where("user_id = ? AND year = ?", userID, year).Delete(&database.AnnualReview{})
	if result.Error != nil {
		return fmt.Errorf("delete year review: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// --- helpers ---

func marshalJSON(v interface{}) *string {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	s := string(b)
	return &s
}

func stringArrayFromJSON(raw *string) []string {
	if raw == nil {
		return nil
	}
	var items []string
	if err := json.Unmarshal([]byte(*raw), &items); err != nil {
		return nil
	}
	return items
}

func truncate(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "…"
}
