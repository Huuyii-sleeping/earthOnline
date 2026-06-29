package database

import "gorm.io/gorm"

func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&User{},
		&AgentProfile{},
		&Experience{},
		&ConversationSession{},
		&ConversationMessage{},
		&Asset{},
		&Medal{},
		&MedalVersion{},
		&MedalVisibility{},
		&MedalInteraction{},
		&FollowRelation{},
		&FriendRelation{},
		&Notification{},
		&GenerationJob{},
	)
}
