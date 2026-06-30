package dto

import "time"

// --- Conversation Session ---

type CreateSessionRequest struct {
	ExperienceID string `json:"experience_id" binding:"required"`
}

type SessionResponse struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	ExperienceID   string    `json:"experience_id"`
	AgentProfileID string    `json:"agent_profile_id"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// --- Conversation Message ---

// AgentRuntimeConfig is sent by the frontend so the Agent service can use
// the user's browser-configured LLM credentials when no server-side key exists.
type AgentRuntimeConfig struct {
	APIURL       string `json:"api_url"`
	APIKey       string `json:"api_key"`
	Model        string `json:"model"`
	SystemPrompt string `json:"system_prompt"`
}

type CreateMessageRequest struct {
	Content      string              `json:"content" binding:"required"`
	ContentType  *string             `json:"content_type" binding:"omitempty,oneof=text image audio generated_summary"`
	AssetID      *string             `json:"asset_id" binding:"omitempty"`
	AgentRuntime *AgentRuntimeConfig `json:"agent_runtime" binding:"omitempty"`
}

type MessageResponse struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"session_id"`
	Role        string    `json:"role"`
	Content     string    `json:"content"`
	ContentType string    `json:"content_type"`
	AssetID     *string   `json:"asset_id"`
	CreatedAt   time.Time `json:"created_at"`
}

// --- Summary ---

type SummaryRequest struct {
	SessionID    string              `json:"session_id" binding:"required"`
	AgentRuntime *AgentRuntimeConfig `json:"agent_runtime" binding:"omitempty"`
}

type SummaryResponse struct {
	ExperienceSummary string   `json:"experience_summary"`
	KeyMoments        []string `json:"key_moments"`
	DetectedEmotions  []string `json:"detected_emotions"`
	PossibleMeaning   string   `json:"possible_meaning"`
	ReadyToGenerate   bool     `json:"ready_to_generate"`
}
