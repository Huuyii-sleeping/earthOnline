package handlers

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/earth-online/api/internal/database"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AgentToolHandler provides internal endpoints that the Agent service's
// tools call back to fetch user-specific data (medals, experiences,
// growth profile). These endpoints are authenticated via an
// X-Internal-User-Id header instead of JWT — they are only accessible
// from within the backend network.
type AgentToolHandler struct {
	db     *gorm.DB
	logger *slog.Logger
}

func NewAgentToolHandler(db *gorm.DB, logger *slog.Logger) *AgentToolHandler {
	return &AgentToolHandler{db: db, logger: logger}
}

// RegisterRoutes registers internal tool endpoints on the given router group.
// These are mounted under /api/v1/agent/tools/ and do NOT require JWT auth.
// They use X-Internal-User-Id header for user identification.
func (h *AgentToolHandler) RegisterRoutes(rg *gin.RouterGroup) {
	tools := rg.Group("/agent/tools")
	tools.Use(h.internalAuthMiddleware)
	tools.GET("/medals", h.GetRecentMedals)
	tools.GET("/experiences", h.GetRecentExperiences)
	tools.GET("/growth-profile", h.GetGrowthProfile)
}

// internalAuthMiddleware validates the X-Internal-User-Id header.
// In production, this should also check an internal shared secret.
func (h *AgentToolHandler) internalAuthMiddleware(c *gin.Context) {
	userID := c.GetHeader("X-Internal-User-Id")
	if userID == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing X-Internal-User-Id header"})
		return
	}
	c.Set("internalUserID", userID)
	c.Next()
}

func (h *AgentToolHandler) getInternalUserID(c *gin.Context) string {
	return c.GetString("internalUserID")
}

// GetRecentMedals returns the user's recent medals for Agent tool calls.
// Query param: limit (default 5, max 20)
func (h *AgentToolHandler) GetRecentMedals(c *gin.Context) {
	userID := h.getInternalUserID(c)

	var medals []database.Medal
	query := h.db.Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(5)

	if limitStr := c.Query("limit"); limitStr != "" {
		var limit int
		if _, err := fmt.Sscanf(limitStr, "%d", &limit); err == nil && limit > 0 && limit <= 20 {
			query = query.Limit(limit)
		}
	}

	if err := query.Find(&medals).Error; err != nil {
		h.logger.Error("agent tool: failed to query medals", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query medals"})
		return
	}

	// Return a lightweight projection — only what the LLM needs.
	type medalItem struct {
		ID           string `json:"id"`
		Title        string `json:"title"`
		ShortReason  string `json:"short_reason"`
		MemoryWeight string `json:"memory_weight"`
		CreatedAt    string `json:"created_at"`
	}

	items := make([]medalItem, 0, len(medals))
	for _, m := range medals {
		items = append(items, medalItem{
			ID:           m.ID,
			Title:        m.Title,
			ShortReason:  m.ShortReason,
			MemoryWeight: m.MemoryWeight,
			CreatedAt:    m.CreatedAt.Format("2006-01-02"),
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetRecentExperiences returns the user's recent experiences.
func (h *AgentToolHandler) GetRecentExperiences(c *gin.Context) {
	userID := h.getInternalUserID(c)

	var experiences []database.Experience
	query := h.db.Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(3)

	if limitStr := c.Query("limit"); limitStr != "" {
		var limit int
		if _, err := fmt.Sscanf(limitStr, "%d", &limit); err == nil && limit > 0 && limit <= 10 {
			query = query.Limit(limit)
		}
	}

	if err := query.Find(&experiences).Error; err != nil {
		h.logger.Error("agent tool: failed to query experiences", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query experiences"})
		return
	}

	type expItem struct {
		ID        string `json:"id"`
		Title     string `json:"title"`
		Status    string `json:"status"`
		CreatedAt string `json:"created_at"`
	}

	items := make([]expItem, 0, len(experiences))
	for _, e := range experiences {
		title := ""
		if e.Title != nil {
			title = *e.Title
		}
		items = append(items, expItem{
			ID:        e.ID,
			Title:     title,
			Status:    e.Status,
			CreatedAt: e.CreatedAt.Format("2006-01-02"),
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetGrowthProfile returns the user's latest growth profile snapshot.
func (h *AgentToolHandler) GetGrowthProfile(c *gin.Context) {
	userID := h.getInternalUserID(c)

	var profile database.GrowthProfile
	if err := h.db.Where("user_id = ?", userID).First(&profile).Error; err != nil {
		// No profile yet — return empty, not an error.
		c.JSON(http.StatusOK, gin.H{"data": nil, "message": "用户尚未生成成长画像"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"summary":         profile.SummaryText,
			"trait_keywords":  profile.TraitKeywordsJSON,
			"growth_keywords": profile.GrowthKeywordsJSON,
			"updated_at":      profile.UpdatedAt.Format("2006-01-02"),
		},
	})
}
