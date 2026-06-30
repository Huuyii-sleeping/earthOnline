// Package growthprofile contains the domain logic for Milestone 8's long-term
// growth portrait: collecting the user's medals/stage summaries, asking Agent
// for a structured profile, and persisting profile + insight records.
package growthprofile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/integrations/agent"
	"gorm.io/gorm"
)

const (
	defaultMedalLimit = 50
	defaultStageLimit = 12
)

var ErrNoSignals = errors.New("no growth profile signals")

type Service struct {
	db          *gorm.DB
	agentClient *agent.Client
	logger      *slog.Logger
}

func NewService(db *gorm.DB, agentClient *agent.Client, logger *slog.Logger) *Service {
	return &Service{db: db, agentClient: agentClient, logger: logger}
}

type RefreshInput struct {
	UserID  string
	Scope   string
	Trigger string
}

func (s *Service) Refresh(ctx context.Context, in RefreshInput) (*database.GrowthProfile, error) {
	if in.UserID == "" {
		return nil, fmt.Errorf("user_id is required")
	}
	if in.Scope == "" {
		in.Scope = "all"
	}
	if in.Trigger == "" {
		in.Trigger = "manual"
	}

	medals, err := s.loadMedalSignals(in.UserID)
	if err != nil {
		return nil, err
	}
	stages, err := s.loadStageSignals(in.UserID)
	if err != nil {
		return nil, err
	}
	if len(medals) == 0 && len(stages) == 0 {
		return nil, ErrNoSignals
	}

	agentResp, err := s.agentClient.GenerateGrowthProfile(ctx, &agent.GenerateGrowthProfileRequest{
		Medals:         medals,
		StageSummaries: stages,
	})
	if err != nil {
		return nil, fmt.Errorf("agent growth profile: %w", err)
	}

	now := time.Now()
	sourceCounts := map[string]int{"medals": len(medals), "stage_summaries": len(stages)}
	profile := database.GrowthProfile{
		UserID:              in.UserID,
		TraitKeywordsJSON:   marshalJSON(agentResp.TraitKeywords),
		GrowthKeywordsJSON:  marshalJSON(agentResp.GrowthKeywords),
		ExperienceTypesJSON: marshalJSON(agentResp.ExperienceTypes),
		EmotionTrendsJSON:   marshalJSON(agentResp.EmotionTrends),
		SummaryText:         stringPtr(agentResp.Summary),
		SourceCountsJSON:    marshalJSON(sourceCounts),
		LastRefreshedAt:     &now,
	}

	txErr := s.db.Transaction(func(tx *gorm.DB) error {
		var existing database.GrowthProfile
		err := tx.Where("user_id = ?", in.UserID).First(&existing).Error
		switch {
		case err == nil:
			if updateErr := tx.Model(&existing).Updates(map[string]interface{}{
				"trait_keywords_json":   profile.TraitKeywordsJSON,
				"growth_keywords_json":  profile.GrowthKeywordsJSON,
				"experience_types_json": profile.ExperienceTypesJSON,
				"emotion_trends_json":   profile.EmotionTrendsJSON,
				"summary_text":          profile.SummaryText,
				"source_counts_json":    profile.SourceCountsJSON,
				"last_refreshed_at":     profile.LastRefreshedAt,
			}).Error; updateErr != nil {
				return updateErr
			}
			profile = existing
			if reloadErr := tx.First(&profile, "id = ?", existing.ID).Error; reloadErr != nil {
				return reloadErr
			}
		case errors.Is(err, gorm.ErrRecordNotFound):
			if createErr := tx.Create(&profile).Error; createErr != nil {
				return createErr
			}
		default:
			return err
		}

		return s.createInsights(tx, in.UserID, in.Trigger, agentResp)
	})
	if txErr != nil {
		return nil, fmt.Errorf("persist growth profile: %w", txErr)
	}

	return &profile, nil
}

func (s *Service) loadMedalSignals(userID string) ([]agent.GrowthMedalItem, error) {
	type row struct {
		ID           string
		ExperienceID string
		Title        string
		ShortReason  string
		MemoryWeight string
		CreatedAt    time.Time
		MeaningFocus *string
		Story        *string
		Experience   *string
		OccurredAt   *time.Time
	}
	var rows []row
	if err := s.db.Table("medals").
		Select(`medals.id, medals.experience_id, medals.title, medals.short_reason, medals.memory_weight, medals.created_at,
			medal_versions.meaning_focus, medal_versions.story, experiences.summary AS experience, experiences.occurred_at`).
		Joins("LEFT JOIN medal_versions ON medal_versions.id = medals.current_version_id").
		Joins("LEFT JOIN experiences ON experiences.id = medals.experience_id").
		Where("medals.user_id = ?", userID).
		Order("medals.created_at DESC").
		Limit(defaultMedalLimit).
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("load medal signals: %w", err)
	}

	items := make([]agent.GrowthMedalItem, 0, len(rows))
	for _, r := range rows {
		item := agent.GrowthMedalItem{
			ID:           r.ID,
			Title:        r.Title,
			ShortReason:  r.ShortReason,
			MemoryWeight: r.MemoryWeight,
			CreatedAt:    r.CreatedAt.Format(time.RFC3339),
			ExperienceID: r.ExperienceID,
		}
		if r.MeaningFocus != nil {
			item.MeaningFocus = *r.MeaningFocus
		}
		if r.Story != nil {
			item.Story = *r.Story
		}
		if r.Experience != nil {
			item.Experience = *r.Experience
		}
		if r.OccurredAt != nil {
			item.ExperienceAt = r.OccurredAt.Format("2006-01-02")
		}
		items = append(items, item)
	}

	// The prompt reads more naturally in chronological order.
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].CreatedAt < items[j].CreatedAt
	})
	return items, nil
}

func (s *Service) loadStageSignals(userID string) ([]agent.GrowthStageSummaryItem, error) {
	var rows []database.StageSummary
	if err := s.db.Where("user_id = ? AND status = ?", userID, "completed").
		Order("period_start DESC").
		Limit(defaultStageLimit).
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load stage summary signals: %w", err)
	}

	items := make([]agent.GrowthStageSummaryItem, 0, len(rows))
	for _, r := range rows {
		item := agent.GrowthStageSummaryItem{
			ID:           r.ID,
			PeriodType:   r.PeriodType,
			PeriodStart:  r.PeriodStart.Format("2006-01-02"),
			PeriodEnd:    r.PeriodEnd.Format("2006-01-02"),
			Title:        r.Title,
			Summary:      r.SummaryText,
			MemoryWeight: r.MemoryWeight,
			Highlights:   StringArrayFromJSON(r.HighlightsJSON),
		}
		if r.Story != nil {
			item.Story = *r.Story
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].PeriodStart < items[j].PeriodStart
	})
	return items, nil
}

func (s *Service) createInsights(tx *gorm.DB, userID, trigger string, resp *agent.GenerateGrowthProfileResponse) error {
	if len(resp.Insights) == 0 {
		return nil
	}

	signals := marshalJSON(resp.Evidence)
	for _, insight := range resp.Insights {
		title := strings.TrimSpace(insight.Title)
		summary := strings.TrimSpace(insight.Summary)
		if title == "" || summary == "" {
			continue
		}
		record := database.GrowthInsight{
			UserID:       userID,
			PeriodType:   "all",
			Title:        title,
			SummaryText:  summary,
			KeywordsJSON: marshalJSON(insight.Keywords),
			SignalsJSON:  signals,
			GeneratedBy:  "agent",
			Trigger:      trigger,
		}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
	}
	return nil
}

func marshalJSON(v interface{}) *string {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	s := string(b)
	return &s
}

func stringPtr(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

func StringArrayFromJSON(raw *string) []string {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return []string{}
	}
	var items []string
	if err := json.Unmarshal([]byte(*raw), &items); err != nil {
		return []string{}
	}
	if items == nil {
		return []string{}
	}
	return items
}

func StringsFromJSONFields(fields ...*string) []string {
	set := make(map[string]struct{})
	for _, field := range fields {
		for _, item := range StringArrayFromJSON(field) {
			normalized := strings.TrimSpace(item)
			if normalized == "" {
				continue
			}
			set[normalized] = struct{}{}
		}
	}
	items := make([]string, 0, len(set))
	for item := range set {
		items = append(items, item)
	}
	sort.Strings(items)
	return items
}
