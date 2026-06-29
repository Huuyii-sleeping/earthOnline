package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/earth-online/api/internal/storage"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AssetHandler struct {
	db          *gorm.DB
	minioClient *storage.MinIOClient
	logger      *slog.Logger
}

func NewAssetHandler(db *gorm.DB, minioClient *storage.MinIOClient, logger *slog.Logger) *AssetHandler {
	return &AssetHandler{db: db, minioClient: minioClient, logger: logger}
}

// PresignUpload handles POST /assets/presign
// Returns a presigned PUT URL the client can use to upload the asset directly
// to object storage, along with the storage_key that must be sent back when
// creating the asset record.
func (h *AssetHandler) PresignUpload(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req dto.PresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	// Build a unique, predictable storage key:
	//   assets/{user_id}/{asset_type}/{uuid}.{ext}
	ext := extensionForMimeType(req.MimeType)
	storageKey := strings.TrimSuffix(
		filepath.Join("assets", userID.(string), req.AssetType, uuid.New().String()+"."+ext),
		".",
	)

	uploadURL, err := h.minioClient.PresignUpload(c.Request.Context(), storageKey, req.MimeType)
	if err != nil {
		h.logger.Error("failed to presign upload", "error", err, "storage_key", storageKey)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue upload url"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": dto.PresignUploadResponse{
			UploadURL:  uploadURL,
			StorageKey: storageKey,
			AssetType:  req.AssetType,
			MimeType:   req.MimeType,
			ExpiresIn:  900, // 15 minutes
		},
	})
}

// CreateAsset handles POST /assets
// Persists the asset record after the client has finished uploading the bytes
// to the presigned URL returned by PresignUpload.
func (h *AssetHandler) CreateAsset(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req dto.CreateAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	// If an experience is provided, it must belong to the current user.
	if req.ExperienceID != nil && *req.ExperienceID != "" {
		var exp database.Experience
		if err := h.db.Where("id = ? AND user_id = ?", *req.ExperienceID, userID).First(&exp).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "experience not found"})
				return
			}
			h.logger.Error("failed to query experience", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			return
		}
	}

	visibility := "private"
	if req.Visibility != nil && *req.Visibility != "" {
		visibility = *req.Visibility
	}

	asset := database.Asset{
		UserID:       userID.(string),
		ExperienceID: req.ExperienceID,
		StorageKey:   req.StorageKey,
		URL:          req.URL,
		MimeType:     req.MimeType,
		AssetType:    req.AssetType,
		SizeBytes:    req.SizeBytes,
		Visibility:   visibility,
	}

	if err := h.db.Create(&asset).Error; err != nil {
		h.logger.Error("failed to create asset", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create asset"})
		return
	}

	h.logger.Info("asset created", "asset_id", asset.ID, "user_id", asset.UserID, "asset_type", asset.AssetType)
	c.JSON(http.StatusCreated, gin.H{"data": h.toResponse(&asset)})
}

// GetAsset handles GET /assets/:id
// Only the owner may access private assets. Public/friends assets are visible
// to any authenticated user.
func (h *AssetHandler) GetAsset(c *gin.Context) {
	userID, _ := c.Get("user_id")
	assetID := c.Param("id")

	var asset database.Asset
	if err := h.db.First(&asset, "id = ?", assetID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "asset not found"})
			return
		}
		h.logger.Error("failed to query asset", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	if asset.Visibility == "private" && asset.UserID != userID.(string) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have access to this asset"})
		return
	}

	// Mint a fresh, short-lived download URL so private objects remain accessible
	// only to authorized callers. If presigning fails we fall back to the stored
	// URL rather than failing the whole request.
	resp := h.toResponse(&asset)
	if downloadURL, err := h.minioClient.PresignDownload(c.Request.Context(), asset.StorageKey); err == nil {
		resp.URL = downloadURL
	} else {
		h.logger.Warn("failed to presign download url", "error", err, "asset_id", asset.ID)
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

func (h *AssetHandler) toResponse(asset *database.Asset) dto.AssetResponse {
	return dto.AssetResponse{
		ID:           asset.ID,
		UserID:       asset.UserID,
		ExperienceID: asset.ExperienceID,
		URL:          asset.URL,
		MimeType:     asset.MimeType,
		AssetType:    asset.AssetType,
		SizeBytes:    asset.SizeBytes,
		Visibility:   asset.Visibility,
		CreatedAt:    asset.CreatedAt,
	}
}

// extensionForMimeType maps a few common mime types to file extensions so that
// the generated storage keys stay human-readable. Unknown mime types fall back
// to "bin".
func extensionForMimeType(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return "jpg"
	case "image/png":
		return "png"
	case "image/gif":
		return "gif"
	case "image/webp":
		return "webp"
	case "audio/mpeg", "audio/mp3":
		return "mp3"
	case "audio/wav", "audio/x-wav":
		return "wav"
	case "audio/ogg":
		return "ogg"
	case "audio/m4a", "audio/x-m4a":
		return "m4a"
	case "audio/webm":
		return "webm"
	default:
		// Some mime types carry an explicit extension, e.g. "image/svg+xml".
		if idx := strings.Index(mimeType, "/"); idx != -1 {
			ext := mimeType[idx+1:]
			ext = strings.SplitN(ext, "+", 2)[0]
			if ext != "" {
				return ext
			}
		}
		return "bin"
	}
}
