package dto

import (
	"encoding/json"
	"time"
)

// --- Growth profile (成长画像) ---

type GrowthProfileResponse struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	TraitKeywords   json.RawMessage `json:"trait_keywords"`
	GrowthKeywords  json.RawMessage `json:"growth_keywords"`
	ExperienceTypes json.RawMessage `json:"experience_types"`
	EmotionTrends   json.RawMessage `json:"emotion_trends"`
	SummaryText     *string         `json:"summary_text"`
	SourceCounts    json.RawMessage `json:"source_counts"`
	LastRefreshedAt *time.Time      `json:"last_refreshed_at"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type EmptyGrowthProfileResponse struct {
	UserID          string          `json:"user_id"`
	TraitKeywords   json.RawMessage `json:"trait_keywords"`
	GrowthKeywords  json.RawMessage `json:"growth_keywords"`
	ExperienceTypes json.RawMessage `json:"experience_types"`
	EmotionTrends   json.RawMessage `json:"emotion_trends"`
	SummaryText     *string         `json:"summary_text"`
	SourceCounts    json.RawMessage `json:"source_counts"`
	LastRefreshedAt *time.Time      `json:"last_refreshed_at"`
}

type RefreshGrowthProfileRequest struct {
	Scope        string              `json:"scope" binding:"omitempty,oneof=all recent"`
	AgentRuntime *AgentRuntimeConfig `json:"agent_runtime" binding:"omitempty"`
}

type GrowthInsightResponse struct {
	ID          string          `json:"id"`
	UserID      string          `json:"user_id"`
	PeriodType  string          `json:"period_type"`
	PeriodStart *time.Time      `json:"period_start"`
	PeriodEnd   *time.Time      `json:"period_end"`
	Title       string          `json:"title"`
	SummaryText string          `json:"summary_text"`
	Keywords    json.RawMessage `json:"keywords"`
	Signals     json.RawMessage `json:"signals"`
	GeneratedBy string          `json:"generated_by"`
	Trigger     string          `json:"trigger"`
	CreatedAt   time.Time       `json:"created_at"`
}

type PaginatedGrowthInsightResponse struct {
	Data     []GrowthInsightResponse `json:"data"`
	Total    int64                   `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"page_size"`
}
