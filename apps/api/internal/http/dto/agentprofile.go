package dto

import "time"

// --- Agent profile (Agent 设置) ---

// AgentProfileResponse is the API representation of a user's Agent configuration.
type AgentProfileResponse struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	Name           string    `json:"name"`
	Personality    *string   `json:"personality"`
	IdentityPrompt *string   `json:"identity_prompt"`
	DialogueStyle  *string   `json:"dialogue_style"`
	AvatarURL      *string   `json:"avatar_url"`
	ProactiveLevel int       `json:"proactive_level"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// UpdateAgentProfileRequest updates the Agent configuration. All fields are
// optional; only provided (non-nil) fields are applied. ProactiveLevel controls
// how proactive the Agent is: 0 = off, 1 = in-app only, 2 = push allowed.
type UpdateAgentProfileRequest struct {
	Name           *string `json:"name" binding:"omitempty,min=1,max=100"`
	Personality    *string `json:"personality" binding:"omitempty,max=1000"`
	IdentityPrompt *string `json:"identity_prompt" binding:"omitempty,max=2000"`
	DialogueStyle  *string `json:"dialogue_style" binding:"omitempty,max=1000"`
	AvatarURL      *string `json:"avatar_url" binding:"omitempty,max=2048"`
	ProactiveLevel *int    `json:"proactive_level" binding:"omitempty,min=0,max=2"`
}
