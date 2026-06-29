package dto

import "time"

// --- Experience ---

type CreateExperienceRequest struct {
	Title      *string `json:"title" binding:"omitempty,max=255"`
	OccurredAt *string `json:"occurred_at" binding:"omitempty"`
}

type UpdateExperienceRequest struct {
	Title      *string `json:"title" binding:"omitempty,max=255"`
	Status     *string `json:"status" binding:"omitempty,oneof=collecting summarized medal_generating completed archived"`
	OccurredAt *string `json:"occurred_at" binding:"omitempty"`
	Summary    *string `json:"summary" binding:"omitempty"`
}

type ExperienceResponse struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Title      *string    `json:"title"`
	Status     string     `json:"status"`
	OccurredAt *time.Time `json:"occurred_at"`
	Summary    *string    `json:"summary"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}