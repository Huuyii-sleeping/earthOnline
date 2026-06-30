package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/domain/growthprofile"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type GrowthProfileHandler struct {
	db      *gorm.DB
	service *growthprofile.Service
	logger  *slog.Logger
}

func NewGrowthProfileHandler(db *gorm.DB, service *growthprofile.Service, logger *slog.Logger) *GrowthProfileHandler {
	return &GrowthProfileHandler{db: db, service: service, logger: logger}
}

// GetGrowthProfile handles GET /growth-profile.
func (h *GrowthProfileHandler) GetGrowthProfile(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var profile database.GrowthProfile
	if err := h.db.Where("user_id = ?", viewerID).First(&profile).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"data": emptyGrowthProfileResponse(viewerID)})
			return
		}
		h.logger.Error("failed to query growth profile", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": toGrowthProfileResponse(&profile)})
}

// RefreshGrowthProfile handles POST /growth-profile/refresh.
func (h *GrowthProfileHandler) RefreshGrowthProfile(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req dto.RefreshGrowthProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}
	if req.Scope == "" {
		req.Scope = "all"
	}

	profile, err := h.service.Refresh(c.Request.Context(), growthprofile.RefreshInput{
		UserID:  viewerID,
		Scope:   req.Scope,
		Trigger: "manual",
	})
	if err != nil {
		if errors.Is(err, growthprofile.ErrNoSignals) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "还没有足够的经历记录来生成成长画像"})
			return
		}
		h.logger.Error("failed to refresh growth profile", "error", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "growth profile refresh failed", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": toGrowthProfileResponse(profile)})
}

// ListGrowthInsights handles GET /growth-insights.
func (h *GrowthProfileHandler) ListGrowthInsights(c *gin.Context) {
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

	query := h.db.Model(&database.GrowthInsight{}).Where("user_id = ?", viewerID)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		h.logger.Error("failed to count growth insights", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var insights []database.GrowthInsight
	if err := query.Order("created_at DESC").
		Limit(pageSize).Offset(offset).
		Find(&insights).Error; err != nil {
		h.logger.Error("failed to list growth insights", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	items := make([]dto.GrowthInsightResponse, 0, len(insights))
	for i := range insights {
		items = append(items, toGrowthInsightResponse(&insights[i]))
	}

	c.JSON(http.StatusOK, dto.PaginatedGrowthInsightResponse{
		Data:     items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

func toGrowthProfileResponse(p *database.GrowthProfile) dto.GrowthProfileResponse {
	return dto.GrowthProfileResponse{
		ID:              p.ID,
		UserID:          p.UserID,
		TraitKeywords:   rawJSONOrArray(p.TraitKeywordsJSON),
		GrowthKeywords:  rawJSONOrArray(p.GrowthKeywordsJSON),
		ExperienceTypes: rawJSONOrArray(p.ExperienceTypesJSON),
		EmotionTrends:   rawJSONOrArray(p.EmotionTrendsJSON),
		SummaryText:     p.SummaryText,
		SourceCounts:    rawJSONOrObject(p.SourceCountsJSON),
		LastRefreshedAt: p.LastRefreshedAt,
		CreatedAt:       p.CreatedAt,
		UpdatedAt:       p.UpdatedAt,
	}
}

func emptyGrowthProfileResponse(userID string) dto.EmptyGrowthProfileResponse {
	return dto.EmptyGrowthProfileResponse{
		UserID:          userID,
		TraitKeywords:   json.RawMessage("[]"),
		GrowthKeywords:  json.RawMessage("[]"),
		ExperienceTypes: json.RawMessage("[]"),
		EmotionTrends:   json.RawMessage("[]"),
		SourceCounts:    json.RawMessage("{}"),
	}
}

func toGrowthInsightResponse(i *database.GrowthInsight) dto.GrowthInsightResponse {
	return dto.GrowthInsightResponse{
		ID:          i.ID,
		UserID:      i.UserID,
		PeriodType:  i.PeriodType,
		PeriodStart: i.PeriodStart,
		PeriodEnd:   i.PeriodEnd,
		Title:       i.Title,
		SummaryText: i.SummaryText,
		Keywords:    rawJSONOrArray(i.KeywordsJSON),
		Signals:     rawJSONOrObject(i.SignalsJSON),
		GeneratedBy: i.GeneratedBy,
		Trigger:     i.Trigger,
		CreatedAt:   i.CreatedAt,
	}
}

func rawJSONOrArray(raw *string) json.RawMessage {
	if raw == nil || *raw == "" {
		return json.RawMessage("[]")
	}
	return json.RawMessage(*raw)
}

func rawJSONOrObject(raw *string) json.RawMessage {
	if raw == nil || *raw == "" {
		return json.RawMessage("{}")
	}
	return json.RawMessage(*raw)
}
