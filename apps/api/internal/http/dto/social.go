package dto

import (
	"encoding/json"
	"time"
)

// --- Interactions (轻互动) ---

// CreateInteractionRequest is the payload for adding a light interaction to a
// medal. Type must be one of the supported interaction kinds.
type CreateInteractionRequest struct {
	Type string `json:"type" binding:"required,oneof=applaud relate brave memorable favorite"`
}

// InteractionResponse represents a single interaction record.
type InteractionResponse struct {
	ID        string    `json:"id"`
	MedalID   string    `json:"medal_id"`
	UserID    string    `json:"user_id"`
	Type      string    `json:"type"`
	CreatedAt time.Time `json:"created_at"`
}

// InteractionCountResponse aggregates interaction counts for a medal and, when
// a viewer is authenticated, which interaction types the viewer has applied.
type InteractionCountResponse struct {
	MedalID string         `json:"medal_id"`
	Counts  map[string]int `json:"counts"`
	Viewer  []string       `json:"viewer"`
}

// --- Follows / Friends (关注 / 好友) ---

// FollowStatusResponse reports the relationship between the viewer and a target
// user after a follow/unfollow operation.
type FollowStatusResponse struct {
	UserID         string `json:"user_id"`
	Following      bool   `json:"following"`
	FollowerCount  int64  `json:"follower_count"`
	FollowingCount int64  `json:"following_count"`
}

// UserSummary is a lightweight user card used in follow/friend lists.
type UserSummary struct {
	ID        string  `json:"id"`
	Nickname  string  `json:"nickname"`
	AvatarURL *string `json:"avatar_url"`
	Bio       *string `json:"bio"`
}

// FriendRequestResponse represents a friendship record after a state change.
type FriendRequestResponse struct {
	ID          string    `json:"id"`
	RequesterID string    `json:"requester_id"`
	AddresseeID string    `json:"addressee_id"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// FriendListItem pairs a friendship record with the other party's summary.
type FriendListItem struct {
	Friendship FriendRequestResponse `json:"friendship"`
	User       UserSummary           `json:"user"`
}

// --- Feed (社交流) ---

// FeedItemResponse is a single card in the social feed: the medal's outer-layer
// info plus its author summary, aggregated interaction counts, and the viewer's
// own interaction/follow state.
type FeedItemResponse struct {
	MedalID         string         `json:"medal_id"`
	Title           string         `json:"title"`
	ShortReason     string         `json:"short_reason"`
	MemoryWeight    string         `json:"memory_weight"`
	ImageURL        *string        `json:"image_url"`
	CreatedAt       time.Time      `json:"created_at"`
	Author          UserSummary    `json:"author"`
	Counts          map[string]int `json:"counts"`
	ViewerReactions []string       `json:"viewer_reactions"`
	ViewerFollowing bool           `json:"viewer_following"`
}

// PaginatedFeedResponse wraps a page of feed items with pagination metadata.
// The shape matches the shared PaginatedResponse<T> type on the frontend.
type PaginatedFeedResponse struct {
	Data     []FeedItemResponse `json:"data"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
}

// --- Notifications (通知) ---

// NotificationResponse is a single notification record. Data is emitted as a
// raw JSON object (or null) so the frontend can read typed payloads.
type NotificationResponse struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Type      string          `json:"type"`
	Title     string          `json:"title"`
	Body      *string         `json:"body"`
	Data      json.RawMessage `json:"data"`
	IsRead    bool            `json:"is_read"`
	CreatedAt time.Time       `json:"created_at"`
}

// PaginatedNotificationResponse wraps a page of notifications.
type PaginatedNotificationResponse struct {
	Data     []NotificationResponse `json:"data"`
	Total    int64                  `json:"total"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"page_size"`
}
