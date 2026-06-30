package handlers

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type FeedHandler struct {
	db     *gorm.DB
	logger *slog.Logger
}

func NewFeedHandler(db *gorm.DB, logger *slog.Logger) *FeedHandler {
	return &FeedHandler{db: db, logger: logger}
}

const (
	defaultPageSize = 20
	maxPageSize     = 50
)

// GetFeed handles GET /feed?tab=&page=&page_size=
//
// Returns a paginated list of public medals according to the requested tab:
//   - latest:    all public medals, newest first
//   - following: public medals from users the viewer follows
//   - popular:   public medals ranked by interaction count (then recency)
//   - similar:   MVP fallback to latest (placeholder for future tag/embedding match)
//   - for-you:   MVP fallback to popular
//
// Each item carries the author summary, interaction counts and the viewer's own
// interaction/follow state. Permission filtering (public-only) happens here so
// the frontend never needs to re-derive visibility.
func (h *FeedHandler) GetFeed(c *gin.Context) {
	viewerID, _ := currentViewerID(c)

	tab := c.DefaultQuery("tab", "latest")
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), defaultPageSize)
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	offset := (page - 1) * pageSize

	// Base query: public medals only.
	base := h.db.Model(&database.Medal{}).Where("visibility = ?", "public")

	switch tab {
	case "following":
		var followingIDs []string
		if viewerID != "" {
			if err := h.db.Model(&database.FollowRelation{}).
				Where("follower_id = ?", viewerID).
				Pluck("following_id", &followingIDs).Error; err != nil {
				h.logger.Error("failed to load following ids", "error", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
				return
			}
		}
		if len(followingIDs) == 0 {
			c.JSON(http.StatusOK, emptyFeed(page, pageSize))
			return
		}
		base = base.Where("user_id IN ?", followingIDs)
	case "similar", "latest", "popular", "for-you":
		// handled below
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tab"})
		return
	}

	// Total count for pagination (before limit/offset).
	var total int64
	if err := base.Count(&total).Error; err != nil {
		h.logger.Error("failed to count feed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	var medals []database.Medal
	query := base.Session(&gorm.Session{})
	if tab == "popular" || tab == "for-you" {
		// Rank by interaction count via a left join, then recency. Use a
		// subquery to count interactions per medal.
		query = query.
			Select("medals.*, COALESCE(ic.cnt, 0) AS interaction_count").
			Joins("LEFT JOIN (SELECT medal_id, COUNT(*) AS cnt FROM medal_interactions GROUP BY medal_id) ic ON ic.medal_id = medals.id").
			Order("interaction_count DESC").
			Order("medals.created_at DESC")
	} else {
		query = query.Order("medals.created_at DESC")
	}

	if err := query.Limit(pageSize).Offset(offset).Find(&medals).Error; err != nil {
		h.logger.Error("failed to query feed medals", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	items, err := h.buildFeedItems(medals, viewerID)
	if err != nil {
		h.logger.Error("failed to build feed items", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, dto.PaginatedFeedResponse{
		Data:     items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

// buildFeedItems enriches medals with author summaries, interaction counts and
// the viewer's own state, using batched queries to avoid N+1.
func (h *FeedHandler) buildFeedItems(medals []database.Medal, viewerID string) ([]dto.FeedItemResponse, error) {
	items := make([]dto.FeedItemResponse, 0, len(medals))
	if len(medals) == 0 {
		return items, nil
	}

	// Collect medal ids and author ids.
	medalIDs := make([]string, len(medals))
	authorIDSet := make(map[string]struct{})
	for i := range medals {
		medalIDs[i] = medals[i].ID
		authorIDSet[medals[i].UserID] = struct{}{}
	}
	authorIDs := make([]string, 0, len(authorIDSet))
	for id := range authorIDSet {
		authorIDs = append(authorIDs, id)
	}

	// Authors.
	authorMap := make(map[string]dto.UserSummary, len(authorIDs))
	var authors []database.User
	if err := h.db.Where("id IN ?", authorIDs).Find(&authors).Error; err != nil {
		return nil, err
	}
	for i := range authors {
		authorMap[authors[i].ID] = toUserSummary(&authors[i])
	}

	// Interaction counts per (medal, type).
	type countRow struct {
		MedalID string
		Type    string
		Count   int
	}
	var crows []countRow
	if err := h.db.Model(&database.MedalInteraction{}).
		Select("medal_id, type, COUNT(*) as count").
		Where("medal_id IN ?", medalIDs).
		Group("medal_id, type").
		Scan(&crows).Error; err != nil {
		return nil, err
	}
	countsByMedal := make(map[string]map[string]int)
	for _, r := range crows {
		if countsByMedal[r.MedalID] == nil {
			countsByMedal[r.MedalID] = make(map[string]int)
		}
		countsByMedal[r.MedalID][r.Type] = r.Count
	}

	// Viewer's own reactions per medal.
	viewerReactions := make(map[string][]string)
	following := make(map[string]bool)
	if viewerID != "" {
		type vrow struct {
			MedalID string
			Type    string
		}
		var vrows []vrow
		if err := h.db.Model(&database.MedalInteraction{}).
			Select("medal_id, type").
			Where("medal_id IN ? AND user_id = ?", medalIDs, viewerID).
			Scan(&vrows).Error; err != nil {
			return nil, err
		}
		for _, r := range vrows {
			viewerReactions[r.MedalID] = append(viewerReactions[r.MedalID], r.Type)
		}

		// Which authors the viewer follows.
		var followedIDs []string
		if err := h.db.Model(&database.FollowRelation{}).
			Where("follower_id = ? AND following_id IN ?", viewerID, authorIDs).
			Pluck("following_id", &followedIDs).Error; err != nil {
			return nil, err
		}
		for _, id := range followedIDs {
			following[id] = true
		}
	}

	for i := range medals {
		m := &medals[i]
		counts := countsByMedal[m.ID]
		if counts == nil {
			counts = map[string]int{}
		}
		reactions := viewerReactions[m.ID]
		if reactions == nil {
			reactions = []string{}
		}
		items = append(items, dto.FeedItemResponse{
			MedalID:         m.ID,
			Title:           m.Title,
			ShortReason:     m.ShortReason,
			MemoryWeight:    m.MemoryWeight,
			ImageURL:        m.ImageURL,
			CreatedAt:       m.CreatedAt,
			Author:          authorMap[m.UserID],
			Counts:          counts,
			ViewerReactions: reactions,
			ViewerFollowing: following[m.UserID],
		})
	}

	return items, nil
}

// --- helpers ---

func parsePositiveInt(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return fallback
	}
	return n
}

func emptyFeed(page, pageSize int) dto.PaginatedFeedResponse {
	return dto.PaginatedFeedResponse{
		Data:     []dto.FeedItemResponse{},
		Total:    0,
		Page:     page,
		PageSize: pageSize,
	}
}
