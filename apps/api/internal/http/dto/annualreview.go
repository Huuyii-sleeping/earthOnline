package dto

import (
	"encoding/json"
	"time"
)

// --- Annual review (年度回顾) ---

type GenerateAnnualReviewRequest struct {
	Year int `json:"year" binding:"required,min=2020,max=2100"`
}

type AnnualReviewResponse struct {
	ID                string          `json:"id"`
	UserID            string          `json:"user_id"`
	Year              int             `json:"year"`
	Status            string          `json:"status"`
	Title             string          `json:"title"`
	Narrative         string          `json:"narrative"`
	AnnualThemes      json.RawMessage `json:"annual_themes"`
	MilestoneMedals   json.RawMessage `json:"milestone_medals"`
	GrowthArc         json.RawMessage `json:"growth_arc"`
	EmotionArc        json.RawMessage `json:"emotion_arc"`
	KeywordEvolution  json.RawMessage `json:"keyword_evolution"`
	MedalCount        int             `json:"medal_count"`
	StageSummaryCount int             `json:"stage_summary_count"`
	ExperienceCount   int             `json:"experience_count"`
	GeneratedBy       string          `json:"generated_by"`
	Trigger           string          `json:"trigger"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

type PaginatedAnnualReviewResponse struct {
	Data     []AnnualReviewResponse `json:"data"`
	Total    int64                  `json:"total"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"page_size"`
}
