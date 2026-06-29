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

type ExperienceHandler struct {
	db     *gorm.DB
	logger *slog.Logger
}

func NewExperienceHandler(db *gorm.DB, logger *slog.Logger) *ExperienceHandler {
	return &ExperienceHandler{db: db, logger: logger}
}

// CreateExperience handles POST /experiences
func (h *ExperienceHandler) CreateExperience(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req dto.CreateExperienceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	exp := database.Experience{
		UserID: userID.(string),
		Title:  req.Title,
		Status: "collecting",
	}

	if req.OccurredAt != nil {
		t, err := time.Parse(time.RFC3339, *req.OccurredAt)
		if err == nil {
			exp.OccurredAt = &t
		}
	}

	// Create a default agent profile for the user if none exists
	var agentProfile database.AgentProfile
	if err := h.db.Where("user_id = ?", userID).First(&agentProfile).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			agentProfile = database.AgentProfile{
				UserID:         userID.(string),
				Name:           "My Agent",
				ProactiveLevel: 1,
			}
			if err := h.db.Create(&agentProfile).Error; err != nil {
				h.logger.Error("failed to create agent profile", "error", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create agent profile"})
				return
			}
		} else {
			h.logger.Error("failed to query agent profile", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			return
		}
	}

	if err := h.db.Create(&exp).Error; err != nil {
		h.logger.Error("failed to create experience", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create experience"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": h.toResponse(&exp)})
}

// GetExperience handles GET /experiences/:id
func (h *ExperienceHandler) GetExperience(c *gin.Context) {
	userID, _ := c.Get("user_id")
	expID := c.Param("id")

	var exp database.Experience
	if err := h.db.Where("id = ? AND user_id = ?", expID, userID).First(&exp).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "experience not found"})
			return
		}
		h.logger.Error("failed to query experience", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": h.toResponse(&exp)})
}

// ListExperiences handles GET /experiences
func (h *ExperienceHandler) ListExperiences(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var experiences []database.Experience
	if err := h.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&experiences).Error; err != nil {
		h.logger.Error("failed to list experiences", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	resp := make([]dto.ExperienceResponse, len(experiences))
	for i, exp := range experiences {
		resp[i] = h.toResponse(&exp)
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// UpdateExperience handles PUT /experiences/:id
func (h *ExperienceHandler) UpdateExperience(c *gin.Context) {
	userID, _ := c.Get("user_id")
	expID := c.Param("id")

	var exp database.Experience
	if err := h.db.Where("id = ? AND user_id = ?", expID, userID).First(&exp).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "experience not found"})
			return
		}
		h.logger.Error("failed to query experience", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var req dto.UpdateExperienceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	updates := make(map[string]interface{})
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.OccurredAt != nil {
		t, err := time.Parse(time.RFC3339, *req.OccurredAt)
		if err == nil {
			updates["occurred_at"] = t
		}
	}
	if req.Summary != nil {
		updates["summary"] = *req.Summary
	}

	if len(updates) > 0 {
		if err := h.db.Model(&exp).Updates(updates).Error; err != nil {
			h.logger.Error("failed to update experience", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update experience"})
			return
		}
	}

	// Reload
	h.db.First(&exp, "id = ?", expID)
	c.JSON(http.StatusOK, gin.H{"data": h.toResponse(&exp)})
}

func (h *ExperienceHandler) toResponse(exp *database.Experience) dto.ExperienceResponse {
	return dto.ExperienceResponse{
		ID:         exp.ID,
		UserID:     exp.UserID,
		Title:      exp.Title,
		Status:     exp.Status,
		OccurredAt: exp.OccurredAt,
		Summary:    exp.Summary,
		CreatedAt:  exp.CreatedAt,
		UpdatedAt:  exp.UpdatedAt,
	}
}