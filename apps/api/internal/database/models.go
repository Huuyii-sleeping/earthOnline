package database

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Base model with common fields
type Base struct {
	ID        string    `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (b *Base) BeforeCreate(tx *gorm.DB) error {
	if b.ID == "" {
		b.ID = uuid.New().String()
	}
	return nil
}

// User
type User struct {
	Base
	Account   string  `gorm:"type:varchar(100);not null;uniqueIndex" json:"account"`
	Nickname  string  `gorm:"type:varchar(100);not null" json:"nickname"`
	AvatarURL *string `gorm:"type:text" json:"avatar_url"`
	Bio       *string `gorm:"type:text" json:"bio"`
	Password  string  `gorm:"type:varchar(255);not null" json:"-"`
}

func (User) TableName() string { return "users" }

// AgentProfile
type AgentProfile struct {
	Base
	UserID         string  `gorm:"type:uuid;not null;index" json:"user_id"`
	Name           string  `gorm:"type:varchar(100);not null" json:"name"`
	Personality    *string `gorm:"type:text" json:"personality"`
	IdentityPrompt *string `gorm:"type:text" json:"identity_prompt"`
	DialogueStyle  *string `gorm:"type:text" json:"dialogue_style"`
	AvatarURL      *string `gorm:"type:text" json:"avatar_url"`
	ProactiveLevel int     `gorm:"default:1" json:"proactive_level"`
}

func (AgentProfile) TableName() string { return "agent_profiles" }

// Experience
type Experience struct {
	Base
	UserID     string     `gorm:"type:uuid;not null;index" json:"user_id"`
	Title      *string    `gorm:"type:varchar(255)" json:"title"`
	Status     string     `gorm:"type:varchar(50);not null;default:'collecting'" json:"status"`
	OccurredAt *time.Time `gorm:"type:timestamptz" json:"occurred_at"`
	Summary    *string    `gorm:"type:text" json:"summary"`
}

func (Experience) TableName() string { return "experiences" }

// ConversationSession
type ConversationSession struct {
	Base
	UserID         string `gorm:"type:uuid;not null;index" json:"user_id"`
	ExperienceID   string `gorm:"type:uuid;not null;index" json:"experience_id"`
	AgentProfileID string `gorm:"type:uuid;not null" json:"agent_profile_id"`
	Status         string `gorm:"type:varchar(50);not null;default:'active'" json:"status"`
}

func (ConversationSession) TableName() string { return "conversation_sessions" }

// ConversationMessage
type ConversationMessage struct {
	Base
	SessionID   string  `gorm:"type:uuid;not null;index" json:"session_id"`
	Role        string  `gorm:"type:varchar(20);not null" json:"role"`
	Content     string  `gorm:"type:text;not null" json:"content"`
	ContentType string  `gorm:"type:varchar(50);not null;default:'text'" json:"content_type"`
	AssetID     *string `gorm:"type:uuid" json:"asset_id"`
}

func (ConversationMessage) TableName() string { return "conversation_messages" }

// Asset
type Asset struct {
	Base
	UserID       string  `gorm:"type:uuid;not null;index" json:"user_id"`
	ExperienceID *string `gorm:"type:uuid;index" json:"experience_id"`
	StorageKey   string  `gorm:"type:text;not null" json:"storage_key"`
	URL          string  `gorm:"type:text;not null" json:"url"`
	MimeType     string  `gorm:"type:varchar(100);not null" json:"mime_type"`
	AssetType    string  `gorm:"type:varchar(50);not null" json:"asset_type"`
	SizeBytes    int64   `gorm:"not null" json:"size_bytes"`
	Metadata     *string `gorm:"type:jsonb" json:"metadata"`
	Visibility   string  `gorm:"type:varchar(50);not null;default:'private'" json:"visibility"`
}

func (Asset) TableName() string { return "assets" }

// Medal
type Medal struct {
	Base
	UserID           string  `gorm:"type:uuid;not null;index" json:"user_id"`
	ExperienceID     string  `gorm:"type:uuid;not null;index" json:"experience_id"`
	CurrentVersionID *string `gorm:"type:uuid" json:"current_version_id"`
	Title            string  `gorm:"type:varchar(255);not null" json:"title"`
	ShortReason      string  `gorm:"type:text;not null" json:"short_reason"`
	MemoryWeight     string  `gorm:"type:varchar(20);not null;default:'medium'" json:"memory_weight"`
	ImageURL         *string `gorm:"type:text" json:"image_url"`
	Visibility       string  `gorm:"type:varchar(50);not null;default:'public'" json:"visibility"`
	EditedByUser     bool    `gorm:"default:false" json:"edited_by_user"`
}

func (Medal) TableName() string { return "medals" }

// MedalVersion
type MedalVersion struct {
	Base
	MedalID      string  `gorm:"type:uuid;not null;index" json:"medal_id"`
	VersionType  string  `gorm:"type:varchar(50);not null" json:"version_type"`
	Title        string  `gorm:"type:varchar(255);not null" json:"title"`
	ShortReason  string  `gorm:"type:text;not null" json:"short_reason"`
	MeaningFocus *string `gorm:"type:text" json:"meaning_focus"`
	Story        *string `gorm:"type:text" json:"story"`
	AnalysisJSON *string `gorm:"type:jsonb" json:"analysis_json"`
	VisualPrompt *string `gorm:"type:text" json:"visual_prompt"`
	ImageURL     *string `gorm:"type:text" json:"image_url"`
	CreatedBy    string  `gorm:"type:varchar(20);not null" json:"created_by"`
}

func (MedalVersion) TableName() string { return "medal_versions" }

// MedalVisibility
type MedalVisibility struct {
	Base
	MedalID      string  `gorm:"type:uuid;not null;uniqueIndex" json:"medal_id"`
	Visibility   string  `gorm:"type:varchar(50);not null" json:"visibility"`
	HiddenFields *string `gorm:"type:jsonb" json:"hidden_fields"`
}

func (MedalVisibility) TableName() string { return "medal_visibility" }

// MedalInteraction
type MedalInteraction struct {
	Base
	MedalID string `gorm:"type:uuid;not null;index" json:"medal_id"`
	UserID  string `gorm:"type:uuid;not null;index" json:"user_id"`
	Type    string `gorm:"type:varchar(50);not null" json:"type"`
}

func (MedalInteraction) TableName() string { return "medal_interactions" }

// FollowRelation
type FollowRelation struct {
	Base
	FollowerID  string `gorm:"type:uuid;not null;uniqueIndex:idx_follow" json:"follower_id"`
	FollowingID string `gorm:"type:uuid;not null;uniqueIndex:idx_follow" json:"following_id"`
}

func (FollowRelation) TableName() string { return "follows" }

// FriendRelation
type FriendRelation struct {
	Base
	RequesterID string `gorm:"type:uuid;not null;uniqueIndex:idx_friend" json:"requester_id"`
	AddresseeID string `gorm:"type:uuid;not null;uniqueIndex:idx_friend" json:"addressee_id"`
	Status      string `gorm:"type:varchar(50);not null;default:'pending'" json:"status"`
}

func (FriendRelation) TableName() string { return "friendships" }

// Notification
type Notification struct {
	Base
	UserID string  `gorm:"type:uuid;not null;index" json:"user_id"`
	Type   string  `gorm:"type:varchar(50);not null" json:"type"`
	Title  string  `gorm:"type:varchar(255);not null" json:"title"`
	Body   *string `gorm:"type:text" json:"body"`
	Data   *string `gorm:"type:jsonb" json:"data"`
	IsRead bool    `gorm:"column:is_read;default:false" json:"is_read"`
}

func (Notification) TableName() string { return "notifications" }

// GenerationJob
type GenerationJob struct {
	Base
	UserID       string  `gorm:"type:uuid;not null;index" json:"user_id"`
	ExperienceID *string `gorm:"type:uuid;index" json:"experience_id"`
	MedalID      *string `gorm:"type:uuid;index" json:"medal_id"`
	JobType      string  `gorm:"type:varchar(50);not null" json:"job_type"`
	Status       string  `gorm:"type:varchar(50);not null;default:'pending'" json:"status"`
	InputJSON    *string `gorm:"type:jsonb" json:"input_json"`
	OutputJSON   *string `gorm:"type:jsonb" json:"output_json"`
	ErrorMsg     *string `gorm:"type:text" json:"error_message"`
}

func (GenerationJob) TableName() string { return "generation_jobs" }
