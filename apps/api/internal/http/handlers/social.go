package handlers

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SocialHandler struct {
	db     *gorm.DB
	logger *slog.Logger
}

func NewSocialHandler(db *gorm.DB, logger *slog.Logger) *SocialHandler {
	return &SocialHandler{db: db, logger: logger}
}

// interactionLabels maps interaction types to human-readable Chinese labels
// used in notification titles.
var interactionLabels = map[string]string{
	"applaud":   "为你鼓掌",
	"relate":    "我也经历过",
	"brave":     "这很勇敢",
	"memorable": "这值得记住",
	"favorite":  "收藏了你的奖章",
}

// CreateInteraction handles POST /medals/:id/interactions
//
// Adds a light interaction (applaud / relate / brave / memorable / favorite) to
// a medal. The operation is idempotent: repeating the same (medal, user, type)
// is a no-op rather than an error. The medal must be public unless the viewer
// owns it. When someone interacts with another user's medal, a notification is
// written to the medal owner on a best-effort basis.
func (h *SocialHandler) CreateInteraction(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	medalID := c.Param("id")

	var req dto.CreateInteractionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	// Load the medal to check existence and visibility.
	var medal database.Medal
	if err := h.db.First(&medal, "id = ?", medalID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "medal not found"})
			return
		}
		h.logger.Error("failed to query medal", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Only public medals (or your own) can be interacted with.
	if medal.Visibility != "public" && medal.UserID != viewerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "medal is not public"})
		return
	}

	// Idempotent insert: ignore the conflict on (medal_id, user_id, type).
	interaction := database.MedalInteraction{
		MedalID: medalID,
		UserID:  viewerID,
		Type:    req.Type,
	}
	result := h.db.Where(database.MedalInteraction{
		MedalID: medalID,
		UserID:  viewerID,
		Type:    req.Type,
	}).FirstOrCreate(&interaction)
	if result.Error != nil {
		h.logger.Error("failed to create interaction", "error", result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create interaction"})
		return
	}

	// Notify the medal owner (best-effort, skip self-interaction and only when
	// this is a newly created interaction).
	if result.RowsAffected > 0 && medal.UserID != viewerID {
		label := interactionLabels[req.Type]
		body := fmt.Sprintf("有人对你的奖章「%s」表达了「%s」", medal.Title, label)
		data := jsonData(map[string]string{"medal_id": medalID, "type": req.Type})
		writeNotification(h.db, h.logger, medal.UserID, "medal_interaction", label, &body, data)
	}

	counts, viewer, err := h.interactionState(medalID, viewerID)
	if err != nil {
		h.logger.Error("failed to load interaction state", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": dto.InteractionCountResponse{
		MedalID: medalID,
		Counts:  counts,
		Viewer:  viewer,
	}})
}

// DeleteInteraction handles DELETE /medals/:id/interactions/:type
//
// Removes the current viewer's interaction of the given type from a medal.
// Deleting a non-existent interaction is treated as success (idempotent).
func (h *SocialHandler) DeleteInteraction(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	medalID := c.Param("id")
	interactionType := c.Param("type")

	if err := h.db.Where(
		"medal_id = ? AND user_id = ? AND type = ?", medalID, viewerID, interactionType,
	).Delete(&database.MedalInteraction{}).Error; err != nil {
		h.logger.Error("failed to delete interaction", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete interaction"})
		return
	}

	counts, viewer, err := h.interactionState(medalID, viewerID)
	if err != nil {
		h.logger.Error("failed to load interaction state", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": dto.InteractionCountResponse{
		MedalID: medalID,
		Counts:  counts,
		Viewer:  viewer,
	}})
}

// --- helpers ---

// interactionState returns the per-type interaction counts for a medal along
// with the list of types the viewer has applied.
func (h *SocialHandler) interactionState(medalID, viewerID string) (map[string]int, []string, error) {
	type row struct {
		Type  string
		Count int
	}
	var rows []row
	if err := h.db.Model(&database.MedalInteraction{}).
		Select("type, COUNT(*) as count").
		Where("medal_id = ?", medalID).
		Group("type").
		Scan(&rows).Error; err != nil {
		return nil, nil, err
	}

	counts := make(map[string]int, len(rows))
	for _, r := range rows {
		counts[r.Type] = r.Count
	}

	var viewerTypes []string
	if viewerID != "" {
		if err := h.db.Model(&database.MedalInteraction{}).
			Where("medal_id = ? AND user_id = ?", medalID, viewerID).
			Pluck("type", &viewerTypes).Error; err != nil {
			return nil, nil, err
		}
	}
	if viewerTypes == nil {
		viewerTypes = []string{}
	}

	return counts, viewerTypes, nil
}
