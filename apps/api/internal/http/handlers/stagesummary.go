package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/domain/stagesummary"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/earth-online/api/internal/integrations/taskqueue"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type StageSummaryHandler struct {
	db      *gorm.DB
	service *stagesummary.Service
	queue   *taskqueue.Client
	logger  *slog.Logger
}

func NewStageSummaryHandler(db *gorm.DB, service *stagesummary.Service, queue *taskqueue.Client, logger *slog.Logger) *StageSummaryHandler {
	return &StageSummaryHandler{db: db, service: service, queue: queue, logger: logger}
}

// GenerateStageSummary handles POST /stage-summaries/generate
//
// Manually triggers generation of a stage summary for the period (week/month)
// containing ref_date (or now). Idempotent: returns the existing summary when
// one already exists for that window, and 422 when the window has no
// experiences worth summarizing.
func (h *StageSummaryHandler) GenerateStageSummary(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req dto.GenerateStageSummaryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	ref := time.Now()
	if req.RefDate != "" {
		parsed, err := parseStageSummaryRefDate(req.RefDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ref_date"})
			return
		}
		ref = parsed
	}

	period := stagesummary.PeriodType(req.PeriodType)
	start, end := stagesummary.PeriodBounds(period, ref)

	summary, err := h.service.Generate(c.Request.Context(), stagesummary.GenerateInput{
		UserID:      viewerID,
		Period:      period,
		PeriodStart: start,
		PeriodEnd:   end,
		Trigger:     "manual",
	})
	if err != nil {
		if errors.Is(err, stagesummary.ErrNoExperiences) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "这个周期内还没有可总结的经历"})
			return
		}
		h.logger.Error("failed to generate stage summary", "error", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "stage summary generation failed", "detail": err.Error()})
		return
	}

	// Best-effort: refresh the growth portrait now that a new stage summary
	// is available as a signal. Failures never affect this response.
	h.queue.EnqueueGrowthProfileRefresh(c.Request.Context(), viewerID, "stage_summary_generated")

	c.JSON(http.StatusOK, gin.H{"data": toStageSummaryResponse(summary)})
}

// ListStageSummaries handles GET /stage-summaries?period_type=&page=&page_size=
func (h *StageSummaryHandler) ListStageSummaries(c *gin.Context) {
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

	query := h.db.Model(&database.StageSummary{}).Where("user_id = ?", viewerID)
	if pt := c.Query("period_type"); pt == "week" || pt == "month" {
		query = query.Where("period_type = ?", pt)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		h.logger.Error("failed to count stage summaries", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var summaries []database.StageSummary
	if err := query.Order("period_start DESC").
		Limit(pageSize).Offset(offset).
		Find(&summaries).Error; err != nil {
		h.logger.Error("failed to list stage summaries", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	items := make([]dto.StageSummaryResponse, 0, len(summaries))
	for i := range summaries {
		items = append(items, toStageSummaryResponse(&summaries[i]))
	}

	c.JSON(http.StatusOK, dto.PaginatedStageSummaryResponse{
		Data:     items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

// GetStageSummary handles GET /stage-summaries/:id
func (h *StageSummaryHandler) GetStageSummary(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	id := c.Param("id")

	var summary database.StageSummary
	if err := h.db.Where("id = ? AND user_id = ?", id, viewerID).First(&summary).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "stage summary not found"})
			return
		}
		h.logger.Error("failed to query stage summary", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": toStageSummaryResponse(&summary)})
}

func toStageSummaryResponse(s *database.StageSummary) dto.StageSummaryResponse {
	resp := dto.StageSummaryResponse{
		ID:              s.ID,
		UserID:          s.UserID,
		PeriodType:      s.PeriodType,
		PeriodStart:     s.PeriodStart,
		PeriodEnd:       s.PeriodEnd,
		Status:          s.Status,
		Title:           s.Title,
		SummaryText:     s.SummaryText,
		Story:           s.Story,
		MemoryWeight:    s.MemoryWeight,
		ExperienceCount: s.ExperienceCount,
		GeneratedBy:     s.GeneratedBy,
		Trigger:         s.Trigger,
		CreatedAt:       s.CreatedAt,
	}
	if s.HighlightsJSON != nil && *s.HighlightsJSON != "" {
		resp.Highlights = json.RawMessage(*s.HighlightsJSON)
	}
	return resp
}

func parseStageSummaryRefDate(value string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02", value, time.Local)
}
