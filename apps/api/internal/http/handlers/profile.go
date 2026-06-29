package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ProfileHandler struct {
	db     *gorm.DB
	logger *slog.Logger
}

func NewProfileHandler(db *gorm.DB, logger *slog.Logger) *ProfileHandler {
	return &ProfileHandler{db: db, logger: logger}
}

// GetUserProfile handles GET /users/:id/profile
//
// Returns a user's public profile together with their medal count.
func (h *ProfileHandler) GetUserProfile(c *gin.Context) {
	targetUserID := c.Param("id")

	var user database.User
	if err := h.db.First(&user, "id = ?", targetUserID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		h.logger.Error("failed to query user", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	medalCount, err := h.countMedals(targetUserID)
	if err != nil {
		h.logger.Error("failed to count medals", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": h.toUserProfileResponse(&user, medalCount)})
}

// GetMyProfile handles GET /me/profile
//
// Returns the current authenticated user's full profile.
func (h *ProfileHandler) GetMyProfile(c *gin.Context) {
	currentUserID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var user database.User
	if err := h.db.First(&user, "id = ?", currentUserID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		h.logger.Error("failed to query user", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	medalCount, err := h.countMedals(currentUserID)
	if err != nil {
		h.logger.Error("failed to count medals", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": h.toUserProfileResponse(&user, medalCount)})
}

// UpdateMyProfile handles PUT /me/profile
//
// Updates nickname, avatar_url, bio for the current authenticated user.
func (h *ProfileHandler) UpdateMyProfile(c *gin.Context) {
	currentUserID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req dto.UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	var user database.User
	if err := h.db.First(&user, "id = ?", currentUserID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		h.logger.Error("failed to query user", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	updates := make(map[string]interface{})
	if req.Nickname != nil {
		updates["nickname"] = *req.Nickname
	}
	if req.AvatarURL != nil {
		updates["avatar_url"] = *req.AvatarURL
	}
	if req.Bio != nil {
		updates["bio"] = *req.Bio
	}

	if len(updates) > 0 {
		if err := h.db.Model(&user).Updates(updates).Error; err != nil {
			h.logger.Error("failed to update user profile", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update profile"})
			return
		}
	}

	// Reload user from DB.
	if err := h.db.First(&user, "id = ?", currentUserID).Error; err != nil {
		h.logger.Error("failed to reload user", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	medalCount, err := h.countMedals(currentUserID)
	if err != nil {
		h.logger.Error("failed to count medals", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": h.toUserProfileResponse(&user, medalCount)})
}

// GetUserMedals handles GET /users/:id/medals
//
// Returns the target user's medals. When the viewer is the owner, every medal
// (including private ones) is returned; otherwise only public medals are.
// Each medal is joined with its current version to expose meaning_focus/story.
func (h *ProfileHandler) GetUserMedals(c *gin.Context) {
	targetUserID := c.Param("id")

	viewerID := ""
	if v, exists := c.Get("user_id"); exists {
		if id, ok := v.(string); ok {
			viewerID = id
		}
	}

	publicOnly := viewerID != targetUserID

	resp, err := h.fetchMedalsWithVersions(targetUserID, publicOnly)
	if err != nil {
		h.logger.Error("failed to list user medals", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// GetMyMedals handles GET /me/medals
//
// Returns every medal (including private ones) owned by the current user.
func (h *ProfileHandler) GetMyMedals(c *gin.Context) {
	currentUserID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	resp, err := h.fetchMedalsWithVersions(currentUserID, false)
	if err != nil {
		h.logger.Error("failed to list my medals", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// UpdateMedalVisibility handles PUT /medals/:id/visibility
//
// Upserts the medal_visibility record for the medal (visibility + hidden_fields)
// and keeps the medal's own visibility field in sync so list queries reflect
// the change.
func (h *ProfileHandler) UpdateMedalVisibility(c *gin.Context) {
	currentUserID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	medalID := c.Param("id")

	var req dto.VisibilityUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	// Verify ownership.
	var medal database.Medal
	if err := h.db.Where("id = ? AND user_id = ?", medalID, currentUserID).First(&medal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "medal not found"})
			return
		}
		h.logger.Error("failed to query medal", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	err := h.db.Transaction(func(tx *gorm.DB) error {
		var vis database.MedalVisibility
		findErr := tx.Where("medal_id = ?", medalID).First(&vis).Error
		switch {
		case errors.Is(findErr, gorm.ErrRecordNotFound):
			vis = database.MedalVisibility{
				MedalID:      medalID,
				Visibility:   req.Visibility,
				HiddenFields: req.HiddenFields,
			}
			if createErr := tx.Create(&vis).Error; createErr != nil {
				return createErr
			}
		case findErr != nil:
			return findErr
		default:
			updates := map[string]interface{}{
				"visibility":    req.Visibility,
				"hidden_fields": req.HiddenFields,
			}
			if updateErr := tx.Model(&vis).Updates(updates).Error; updateErr != nil {
				return updateErr
			}
		}

		// Keep medal.Visibility in sync so list queries reflect the change.
		if syncErr := tx.Model(&medal).Update("visibility", req.Visibility).Error; syncErr != nil {
			return syncErr
		}
		return nil
	})
	if err != nil {
		h.logger.Error("failed to update medal visibility", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update visibility"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"message": "visibility updated"}})
}

// --- helpers ---

// currentViewerID extracts the authenticated user's id from the gin context.
func currentViewerID(c *gin.Context) (string, bool) {
	v, exists := c.Get("user_id")
	if !exists {
		return "", false
	}
	id, ok := v.(string)
	return id, ok
}

// countMedals returns the number of medals owned by the given user.
func (h *ProfileHandler) countMedals(userID string) (int64, error) {
	var count int64
	if err := h.db.Model(&database.Medal{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

// fetchMedalsWithVersions loads medals for a user (optionally public-only) and
// joins each medal with its current version to populate meaning_focus/story.
func (h *ProfileHandler) fetchMedalsWithVersions(targetUserID string, publicOnly bool) ([]dto.MedalWithVersionResponse, error) {
	query := h.db.Where("user_id = ?", targetUserID)
	if publicOnly {
		query = query.Where("visibility = ?", "public")
	}

	var medals []database.Medal
	if err := query.Order("created_at DESC").Find(&medals).Error; err != nil {
		return nil, err
	}

	// Collect current version ids to look up in a single query.
	versionIDs := make([]string, 0, len(medals))
	for i := range medals {
		if medals[i].CurrentVersionID != nil {
			versionIDs = append(versionIDs, *medals[i].CurrentVersionID)
		}
	}

	versionMap := make(map[string]database.MedalVersion, len(versionIDs))
	if len(versionIDs) > 0 {
		var versions []database.MedalVersion
		if err := h.db.Where("id IN ?", versionIDs).Find(&versions).Error; err != nil {
			return nil, err
		}
		for i := range versions {
			versionMap[versions[i].ID] = versions[i]
		}
	}

	resp := make([]dto.MedalWithVersionResponse, 0, len(medals))
	for i := range medals {
		var mv *database.MedalVersion
		if medals[i].CurrentVersionID != nil {
			if v, ok := versionMap[*medals[i].CurrentVersionID]; ok {
				mv = &v
			}
		}
		resp = append(resp, toMedalWithVersionResponse(&medals[i], mv))
	}
	return resp, nil
}

func (h *ProfileHandler) toUserProfileResponse(user *database.User, medalCount int64) dto.UserProfileResponse {
	return dto.UserProfileResponse{
		ID:         user.ID,
		Nickname:   user.Nickname,
		AvatarURL:  user.AvatarURL,
		Bio:        user.Bio,
		CreatedAt:  user.CreatedAt.Format(time.RFC3339),
		MedalCount: medalCount,
	}
}

func toMedalWithVersionResponse(m *database.Medal, v *database.MedalVersion) dto.MedalWithVersionResponse {
	resp := dto.MedalWithVersionResponse{
		ID:               m.ID,
		UserID:           m.UserID,
		ExperienceID:     m.ExperienceID,
		CurrentVersionID: m.CurrentVersionID,
		Title:            m.Title,
		ShortReason:      m.ShortReason,
		MemoryWeight:     m.MemoryWeight,
		ImageURL:         m.ImageURL,
		Visibility:       m.Visibility,
		EditedByUser:     m.EditedByUser,
		CreatedAt:        m.CreatedAt,
		UpdatedAt:        m.UpdatedAt,
	}
	if v != nil {
		resp.MeaningFocus = v.MeaningFocus
		resp.Story = v.Story
	}
	return resp
}
