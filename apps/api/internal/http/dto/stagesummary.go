package dto

import (
	"encoding/json"
	"time"
)

// --- Stage summaries (阶段性产出) ---

// GenerateStageSummaryRequest is the manual-trigger payload. PeriodType selects
// the window granularity; RefDate (optional, YYYY-MM-DD) picks which window —
// defaulting to the period containing "now" when omitted.
type GenerateStageSummaryRequest struct {
	PeriodType string `json:"period_type" binding:"required,oneof=week month"`
	RefDate    string `json:"ref_date" binding:"omitempty,datetime=2006-01-02"`
}

// StageSummaryResponse is the API representation of a stage summary. Highlights
// is emitted as a JSON array (or null) parsed from the stored JSONB string.
type StageSummaryResponse struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	PeriodType      string          `json:"period_type"`
	PeriodStart     time.Time       `json:"period_start"`
	PeriodEnd       time.Time       `json:"period_end"`
	Status          string          `json:"status"`
	Title           string          `json:"title"`
	SummaryText     string          `json:"summary_text"`
	Story           *string         `json:"story"`
	MemoryWeight    string          `json:"memory_weight"`
	Highlights      json.RawMessage `json:"highlights"`
	ExperienceCount int             `json:"experience_count"`
	GeneratedBy     string          `json:"generated_by"`
	Trigger         string          `json:"trigger"`
	CreatedAt       time.Time       `json:"created_at"`
}

// PaginatedStageSummaryResponse wraps a page of stage summaries.
type PaginatedStageSummaryResponse struct {
	Data     []StageSummaryResponse `json:"data"`
	Total    int64                  `json:"total"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"page_size"`
}
