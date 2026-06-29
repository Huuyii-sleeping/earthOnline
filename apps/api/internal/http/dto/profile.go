package dto

import "time"

// --- Profile ---

// UserProfileResponse is the public profile payload for a user, including the
// number of medals they own.
type UserProfileResponse struct {
	ID         string  `json:"id"`
	Nickname   string  `json:"nickname"`
	AvatarURL  *string `json:"avatar_url"`
	Bio        *string `json:"bio"`
	CreatedAt  string  `json:"created_at"`
	MedalCount int64   `json:"medal_count"`
}

// UpdateProfileRequest updates a user's editable profile fields. All fields are
// optional; only provided (non-nil) fields are applied.
type UpdateProfileRequest struct {
	Nickname  *string `json:"nickname" binding:"omitempty,min=1,max=100"`
	AvatarURL *string `json:"avatar_url" binding:"omitempty,max=2048"`
	Bio       *string `json:"bio" binding:"omitempty,max=500"`
}

// --- Medal visibility ---

// MedalWithVersionResponse carries the base medal info together with the
// meaning_focus and story fields pulled from the medal's current version.
type MedalWithVersionResponse struct {
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
	MeaningFocus     *string   `json:"meaning_focus"`
	Story            *string   `json:"story"`
}

// VisibilityUpdateRequest updates a medal's visibility level and optional
// hidden_fields configuration. HiddenFields is a JSON string stored as JSONB
// in the medal_visibility table.
type VisibilityUpdateRequest struct {
	Visibility   string  `json:"visibility" binding:"required,oneof=public friends private"`
	HiddenFields *string `json:"hidden_fields" binding:"omitempty"`
}
