package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/earth-online/api/internal/integrations/agent"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type MedalHandler struct {
	db          *gorm.DB
	logger      *slog.Logger
	agentClient *agent.Client
}

func NewMedalHandler(db *gorm.DB, agentClient *agent.Client, logger *slog.Logger) *MedalHandler {
	return &MedalHandler{db: db, agentClient: agentClient, logger: logger}
}

// GenerateMedal handles POST /experiences/:id/medals/generate
func (h *MedalHandler) GenerateMedal(c *gin.Context) {
	userID, _ := c.Get("user_id")
	experienceID := c.Param("id")

	// Verify experience belongs to user
	var exp database.Experience
	if err := h.db.Where("id = ? AND user_id = ?", experienceID, userID).First(&exp).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "experience not found"})
			return
		}
		h.logger.Error("failed to query experience", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var req dto.GenerateMedalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_id is required"})
		return
	}

	// Get conversation history from session
	var messages []database.ConversationMessage
	if err := h.db.Where("session_id = ?", req.SessionID).Order("created_at ASC").Find(&messages).Error; err != nil {
		h.logger.Error("failed to query messages", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load conversation"})
		return
	}

	// Build history for Agent
	history := make([]agent.HistoryItem, 0, len(messages))
	for _, msg := range messages {
		history = append(history, agent.HistoryItem{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}

	// Create generation job
	job := database.GenerationJob{
		UserID:       userID.(string),
		ExperienceID: &experienceID,
		JobType:      "medal_generation",
		Status:       "processing",
	}
	if err := h.db.Create(&job).Error; err != nil {
		h.logger.Error("failed to create generation job", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create job"})
		return
	}

	// Call Agent service
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	agentReq := &agent.GenerateMedalRequest{
		SessionID:  req.SessionID,
		Experience: derefString(exp.Summary),
		History:    history,
	}

	agentResp, err := h.agentClient.GenerateMedal(ctx, agentReq)
	if err != nil {
		h.logger.Error("agent medal generation failed", "error", err)
		// Update job status to failed
		errMsg := err.Error()
		h.db.Model(&job).Updates(map[string]interface{}{"status": "failed", "error_message": &errMsg})

		c.JSON(http.StatusBadGateway, gin.H{"error": "medal generation failed", "detail": err.Error()})
		return
	}

	// Create medal version record
	version := database.MedalVersion{
		VersionType:  "initial",
		Title:        agentResp.Title,
		ShortReason:  agentResp.ShortReason,
		MeaningFocus: &agentResp.MeaningFocus,
		Story:        &agentResp.Story,
		CreatedBy:    "agent",
	}

	// Create medal record
	medal := database.Medal{
		UserID:       userID.(string),
		ExperienceID: experienceID,
		Title:        agentResp.Title,
		ShortReason:  agentResp.ShortReason,
		MemoryWeight: agentResp.MemoryWeight,
		Visibility:   "public",
		EditedByUser: false,
	}

	// Transaction: create medal + version
	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&medal).Error; err != nil {
			return err
		}

		version.MedalID = medal.ID
		if err := tx.Create(&version).Error; err != nil {
			return err
		}

		// Link medal to current version
		if err := tx.Model(&medal).Update("current_version_id", version.ID).Error; err != nil {
			return err
		}

		// Update job status
		outputJSON, _ := json.Marshal(agentResp)
		outputStr := string(outputJSON)
		tx.Model(&job).Updates(map[string]interface{}{
			"status":      "completed",
			"medal_id":    &medal.ID,
			"output_json": &outputStr,
		})

		// Update experience status
		tx.Model(&exp).Update("status", "medal_generating")

		return nil
	})

	if err != nil {
		h.logger.Error("failed to save medal", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save medal"})
		return
	}

	// Reload medal with version ID
	h.db.First(&medal, "id = ?", medal.ID)

	c.JSON(http.StatusCreated, gin.H{"data": h.toResponse(&medal)})
}

// GetMedal handles GET /medals/:id
func (h *MedalHandler) GetMedal(c *gin.Context) {
	userID, _ := c.Get("user_id")
	medalID := c.Param("id")

	var medal database.Medal
	if err := h.db.Where("id = ? AND user_id = ?", medalID, userID).First(&medal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "medal not found"})
			return
		}
		h.logger.Error("failed to query medal", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": h.toResponse(&medal)})
}

// ListMedals handles GET /medals
func (h *MedalHandler) ListMedals(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var medals []database.Medal
	if err := h.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&medals).Error; err != nil {
		h.logger.Error("failed to list medals", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	resp := make([]dto.MedalResponse, len(medals))
	for i, medal := range medals {
		resp[i] = h.toResponse(&medal)
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// UpdateMedal handles PUT /medals/:id
func (h *MedalHandler) UpdateMedal(c *gin.Context) {
	userID, _ := c.Get("user_id")
	medalID := c.Param("id")

	var medal database.Medal
	if err := h.db.Where("id = ? AND user_id = ?", medalID, userID).First(&medal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "medal not found"})
			return
		}
		h.logger.Error("failed to query medal", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var req dto.UpdateMedalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	updates := make(map[string]interface{})
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.ShortReason != nil {
		updates["short_reason"] = *req.ShortReason
	}
	if req.MemoryWeight != nil {
		updates["memory_weight"] = *req.MemoryWeight
	}
	if req.ImageURL != nil {
		updates["image_url"] = *req.ImageURL
	}
	if req.Visibility != nil {
		updates["visibility"] = *req.Visibility
	}
	updates["edited_by_user"] = true

	if len(updates) > 1 { // more than just edited_by_user
		if err := h.db.Model(&medal).Updates(updates).Error; err != nil {
			h.logger.Error("failed to update medal", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update medal"})
			return
		}
	}

	// Create an edited version if content changed
	if req.Title != nil || req.ShortReason != nil || req.MemoryWeight != nil {
		h.db.First(&medal, "id = ?", medalID)

		editedVersion := database.MedalVersion{
			MedalID:      medal.ID,
			VersionType:  "user_edit",
			Title:        medal.Title,
			ShortReason:  medal.ShortReason,
			MeaningFocus: nil,
			Story:        nil,
			CreatedBy:    "user",
		}
		h.db.Create(&editedVersion)
		h.db.Model(&medal).Update("current_version_id", editedVersion.ID)
	}

	h.db.First(&medal, "id = ?", medalID)
	c.JSON(http.StatusOK, gin.H{"data": h.toResponse(&medal)})
}

// RegenerateMeaning handles POST /medals/:id/regenerate/meaning
func (h *MedalHandler) RegenerateMeaning(c *gin.Context) {
	userID, _ := c.Get("user_id")
	medalID := c.Param("id")

	var medal database.Medal
	if err := h.db.Where("id = ? AND user_id = ?", medalID, userID).First(&medal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "medal not found"})
			return
		}
		h.logger.Error("failed to query medal", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var req dto.RegenerateMeaningRequest
	_ = c.ShouldBindJSON(&req)

	// Get experience for context
	var exp database.Experience
	h.db.First(&exp, "id = ?", medal.ExperienceID)

	// Get conversation history
	var session database.ConversationSession
	h.db.First(&session, "experience_id = ?", medal.ExperienceID)

	var messages []database.ConversationMessage
	h.db.Where("session_id = ?", session.ID).Order("created_at ASC").Find(&messages)

	history := make([]agent.HistoryItem, 0, len(messages))
	for _, msg := range messages {
		history = append(history, agent.HistoryItem{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}

	// Call Agent for meaning regeneration
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	direction := ""
	userInput := ""
	if req.Direction != nil {
		direction = *req.Direction
	}
	if req.UserInput != nil {
		userInput = *req.UserInput
	}

	agentReq := &agent.GenerateMedalRequest{
		Experience: derefString(exp.Summary),
		History:    history,
		Direction:  direction,
		UserInput:  userInput,
	}

	agentResp, err := h.agentClient.RegenerateMeaning(ctx, agentReq)
	if err != nil {
		h.logger.Error("meaning regeneration failed", "error", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "regeneration failed", "detail": err.Error()})
		return
	}

	// Create new version
	newVersion := database.MedalVersion{
		MedalID:      medal.ID,
		VersionType:  "meaning_regenerate",
		Title:        agentResp.Title,
		ShortReason:  agentResp.ShortReason,
		MeaningFocus: &agentResp.MeaningFocus,
		Story:        &agentResp.Story,
		CreatedBy:    "agent",
	}

	if err := h.db.Create(&newVersion).Error; err != nil {
		h.logger.Error("failed to save version", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save version"})
		return
	}

	// Update medal with new content
	h.db.Model(&medal).Updates(map[string]interface{}{
		"title":             agentResp.Title,
		"short_reason":      agentResp.ShortReason,
		"memory_weight":     agentResp.MemoryWeight,
		"current_version_id": newVersion.ID,
	})

	h.db.First(&medal, "id = ?", medalID)
	c.JSON(http.StatusOK, gin.H{"data": h.toResponse(&medal)})
}

// ListVersions handles GET /medals/:id/versions
func (h *MedalHandler) ListVersions(c *gin.Context) {
	userID, _ := c.Get("user_id")
	medalID := c.Param("id")

	// Verify ownership
	var medal database.Medal
	if err := h.db.Where("id = ? AND user_id = ?", medalID, userID).First(&medal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "medal not found"})
			return
		}
		h.logger.Error("failed to query medal", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var versions []database.MedalVersion
	if err := h.db.Where("medal_id = ?", medalID).Order("created_at DESC").Find(&versions).Error; err != nil {
		h.logger.Error("failed to list versions", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	resp := make([]dto.MedalVersionResponse, len(versions))
	for i, v := range versions {
		resp[i] = dto.MedalVersionResponse{
			ID:           v.ID,
			MedalID:      v.MedalID,
			VersionType:  v.VersionType,
			Title:        v.Title,
			ShortReason:  v.ShortReason,
			MeaningFocus: v.MeaningFocus,
			Story:        v.Story,
			AnalysisJSON: v.AnalysisJSON,
			VisualPrompt: v.VisualPrompt,
			ImageURL:     v.ImageURL,
			CreatedBy:    v.CreatedBy,
			CreatedAt:    v.CreatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// RestoreVersion handles POST /medals/:id/versions/:vid/restore
func (h *MedalHandler) RestoreVersion(c *gin.Context) {
	userID, _ := c.Get("user_id")
	medalID := c.Param("id")
	versionID := c.Param("vid")

	// Verify medal ownership
	var medal database.Medal
	if err := h.db.Where("id = ? AND user_id = ?", medalID, userID).First(&medal).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "medal not found"})
			return
		}
		h.logger.Error("failed to query medal", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Get the version to restore
	var version database.MedalVersion
	if err := h.db.Where("id = ? AND medal_id = ?", versionID, medalID).First(&version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "version not found"})
			return
		}
		h.logger.Error("failed to query version", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Update medal from version
	h.db.Model(&medal).Updates(map[string]interface{}{
		"title":              version.Title,
		"short_reason":       version.ShortReason,
		"current_version_id": version.ID,
	})

	h.db.First(&medal, "id = ?", medalID)
	c.JSON(http.StatusOK, gin.H{"data": h.toResponse(&medal)})
}

func (h *MedalHandler) toResponse(medal *database.Medal) dto.MedalResponse {
	return dto.MedalResponse{
		ID:               medal.ID,
		UserID:           medal.UserID,
		ExperienceID:     medal.ExperienceID,
		CurrentVersionID: medal.CurrentVersionID,
		Title:            medal.Title,
		ShortReason:      medal.ShortReason,
		MemoryWeight:     medal.MemoryWeight,
		ImageURL:         medal.ImageURL,
		Visibility:       medal.Visibility,
		EditedByUser:     medal.EditedByUser,
		CreatedAt:        medal.CreatedAt,
		UpdatedAt:        medal.UpdatedAt,
	}
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}