package handlers

import (
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/domain/growthprofile"
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

	// similar recommendation tuning: we score a bounded candidate window in
	// memory then paginate the scored slice. Kept conservative for M8 volumes.
	similarCandidateMultiplier = 5
	similarCandidateMax        = 200
)

// GetFeed handles GET /feed?tab=&page=&page_size=
//
// Returns a paginated list of public medals according to the requested tab:
//   - latest:    all public medals, newest first
//   - following: public medals from users the viewer follows
//   - popular:   public medals ranked by interaction count (then recency)
//   - similar:   ranked by overlap with the viewer's growth profile keywords
//   - for-you:   blended weighted ordering of following + popular + recency
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
	case "similar":
		items, total, err := h.similarFeed(viewerID, page, pageSize, offset)
		if err != nil {
			h.logger.Error("failed to build similar feed", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			return
		}
		c.JSON(http.StatusOK, dto.PaginatedFeedResponse{Data: items, Total: total, Page: page, PageSize: pageSize})
		return
	case "for-you":
		items, total, err := h.forYouFeed(viewerID, page, pageSize, offset)
		if err != nil {
			h.logger.Error("failed to build for-you feed", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			return
		}
		c.JSON(http.StatusOK, dto.PaginatedFeedResponse{Data: items, Total: total, Page: page, PageSize: pageSize})
		return
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
	case "latest", "popular":
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
	if tab == "popular" {
		// Rank by interaction count via a left join, then recency.
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

// similarFeed ranks public medals by overlap with the viewer's growth profile
// keywords. Users without a profile fall back to the latest ordering so the tab
// still returns content. Matching is intentionally coarse (substring over title
// + short_reason) per the M8 plan — no embeddings yet.
func (h *FeedHandler) similarFeed(viewerID string, page, pageSize, offset int) ([]dto.FeedItemResponse, int64, error) {
	keywords := h.viewerGrowthKeywords(viewerID)

	base := h.db.Model(&database.Medal{}).Where("visibility = ?", "public")
	if viewerID != "" {
		base = base.Where("user_id <> ?", viewerID)
	}

	// Without a portrait we degrade to latest ordering (still paginated server-side).
	if len(keywords) == 0 {
		var total int64
		if err := base.Count(&total).Error; err != nil {
			return nil, 0, err
		}
		var medals []database.Medal
		if err := base.Order("medals.created_at DESC").Limit(pageSize).Offset(offset).Find(&medals).Error; err != nil {
			return nil, 0, err
		}
		items, err := h.buildFeedItems(medals, viewerID)
		return items, total, err
	}

	// With a portrait we score a candidate window in memory, then paginate the
	// scored slice. The window is bounded so this stays cheap for M8 volumes.
	candidateLimit := pageSize * similarCandidateMultiplier
	if candidateLimit > similarCandidateMax {
		candidateLimit = similarCandidateMax
	}
	var candidates []database.Medal
	if err := base.Order("medals.created_at DESC").Limit(candidateLimit).Find(&candidates).Error; err != nil {
		return nil, 0, err
	}

	type scored struct {
		medal database.Medal
		score int
	}
	scoredItems := make([]scored, 0, len(candidates))
	for i := range candidates {
		scoredItems = append(scoredItems, scored{medal: candidates[i], score: scoreMedalByKeywords(candidates[i], keywords)})
	}
	sort.SliceStable(scoredItems, func(i, j int) bool {
		if scoredItems[i].score != scoredItems[j].score {
			return scoredItems[i].score > scoredItems[j].score
		}
		return scoredItems[i].medal.CreatedAt.After(scoredItems[j].medal.CreatedAt)
	})

	total := int64(len(scoredItems))
	if offset >= len(scoredItems) {
		return []dto.FeedItemResponse{}, total, nil
	}
	end := offset + pageSize
	if end > len(scoredItems) {
		end = len(scoredItems)
	}
	medals := make([]database.Medal, 0, end-offset)
	for _, s := range scoredItems[offset:end] {
		medals = append(medals, s.medal)
	}
	items, err := h.buildFeedItems(medals, viewerID)
	return items, total, err
}

// forYouFeed blends following, popular and recency into a single weighted
// ordering. The weighting is deliberately simple per the M8 plan: followed
// authors get a large fixed boost, interactions add a per-count weight, and
// recency breaks ties. Everything is expressed in SQL so pagination stays cheap.
func (h *FeedHandler) forYouFeed(viewerID string, page, pageSize, offset int) ([]dto.FeedItemResponse, int64, error) {
	base := h.db.Model(&database.Medal{}).Where("visibility = ?", "public")
	if viewerID != "" {
		base = base.Where("user_id <> ?", viewerID)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Load the viewer's followings so we can boost their medals.
	var followingIDs []string
	if viewerID != "" {
		if err := h.db.Model(&database.FollowRelation{}).
			Where("follower_id = ?", viewerID).
			Pluck("following_id", &followingIDs).Error; err != nil {
			return nil, 0, err
		}
	}

	query := base.Session(&gorm.Session{}).
		Select("medals.*, COALESCE(ic.cnt, 0) AS interaction_count").
		Joins("LEFT JOIN (SELECT medal_id, COUNT(*) AS cnt FROM medal_interactions GROUP BY medal_id) ic ON ic.medal_id = medals.id")

	// Followed authors rank first, then most-interacted, then newest.
	if len(followingIDs) > 0 {
		query = query.
			Select("medals.*, COALESCE(ic.cnt, 0) AS interaction_count, CASE WHEN medals.user_id IN (?) THEN 1 ELSE 0 END AS is_following", followingIDs).
			Order("is_following DESC").
			Order("interaction_count DESC").
			Order("medals.created_at DESC")
	} else {
		query = query.
			Order("interaction_count DESC").
			Order("medals.created_at DESC")
	}

	var medals []database.Medal
	if err := query.Limit(pageSize).Offset(offset).Find(&medals).Error; err != nil {
		return nil, 0, err
	}
	items, err := h.buildFeedItems(medals, viewerID)
	return items, total, err
}

// viewerGrowthKeywords loads the viewer's trait + growth keywords merged into a
// deduplicated, normalized slice. Returns nil when there is no profile yet.
func (h *FeedHandler) viewerGrowthKeywords(viewerID string) []string {
	if viewerID == "" {
		return nil
	}
	var profile database.GrowthProfile
	if err := h.db.Select("trait_keywords_json, growth_keywords_json").
		Where("user_id = ?", viewerID).
		First(&profile).Error; err != nil {
		return nil
	}
	return growthprofile.StringsFromJSONFields(profile.TraitKeywordsJSON, profile.GrowthKeywordsJSON)
}

// scoreMedalByKeywords counts how many of the viewer's profile keywords appear
// in the medal's title or short reason. Case-insensitive, substring match.
func scoreMedalByKeywords(medal database.Medal, keywords []string) int {
	if len(keywords) == 0 {
		return 0
	}
	haystack := strings.ToLower(medal.Title + " " + medal.ShortReason)
	score := 0
	for _, kw := range keywords {
		kw = strings.ToLower(strings.TrimSpace(kw))
		if kw == "" {
			continue
		}
		if strings.Contains(haystack, kw) {
			score++
		}
	}
	return score
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
