package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type NotificationHandler struct {
	db     *gorm.DB
	logger *slog.Logger
}

func NewNotificationHandler(db *gorm.DB, logger *slog.Logger) *NotificationHandler {
	return &NotificationHandler{db: db, logger: logger}
}

// ListNotifications handles GET /notifications?page=&page_size=
//
// Returns the current viewer's notifications, newest first, paginated.
func (h *NotificationHandler) ListNotifications(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), defaultPageSize)
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	offset := (page - 1) * pageSize

	var total int64
	if err := h.db.Model(&database.Notification{}).
		Where("user_id = ?", viewerID).Count(&total).Error; err != nil {
		h.logger.Error("failed to count notifications", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var notifications []database.Notification
	if err := h.db.Where("user_id = ?", viewerID).
		Order("created_at DESC").
		Limit(pageSize).Offset(offset).
		Find(&notifications).Error; err != nil {
		h.logger.Error("failed to list notifications", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	items := make([]dto.NotificationResponse, 0, len(notifications))
	for i := range notifications {
		items = append(items, toNotificationResponse(&notifications[i]))
	}

	c.JSON(http.StatusOK, dto.PaginatedNotificationResponse{
		Data:     items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

// UnreadCount handles GET /notifications/unread-count
func (h *NotificationHandler) UnreadCount(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var count int64
	if err := h.db.Model(&database.Notification{}).
		Where("user_id = ? AND is_read = ?", viewerID, false).
		Count(&count).Error; err != nil {
		h.logger.Error("failed to count unread notifications", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"unread": count}})
}

// MarkRead handles POST /notifications/:id/read
func (h *NotificationHandler) MarkRead(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	notificationID := c.Param("id")

	var n database.Notification
	if err := h.db.Where("id = ? AND user_id = ?", notificationID, viewerID).First(&n).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
			return
		}
		h.logger.Error("failed to query notification", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	if err := h.db.Model(&n).Update("is_read", true).Error; err != nil {
		h.logger.Error("failed to mark notification read", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update notification"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"message": "notification marked read"}})
}

// MarkAllRead handles POST /notifications/read-all
func (h *NotificationHandler) MarkAllRead(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	if err := h.db.Model(&database.Notification{}).
		Where("user_id = ? AND is_read = ?", viewerID, false).
		Update("is_read", true).Error; err != nil {
		h.logger.Error("failed to mark all notifications read", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update notifications"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"message": "all notifications marked read"}})
}

func toNotificationResponse(n *database.Notification) dto.NotificationResponse {
	var data json.RawMessage
	if n.Data != nil && *n.Data != "" {
		data = json.RawMessage(*n.Data)
	}
	return dto.NotificationResponse{
		ID:        n.ID,
		UserID:    n.UserID,
		Type:      n.Type,
		Title:     n.Title,
		Body:      n.Body,
		Data:      data,
		IsRead:    n.IsRead,
		CreatedAt: n.CreatedAt,
	}
}
