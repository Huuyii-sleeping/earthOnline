package handlers

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AgentProfileHandler struct {
	db     *gorm.DB
	logger *slog.Logger
}

func NewAgentProfileHandler(db *gorm.DB, logger *slog.Logger) *AgentProfileHandler {
	return &AgentProfileHandler{db: db, logger: logger}
}

// GetAgentProfile handles GET /agent-profile
//
// Returns the current user's Agent configuration, lazily creating a default
// profile on first access so the frontend always has something to render.
func (h *AgentProfileHandler) GetAgentProfile(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	profile, err := h.getOrCreate(viewerID)
	if err != nil {
		h.logger.Error("failed to get agent profile", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": toAgentProfileResponse(profile)})
}

// UpdateAgentProfile handles PUT /agent-profile
//
// Updates the editable Agent configuration fields, including proactive_level
// which governs how proactively the Agent generates stage summaries / reminders.
func (h *AgentProfileHandler) UpdateAgentProfile(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req dto.UpdateAgentProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	profile, err := h.getOrCreate(viewerID)
	if err != nil {
		h.logger.Error("failed to get agent profile", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Personality != nil {
		updates["personality"] = *req.Personality
	}
	if req.IdentityPrompt != nil {
		updates["identity_prompt"] = *req.IdentityPrompt
	}
	if req.DialogueStyle != nil {
		updates["dialogue_style"] = *req.DialogueStyle
	}
	if req.AvatarURL != nil {
		updates["avatar_url"] = *req.AvatarURL
	}
	if req.ProactiveLevel != nil {
		updates["proactive_level"] = *req.ProactiveLevel
	}

	if len(updates) > 0 {
		if err := h.db.Model(profile).Updates(updates).Error; err != nil {
			h.logger.Error("failed to update agent profile", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update agent profile"})
			return
		}
	}

	// Reload to return the persisted state.
	if err := h.db.First(profile, "id = ?", profile.ID).Error; err != nil {
		h.logger.Error("failed to reload agent profile", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": toAgentProfileResponse(profile)})
}

// getOrCreate returns the user's agent profile, creating a default one if none
// exists yet. This mirrors the lazy-create behavior already used when starting
// conversations.
func (h *AgentProfileHandler) getOrCreate(userID string) (*database.AgentProfile, error) {
	var profile database.AgentProfile
	err := h.db.Where("user_id = ?", userID).First(&profile).Error
	if err == nil {
		return &profile, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	profile = database.AgentProfile{
		UserID:         userID,
		Name:           "My Agent",
		ProactiveLevel: 1,
	}
	if err := h.db.Create(&profile).Error; err != nil {
		return nil, err
	}
	return &profile, nil
}

func toAgentProfileResponse(p *database.AgentProfile) dto.AgentProfileResponse {
	return dto.AgentProfileResponse{
		ID:             p.ID,
		UserID:         p.UserID,
		Name:           p.Name,
		Personality:    p.Personality,
		IdentityPrompt: p.IdentityPrompt,
		DialogueStyle:  p.DialogueStyle,
		AvatarURL:      p.AvatarURL,
		ProactiveLevel: p.ProactiveLevel,
		CreatedAt:      p.CreatedAt,
		UpdatedAt:      p.UpdatedAt,
	}
}
