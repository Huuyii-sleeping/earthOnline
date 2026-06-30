package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/domain/yearreview"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/earth-online/api/internal/integrations/agent"
	"github.com/earth-online/api/internal/integrations/taskqueue"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type YearReviewHandler struct {
	db      *gorm.DB
	service *yearreview.Service
	queue   *taskqueue.Client
	logger  *slog.Logger
}

func NewYearReviewHandler(db *gorm.DB, service *yearreview.Service, queue *taskqueue.Client, logger *slog.Logger) *YearReviewHandler {
	return &YearReviewHandler{db: db, service: service, queue: queue, logger: logger}
}

// GenerateYearReview handles POST /annual-reviews/generate
func (h *YearReviewHandler) GenerateYearReview(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req dto.GenerateAnnualReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	// Forward browser-side LLM credentials if provided.
	var runtime *agent.AgentRuntimePayload
	if req.AgentRuntime != nil && req.AgentRuntime.APIKey != "" {
		runtime = &agent.AgentRuntimePayload{
			APIURL:       req.AgentRuntime.APIURL,
			APIKey:       req.AgentRuntime.APIKey,
			Model:        req.AgentRuntime.Model,
			SystemPrompt: req.AgentRuntime.SystemPrompt,
		}
	}

	review, err := h.service.Generate(c.Request.Context(), yearreview.GenerateInput{
		UserID:       viewerID,
		Year:         req.Year,
		Trigger:      "manual",
		AgentRuntime: runtime,
	})
	if err != nil {
		if errors.Is(err, yearreview.ErrAlreadyExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "该年度回顾已存在，如需重新生成请先删除"})
			return
		}
		if errors.Is(err, yearreview.ErrNoData) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "今年还没有足够的记录来生成年度回顾"})
			return
		}
		h.logger.Error("failed to generate year review", "error", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "year review generation failed", "detail": err.Error()})
		return
	}

	// Best-effort: refresh growth portrait with the new annual signal.
	h.queue.EnqueueGrowthProfileRefresh(c.Request.Context(), viewerID, "year_review_generated")

	c.JSON(http.StatusCreated, gin.H{"data": toYearReviewResponse(review)})
}

// ListYearReviews handles GET /annual-reviews?page=&page_size=
func (h *YearReviewHandler) ListYearReviews(c *gin.Context) {
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

	query := h.db.Model(&database.AnnualReview{}).Where("user_id = ?", viewerID)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		h.logger.Error("failed to count year reviews", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var reviews []database.AnnualReview
	if err := query.Order("year DESC").
		Limit(pageSize).Offset(offset).
		Find(&reviews).Error; err != nil {
		h.logger.Error("failed to list year reviews", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	items := make([]dto.AnnualReviewResponse, 0, len(reviews))
	for i := range reviews {
		items = append(items, toYearReviewResponse(&reviews[i]))
	}

	c.JSON(http.StatusOK, dto.PaginatedAnnualReviewResponse{
		Data:     items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

// GetYearReview handles GET /annual-reviews/:year
func (h *YearReviewHandler) GetYearReview(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	yearStr := c.Param("year")
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2020 || year > 2100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid year"})
		return
	}

	var review database.AnnualReview
	if err := h.db.Where("user_id = ? AND year = ?", viewerID, year).First(&review).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "year review not found"})
			return
		}
		h.logger.Error("failed to query year review", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": toYearReviewResponse(&review)})
}

// DeleteYearReview handles DELETE /annual-reviews/:year
func (h *YearReviewHandler) DeleteYearReview(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	yearStr := c.Param("year")
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2020 || year > 2100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid year"})
		return
	}

	if err := h.service.Delete(viewerID, year); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "year review not found"})
			return
		}
		h.logger.Error("failed to delete year review", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func toYearReviewResponse(r *database.AnnualReview) dto.AnnualReviewResponse {
	resp := dto.AnnualReviewResponse{
		ID:                r.ID,
		UserID:            r.UserID,
		Year:              r.Year,
		Status:            r.Status,
		Title:             r.Title,
		Narrative:         r.Narrative,
		MedalCount:        r.MedalCount,
		StageSummaryCount: r.StageSummaryCount,
		ExperienceCount:   r.ExperienceCount,
		GeneratedBy:       r.GeneratedBy,
		Trigger:           r.Trigger,
		CreatedAt:         r.CreatedAt,
		UpdatedAt:         r.UpdatedAt,
	}
	if r.AnnualThemesJSON != nil && *r.AnnualThemesJSON != "" {
		resp.AnnualThemes = json.RawMessage(*r.AnnualThemesJSON)
	}
	if r.MilestoneMedalsJSON != nil && *r.MilestoneMedalsJSON != "" {
		resp.MilestoneMedals = json.RawMessage(*r.MilestoneMedalsJSON)
	}
	if r.GrowthArcJSON != nil && *r.GrowthArcJSON != "" {
		resp.GrowthArc = json.RawMessage(*r.GrowthArcJSON)
	}
	if r.EmotionArcJSON != nil && *r.EmotionArcJSON != "" {
		resp.EmotionArc = json.RawMessage(*r.EmotionArcJSON)
	}
	if r.KeywordEvolutionJSON != nil && *r.KeywordEvolutionJSON != "" {
		resp.KeywordEvolution = json.RawMessage(*r.KeywordEvolutionJSON)
	}
	return resp
}
