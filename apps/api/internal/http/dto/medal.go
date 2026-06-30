package dto

import "time"

// --- Medal ---

type MedalResponse struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	ExperienceID     string    `json:"experience_id"`
	CurrentVersionID *string   `json:"current_version_id"`
	Title            string    `json:"title"`
	ShortReason      string    `json:"short_reason"`
	MemoryWeight     string    `json:"memory_weight"`
	ImageURL         *string   `json:"image_url"`
	Visibility       string    `json:"visibility"`
	EditedByUser     bool      `json:"edited_by_user"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type UpdateMedalRequest struct {
	Title        *string `json:"title" binding:"omitempty,max=255"`
	ShortReason  *string `json:"short_reason" binding:"omitempty"`
	MemoryWeight *string `json:"memory_weight" binding:"omitempty,oneof=light medium heavy"`
	ImageURL     *string `json:"image_url" binding:"omitempty"`
	Visibility   *string `json:"visibility" binding:"omitempty,oneof=public friends private"`
}

type GenerateMedalRequest struct {
	SessionID    string              `json:"session_id" binding:"required"`
	AgentRuntime *AgentRuntimeConfig `json:"agent_runtime" binding:"omitempty"`
}

type RegenerateMeaningRequest struct {
	Direction    *string             `json:"direction" binding:"omitempty"`
	UserInput    *string             `json:"user_input" binding:"omitempty"`
	AgentRuntime *AgentRuntimeConfig `json:"agent_runtime" binding:"omitempty"`
}

// --- Medal Version ---

type MedalVersionResponse struct {
	ID           string    `json:"id"`
	MedalID      string    `json:"medal_id"`
	VersionType  string    `json:"version_type"`
	Title        string    `json:"title"`
	ShortReason  string    `json:"short_reason"`
	MeaningFocus *string   `json:"meaning_focus"`
	Story        *string   `json:"story"`
	AnalysisJSON *string   `json:"analysis_json"`
	VisualPrompt *string   `json:"visual_prompt"`
	ImageURL     *string   `json:"image_url"`
	CreatedBy    string    `json:"created_by"`
	CreatedAt    time.Time `json:"created_at"`
}
