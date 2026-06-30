package handlers

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// --- Follows ---

// FollowUser handles POST /users/:id/follow
//
// Idempotently creates a follow edge from the current viewer to the target
// user. Self-follow is rejected. A notification is written to the target on a
// best-effort basis when a new edge is created.
func (h *SocialHandler) FollowUser(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	targetID := c.Param("id")

	if targetID == viewerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot follow yourself"})
		return
	}

	// Ensure the target user exists.
	var target database.User
	if err := h.db.First(&target, "id = ?", targetID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		h.logger.Error("failed to query user", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	follow := database.FollowRelation{FollowerID: viewerID, FollowingID: targetID}
	result := h.db.Where(database.FollowRelation{
		FollowerID:  viewerID,
		FollowingID: targetID,
	}).FirstOrCreate(&follow)
	if result.Error != nil {
		h.logger.Error("failed to create follow", "error", result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to follow"})
		return
	}

	if result.RowsAffected > 0 {
		var viewer database.User
		actor := "有人"
		if err := h.db.First(&viewer, "id = ?", viewerID).Error; err == nil {
			actor = viewer.Nickname
		}
		body := fmt.Sprintf("%s 关注了你", actor)
		data := jsonData(map[string]string{"user_id": viewerID})
		writeNotification(h.db, h.logger, targetID, "follow", "新的关注者", &body, data)
	}

	h.respondFollowStatus(c, viewerID, targetID, true)
}

// UnfollowUser handles DELETE /users/:id/follow
//
// Removes the follow edge from the viewer to the target. Idempotent.
func (h *SocialHandler) UnfollowUser(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	targetID := c.Param("id")

	if err := h.db.Where(
		"follower_id = ? AND following_id = ?", viewerID, targetID,
	).Delete(&database.FollowRelation{}).Error; err != nil {
		h.logger.Error("failed to delete follow", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to unfollow"})
		return
	}

	h.respondFollowStatus(c, viewerID, targetID, false)
}

// ListFollowing handles GET /me/following — users the viewer follows.
func (h *SocialHandler) ListFollowing(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var ids []string
	if err := h.db.Model(&database.FollowRelation{}).
		Where("follower_id = ?", viewerID).
		Pluck("following_id", &ids).Error; err != nil {
		h.logger.Error("failed to list following", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": h.userSummaries(ids)})
}

// ListFollowers handles GET /me/followers — users following the viewer.
func (h *SocialHandler) ListFollowers(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var ids []string
	if err := h.db.Model(&database.FollowRelation{}).
		Where("following_id = ?", viewerID).
		Pluck("follower_id", &ids).Error; err != nil {
		h.logger.Error("failed to list followers", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": h.userSummaries(ids)})
}

// --- Friends ---

// RequestFriend handles POST /friends/:id/request
//
// Creates a pending friendship from the viewer (requester) to the target
// (addressee). If a friendship already exists in any direction it is returned
// as-is rather than duplicated.
func (h *SocialHandler) RequestFriend(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	targetID := c.Param("id")

	if targetID == viewerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot friend yourself"})
		return
	}

	var target database.User
	if err := h.db.First(&target, "id = ?", targetID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		h.logger.Error("failed to query user", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Look for an existing friendship in either direction.
	existing, found, err := h.findFriendship(viewerID, targetID)
	if err != nil {
		h.logger.Error("failed to query friendship", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if found {
		// A pending or accepted relationship already stands — return it as-is so
		// the request stays idempotent and we never duplicate a live edge.
		// A previously rejected relationship, however, should not lock the two
		// users out forever: reopen it as a fresh pending request from the
		// current viewer (reusing the row to respect the unique index).
		if existing.Status != "rejected" {
			c.JSON(http.StatusOK, gin.H{"data": toFriendResponse(&existing)})
			return
		}
		if err := h.db.Model(&existing).Updates(map[string]interface{}{
			"requester_id": viewerID,
			"addressee_id": targetID,
			"status":       "pending",
		}).Error; err != nil {
			h.logger.Error("failed to reopen friendship", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to send friend request"})
			return
		}
		h.notifyFriendRequest(viewerID, targetID, existing.ID)
		c.JSON(http.StatusCreated, gin.H{"data": toFriendResponse(&existing)})
		return
	}

	friendship := database.FriendRelation{
		RequesterID: viewerID,
		AddresseeID: targetID,
		Status:      "pending",
	}
	if err := h.db.Create(&friendship).Error; err != nil {
		h.logger.Error("failed to create friendship", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to send friend request"})
		return
	}

	h.notifyFriendRequest(viewerID, targetID, friendship.ID)

	c.JSON(http.StatusCreated, gin.H{"data": toFriendResponse(&friendship)})
}

// notifyFriendRequest writes a best-effort friend-request notification to the
// addressee, resolving the requester's nickname for the message body.
func (h *SocialHandler) notifyFriendRequest(requesterID, addresseeID, friendshipID string) {
	var requester database.User
	actor := "有人"
	if err := h.db.First(&requester, "id = ?", requesterID).Error; err == nil {
		actor = requester.Nickname
	}
	body := fmt.Sprintf("%s 申请加你为好友", actor)
	data := jsonData(map[string]string{"friendship_id": friendshipID, "requester_id": requesterID})
	writeNotification(h.db, h.logger, addresseeID, "friend_request", "新的好友申请", &body, data)
}

// AcceptFriend handles POST /friends/:id/accept
//
// The :id is the friendship record id. Only the addressee of a pending request
// may accept it.
func (h *SocialHandler) AcceptFriend(c *gin.Context) {
	h.transitionFriend(c, "accepted")
}

// RejectFriend handles POST /friends/:id/reject
//
// The :id is the friendship record id. Only the addressee of a pending request
// may reject it.
func (h *SocialHandler) RejectFriend(c *gin.Context) {
	h.transitionFriend(c, "rejected")
}

// ListFriends handles GET /me/friends — accepted friendships involving viewer.
func (h *SocialHandler) ListFriends(c *gin.Context) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var friendships []database.FriendRelation
	if err := h.db.Where(
		"(requester_id = ? OR addressee_id = ?) AND status = ?", viewerID, viewerID, "accepted",
	).Order("updated_at DESC").Find(&friendships).Error; err != nil {
		h.logger.Error("failed to list friends", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Resolve the "other" user for each friendship.
	otherIDs := make([]string, 0, len(friendships))
	for i := range friendships {
		other := friendships[i].AddresseeID
		if other == viewerID {
			other = friendships[i].RequesterID
		}
		otherIDs = append(otherIDs, other)
	}
	summaryMap := h.userSummaryMap(otherIDs)

	items := make([]dto.FriendListItem, 0, len(friendships))
	for i := range friendships {
		other := friendships[i].AddresseeID
		if other == viewerID {
			other = friendships[i].RequesterID
		}
		items = append(items, dto.FriendListItem{
			Friendship: toFriendResponse(&friendships[i]),
			User:       summaryMap[other],
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": items})
}

// --- helpers ---

// transitionFriend moves a pending friendship to the given status. Only the
// addressee may perform the transition.
func (h *SocialHandler) transitionFriend(c *gin.Context, newStatus string) {
	viewerID, ok := currentViewerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	friendshipID := c.Param("id")

	var friendship database.FriendRelation
	if err := h.db.First(&friendship, "id = ?", friendshipID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "friend request not found"})
			return
		}
		h.logger.Error("failed to query friendship", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	if friendship.AddresseeID != viewerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the addressee can respond to this request"})
		return
	}
	if friendship.Status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "friend request is not pending"})
		return
	}

	if err := h.db.Model(&friendship).Update("status", newStatus).Error; err != nil {
		h.logger.Error("failed to update friendship", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update friend request"})
		return
	}

	if newStatus == "accepted" {
		var viewer database.User
		actor := "有人"
		if err := h.db.First(&viewer, "id = ?", viewerID).Error; err == nil {
			actor = viewer.Nickname
		}
		body := fmt.Sprintf("%s 接受了你的好友申请", actor)
		data := jsonData(map[string]string{"friendship_id": friendship.ID})
		writeNotification(h.db, h.logger, friendship.RequesterID, "friend_accept", "好友申请已通过", &body, data)
	}

	c.JSON(http.StatusOK, gin.H{"data": toFriendResponse(&friendship)})
}

// findFriendship returns any friendship between two users regardless of
// direction.
func (h *SocialHandler) findFriendship(a, b string) (database.FriendRelation, bool, error) {
	var fr database.FriendRelation
	err := h.db.Where(
		"(requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)",
		a, b, b, a,
	).First(&fr).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fr, false, nil
	}
	if err != nil {
		return fr, false, err
	}
	return fr, true, nil
}

// respondFollowStatus writes the current follow relationship and counts.
func (h *SocialHandler) respondFollowStatus(c *gin.Context, viewerID, targetID string, following bool) {
	var followerCount, followingCount int64
	h.db.Model(&database.FollowRelation{}).Where("following_id = ?", targetID).Count(&followerCount)
	h.db.Model(&database.FollowRelation{}).Where("follower_id = ?", targetID).Count(&followingCount)

	c.JSON(http.StatusOK, gin.H{"data": dto.FollowStatusResponse{
		UserID:         targetID,
		Following:      following,
		FollowerCount:  followerCount,
		FollowingCount: followingCount,
	}})
}

// userSummaries loads user summaries for the given ids, preserving no specific
// order.
func (h *SocialHandler) userSummaries(ids []string) []dto.UserSummary {
	if len(ids) == 0 {
		return []dto.UserSummary{}
	}
	var users []database.User
	if err := h.db.Where("id IN ?", ids).Find(&users).Error; err != nil {
		h.logger.Error("failed to load user summaries", "error", err)
		return []dto.UserSummary{}
	}
	out := make([]dto.UserSummary, 0, len(users))
	for i := range users {
		out = append(out, toUserSummary(&users[i]))
	}
	return out
}

// userSummaryMap loads user summaries keyed by id.
func (h *SocialHandler) userSummaryMap(ids []string) map[string]dto.UserSummary {
	m := make(map[string]dto.UserSummary, len(ids))
	if len(ids) == 0 {
		return m
	}
	var users []database.User
	if err := h.db.Where("id IN ?", ids).Find(&users).Error; err != nil {
		h.logger.Error("failed to load user summaries", "error", err)
		return m
	}
	for i := range users {
		m[users[i].ID] = toUserSummary(&users[i])
	}
	return m
}

func toUserSummary(u *database.User) dto.UserSummary {
	return dto.UserSummary{
		ID:        u.ID,
		Nickname:  u.Nickname,
		AvatarURL: u.AvatarURL,
		Bio:       u.Bio,
	}
}

func toFriendResponse(f *database.FriendRelation) dto.FriendRequestResponse {
	return dto.FriendRequestResponse{
		ID:          f.ID,
		RequesterID: f.RequesterID,
		AddresseeID: f.AddresseeID,
		Status:      f.Status,
		CreatedAt:   f.CreatedAt,
		UpdatedAt:   f.UpdatedAt,
	}
}
