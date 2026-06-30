package handlers

import (
	"encoding/json"
	"log/slog"

	"github.com/earth-online/api/internal/database"
	"gorm.io/gorm"
)

// writeNotification persists a notification on a best-effort basis. A failure
// here must never roll back or fail the triggering action (follow, interaction,
// friend request), so the error is logged and swallowed.
//
// Callers should skip self-notifications (e.g. interacting with your own medal)
// before invoking this helper.
func writeNotification(db *gorm.DB, logger *slog.Logger, userID, notifType, title string, body, data *string) {
	n := database.Notification{
		UserID: userID,
		Type:   notifType,
		Title:  title,
		Body:   body,
		Data:   data,
	}
	if err := db.Create(&n).Error; err != nil {
		logger.Error("failed to write notification", "error", err, "user_id", userID, "type", notifType)
	}
}

// jsonData marshals a payload map into a JSON string suitable for the
// notification Data column. It returns nil when marshalling fails or the map is
// empty, so callers can pass the result straight through to writeNotification
// without risking malformed JSON (safer than hand-building JSON with Sprintf).
func jsonData(payload map[string]string) *string {
	if len(payload) == 0 {
		return nil
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return nil
	}
	s := string(b)
	return &s
}
