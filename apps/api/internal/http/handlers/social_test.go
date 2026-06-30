package handlers

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/earth-online/api/internal/database"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupTestDB spins up an in-memory SQLite database with the schema migrated.
// The models use Postgres-flavored column types, but SQLite's type affinity
// tolerates unknown type names, and Base.BeforeCreate always assigns the UUID
// so the uuid_generate_v4() default never needs to fire.
func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	return db
}

// newTestRouter wires the social/feed/notification handlers behind a middleware
// that injects the given viewer id, mimicking the auth middleware.
func newTestRouter(db *gorm.DB, viewerID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	logger := slog.New(slog.NewTextHandler(bytes.NewBuffer(nil), nil))
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if viewerID != "" {
			c.Set("user_id", viewerID)
		}
		c.Next()
	})

	social := NewSocialHandler(db, logger)
	feed := NewFeedHandler(db, logger)
	notif := NewNotificationHandler(db, logger)

	r.POST("/medals/:id/interactions", social.CreateInteraction)
	r.DELETE("/medals/:id/interactions/:type", social.DeleteInteraction)
	r.POST("/users/:id/follow", social.FollowUser)
	r.DELETE("/users/:id/follow", social.UnfollowUser)
	r.POST("/friends/:id/request", social.RequestFriend)
	r.POST("/friends/:id/accept", social.AcceptFriend)
	r.POST("/friends/:id/reject", social.RejectFriend)
	r.GET("/me/friends", social.ListFriends)
	r.GET("/feed", feed.GetFeed)
	r.GET("/notifications", notif.ListNotifications)
	r.GET("/notifications/unread-count", notif.UnreadCount)
	return r
}

func createUser(t *testing.T, db *gorm.DB, nickname string) database.User {
	t.Helper()
	u := database.User{Account: nickname, Nickname: nickname, Password: "x"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func createMedal(t *testing.T, db *gorm.DB, userID, title, visibility string) database.Medal {
	t.Helper()
	m := database.Medal{
		UserID:       userID,
		ExperienceID: "00000000-0000-0000-0000-000000000000", // placeholder; FK not enforced in sqlite
		Title:        title,
		ShortReason:  "reason",
		MemoryWeight: "medium",
		Visibility:   visibility,
	}
	if err := db.Create(&m).Error; err != nil {
		t.Fatalf("create medal: %v", err)
	}
	return m
}

func doJSON(t *testing.T, r *gin.Engine, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// --- Interactions ---

func TestCreateInteractionIdempotent(t *testing.T) {
	db := setupTestDB(t)
	author := createUser(t, db, "author")
	viewer := createUser(t, db, "viewer")
	medal := createMedal(t, db, author.ID, "Medal", "public")

	r := newTestRouter(db, viewer.ID)

	// First applaud.
	w := doJSON(t, r, http.MethodPost, "/medals/"+medal.ID+"/interactions", map[string]string{"type": "applaud"})
	if w.Code != http.StatusOK {
		t.Fatalf("first interaction: want 200, got %d (%s)", w.Code, w.Body.String())
	}
	// Repeat the same applaud — should remain a single row.
	w = doJSON(t, r, http.MethodPost, "/medals/"+medal.ID+"/interactions", map[string]string{"type": "applaud"})
	if w.Code != http.StatusOK {
		t.Fatalf("repeat interaction: want 200, got %d (%s)", w.Code, w.Body.String())
	}

	var count int64
	db.Model(&database.MedalInteraction{}).
		Where("medal_id = ? AND user_id = ? AND type = ?", medal.ID, viewer.ID, "applaud").
		Count(&count)
	if count != 1 {
		t.Fatalf("idempotency broken: want 1 interaction row, got %d", count)
	}

	// The author should have exactly one notification.
	var notifCount int64
	db.Model(&database.Notification{}).Where("user_id = ?", author.ID).Count(&notifCount)
	if notifCount != 1 {
		t.Fatalf("want 1 notification for author, got %d", notifCount)
	}
}

func TestInteractionRejectsPrivateMedal(t *testing.T) {
	db := setupTestDB(t)
	author := createUser(t, db, "author")
	viewer := createUser(t, db, "viewer")
	medal := createMedal(t, db, author.ID, "Private", "private")

	r := newTestRouter(db, viewer.ID)
	w := doJSON(t, r, http.MethodPost, "/medals/"+medal.ID+"/interactions", map[string]string{"type": "applaud"})
	if w.Code != http.StatusForbidden {
		t.Fatalf("private medal interaction: want 403, got %d (%s)", w.Code, w.Body.String())
	}
}

// --- Follows ---

func TestCannotFollowSelf(t *testing.T) {
	db := setupTestDB(t)
	user := createUser(t, db, "solo")
	r := newTestRouter(db, user.ID)

	w := doJSON(t, r, http.MethodPost, "/users/"+user.ID+"/follow", nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("self-follow: want 400, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestFollowIsIdempotentAndNotifies(t *testing.T) {
	db := setupTestDB(t)
	a := createUser(t, db, "follower")
	b := createUser(t, db, "followee")
	r := newTestRouter(db, a.ID)

	for i := 0; i < 2; i++ {
		w := doJSON(t, r, http.MethodPost, "/users/"+b.ID+"/follow", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("follow #%d: want 200, got %d (%s)", i, w.Code, w.Body.String())
		}
	}

	var followCount int64
	db.Model(&database.FollowRelation{}).
		Where("follower_id = ? AND following_id = ?", a.ID, b.ID).Count(&followCount)
	if followCount != 1 {
		t.Fatalf("want 1 follow row, got %d", followCount)
	}

	var notifCount int64
	db.Model(&database.Notification{}).Where("user_id = ? AND type = ?", b.ID, "follow").Count(&notifCount)
	if notifCount != 1 {
		t.Fatalf("want 1 follow notification, got %d", notifCount)
	}
}

// --- Friends state machine ---

func TestFriendStateMachine(t *testing.T) {
	db := setupTestDB(t)
	requester := createUser(t, db, "requester")
	addressee := createUser(t, db, "addressee")

	// Requester sends a request.
	rReq := newTestRouter(db, requester.ID)
	w := doJSON(t, rReq, http.MethodPost, "/friends/"+addressee.ID+"/request", nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("friend request: want 201, got %d (%s)", w.Code, w.Body.String())
	}
	var fr database.FriendRelation
	if err := db.Where("requester_id = ? AND addressee_id = ?", requester.ID, addressee.ID).First(&fr).Error; err != nil {
		t.Fatalf("friendship not created: %v", err)
	}
	if fr.Status != "pending" {
		t.Fatalf("want pending, got %s", fr.Status)
	}

	// Requester cannot accept their own request.
	w = doJSON(t, rReq, http.MethodPost, "/friends/"+fr.ID+"/accept", nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("requester accept: want 403, got %d (%s)", w.Code, w.Body.String())
	}

	// Addressee accepts.
	rAddr := newTestRouter(db, addressee.ID)
	w = doJSON(t, rAddr, http.MethodPost, "/friends/"+fr.ID+"/accept", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("addressee accept: want 200, got %d (%s)", w.Code, w.Body.String())
	}
	db.First(&fr, "id = ?", fr.ID)
	if fr.Status != "accepted" {
		t.Fatalf("want accepted, got %s", fr.Status)
	}

	// Accepting again should conflict (no longer pending).
	w = doJSON(t, rAddr, http.MethodPost, "/friends/"+fr.ID+"/accept", nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("re-accept: want 409, got %d (%s)", w.Code, w.Body.String())
	}

	// Requester should have an accept notification.
	var notifCount int64
	db.Model(&database.Notification{}).Where("user_id = ? AND type = ?", requester.ID, "friend_accept").Count(&notifCount)
	if notifCount != 1 {
		t.Fatalf("want 1 friend_accept notification, got %d", notifCount)
	}
}

// TestRejectedFriendshipCanBeReopened verifies a rejected request does not lock
// the two users out permanently: a new request reopens the relationship as
// pending rather than returning the stale rejected row.
func TestRejectedFriendshipCanBeReopened(t *testing.T) {
	db := setupTestDB(t)
	requester := createUser(t, db, "requester")
	addressee := createUser(t, db, "addressee")

	// Request, then reject.
	rReq := newTestRouter(db, requester.ID)
	doJSON(t, rReq, http.MethodPost, "/friends/"+addressee.ID+"/request", nil)
	var fr database.FriendRelation
	db.Where("requester_id = ? AND addressee_id = ?", requester.ID, addressee.ID).First(&fr)

	rAddr := newTestRouter(db, addressee.ID)
	w := doJSON(t, rAddr, http.MethodPost, "/friends/"+fr.ID+"/reject", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("reject: want 200, got %d (%s)", w.Code, w.Body.String())
	}

	// Re-request should reopen as pending, not return the rejected row.
	w = doJSON(t, rReq, http.MethodPost, "/friends/"+addressee.ID+"/request", nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("re-request: want 201, got %d (%s)", w.Code, w.Body.String())
	}

	// There should still be exactly one friendship row, now pending.
	var count int64
	db.Model(&database.FriendRelation{}).Count(&count)
	if count != 1 {
		t.Fatalf("want 1 friendship row after reopen, got %d", count)
	}
	db.First(&fr, "id = ?", fr.ID)
	if fr.Status != "pending" {
		t.Fatalf("want reopened status pending, got %s", fr.Status)
	}
}

// --- Feed visibility ---

func TestFeedLatestExcludesPrivate(t *testing.T) {
	db := setupTestDB(t)
	author := createUser(t, db, "author")
	viewer := createUser(t, db, "viewer")
	createMedal(t, db, author.ID, "PublicMedal", "public")
	createMedal(t, db, author.ID, "PrivateMedal", "private")

	r := newTestRouter(db, viewer.ID)
	w := doJSON(t, r, http.MethodGet, "/feed?tab=latest", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("feed: want 200, got %d (%s)", w.Code, w.Body.String())
	}

	var resp struct {
		Data []struct {
			Title string `json:"title"`
		} `json:"data"`
		Total int64 `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode feed: %v", err)
	}
	if resp.Total != 1 || len(resp.Data) != 1 {
		t.Fatalf("want exactly 1 public medal, got total=%d len=%d", resp.Total, len(resp.Data))
	}
	if resp.Data[0].Title != "PublicMedal" {
		t.Fatalf("want PublicMedal, got %s", resp.Data[0].Title)
	}
}

func TestFeedFollowingEmptyWhenNoFollows(t *testing.T) {
	db := setupTestDB(t)
	author := createUser(t, db, "author")
	viewer := createUser(t, db, "viewer")
	createMedal(t, db, author.ID, "PublicMedal", "public")

	r := newTestRouter(db, viewer.ID)
	w := doJSON(t, r, http.MethodGet, "/feed?tab=following", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("feed following: want 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Total int64 `json:"total"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Total != 0 {
		t.Fatalf("want empty following feed, got total=%d", resp.Total)
	}
}

// TestFeedPopularOrdersByInteractions exercises the popular tab's Select +
// LEFT JOIN + ORDER BY path and verifies medals are ranked by interaction count
// (ahead of recency). This also guards against the GORM pitfall of reusing a
// builder after Count.
func TestFeedPopularOrdersByInteractions(t *testing.T) {
	db := setupTestDB(t)
	author := createUser(t, db, "author")
	r1 := createUser(t, db, "r1")
	r2 := createUser(t, db, "r2")
	viewer := createUser(t, db, "viewer")

	low := createMedal(t, db, author.ID, "LowEngagement", "public")
	high := createMedal(t, db, author.ID, "HighEngagement", "public")

	// Give "high" two interactions, "low" none.
	doJSON(t, newTestRouter(db, r1.ID), http.MethodPost, "/medals/"+high.ID+"/interactions", map[string]string{"type": "applaud"})
	doJSON(t, newTestRouter(db, r2.ID), http.MethodPost, "/medals/"+high.ID+"/interactions", map[string]string{"type": "brave"})
	_ = low

	w := doJSON(t, newTestRouter(db, viewer.ID), http.MethodGet, "/feed?tab=popular", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("feed popular: want 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Data []struct {
			Title string `json:"title"`
		} `json:"data"`
		Total int64 `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode popular feed: %v", err)
	}
	if resp.Total != 2 || len(resp.Data) != 2 {
		t.Fatalf("want 2 medals, got total=%d len=%d", resp.Total, len(resp.Data))
	}
	if resp.Data[0].Title != "HighEngagement" {
		t.Fatalf("want HighEngagement ranked first, got %s", resp.Data[0].Title)
	}
}

// --- Notifications ---

func TestNotificationsListedForRecipient(t *testing.T) {
	db := setupTestDB(t)
	author := createUser(t, db, "author")
	viewer := createUser(t, db, "viewer")
	medal := createMedal(t, db, author.ID, "Medal", "public")

	// Viewer applauds -> author gets a notification.
	rViewer := newTestRouter(db, viewer.ID)
	doJSON(t, rViewer, http.MethodPost, "/medals/"+medal.ID+"/interactions", map[string]string{"type": "brave"})

	// Author lists notifications.
	rAuthor := newTestRouter(db, author.ID)
	w := doJSON(t, rAuthor, http.MethodGet, "/notifications", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list notifications: want 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Data []struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		} `json:"data"`
		Total int64 `json:"total"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Total != 1 {
		t.Fatalf("want 1 notification, got %d", resp.Total)
	}

	// The data payload must be a parseable JSON object carrying medal_id (guards
	// the jsonData helper against emitting a quoted string or malformed JSON).
	var payload struct {
		MedalID string `json:"medal_id"`
		Type    string `json:"type"`
	}
	if err := json.Unmarshal(resp.Data[0].Data, &payload); err != nil {
		t.Fatalf("notification data is not valid JSON object: %v (%s)", err, resp.Data[0].Data)
	}
	if payload.MedalID != medal.ID || payload.Type != "brave" {
		t.Fatalf("unexpected data payload: medal_id=%s type=%s", payload.MedalID, payload.Type)
	}

	// Unread count should be 1.
	w = doJSON(t, rAuthor, http.MethodGet, "/notifications/unread-count", nil)
	var ur struct {
		Data struct {
			Unread int64 `json:"unread"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &ur)
	if ur.Data.Unread != 1 {
		t.Fatalf("want unread=1, got %d", ur.Data.Unread)
	}
}
