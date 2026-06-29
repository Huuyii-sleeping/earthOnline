package dto

import "time"

// --- Asset ---

// PresignUploadRequest is the body of POST /assets/presign.
type PresignUploadRequest struct {
	AssetType string `json:"asset_type" binding:"required,oneof=image audio"`
	MimeType  string `json:"mime_type" binding:"required"`
}

// PresignUploadResponse is returned by POST /assets/presign.
type PresignUploadResponse struct {
	UploadURL   string `json:"upload_url"`
	StorageKey  string `json:"storage_key"`
	AssetType   string `json:"asset_type"`
	MimeType    string `json:"mime_type"`
	ExpiresIn   int    `json:"expires_in"`
}

// CreateAssetRequest is the body of POST /assets. It is called by the client
// after a successful direct upload to MinIO using the presigned URL.
type CreateAssetRequest struct {
	StorageKey   string  `json:"storage_key" binding:"required"`
	URL          string  `json:"url" binding:"required"`
	MimeType     string  `json:"mime_type" binding:"required"`
	AssetType    string  `json:"asset_type" binding:"required,oneof=image audio video document"`
	SizeBytes    int64   `json:"size_bytes" binding:"omitempty,min=0"`
	ExperienceID *string `json:"experience_id" binding:"omitempty"`
	Visibility   *string `json:"visibility" binding:"omitempty,oneof=public friends private"`
}

// AssetResponse is the canonical representation of an asset returned to clients.
type AssetResponse struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	ExperienceID *string   `json:"experience_id"`
	URL          string    `json:"url"`
	MimeType     string    `json:"mime_type"`
	AssetType    string    `json:"asset_type"`
	SizeBytes    int64     `json:"size_bytes"`
	Visibility   string    `json:"visibility"`
	CreatedAt    time.Time `json:"created_at"`
}
