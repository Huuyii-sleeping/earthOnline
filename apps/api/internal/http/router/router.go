package router

import (
	"log/slog"
	"os"

	"github.com/earth-online/api/internal/config"
	"github.com/earth-online/api/internal/domain/growthprofile"
	"github.com/earth-online/api/internal/domain/stagesummary"
	"github.com/earth-online/api/internal/domain/yearreview"
	"github.com/earth-online/api/internal/http/handlers"
	"github.com/earth-online/api/internal/http/middleware"
	"github.com/earth-online/api/internal/integrations/agent"
	"github.com/earth-online/api/internal/integrations/taskqueue"
	"github.com/earth-online/api/internal/storage"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// Setup registers all routes on the given gin.Engine.
func Setup(r *gin.Engine, db *gorm.DB, redisClient *redis.Client, cfg *config.Config) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// Middleware
	r.Use(middleware.RequestLogger(logger))

	// Health check (public)
	healthHandler := handlers.NewHealthHandler(db)
	r.GET("/healthz", healthHandler.Healthz)
	r.GET("/readyz", healthHandler.Readyz)

	// Agent integration client
	agentClient := agent.NewClient(cfg.AgentServiceURL, logger)

	// Background task queue (best-effort growth profile refresh, etc.).
	// When Redis is unavailable this becomes a no-op client so the API still
	// serves normally; only async profile refresh is affected.
	taskQueueClient := taskqueue.NewClient(cfg.RedisAddr, logger)

	// MinIO client
	minioClient, err := storage.NewMinIOClient(cfg.S3Endpoint, cfg.S3AccessKeyID, cfg.S3SecretAccessKey, cfg.S3Bucket, logger)
	if err != nil {
		logger.Error("failed to initialize minio client", "error", err)
		os.Exit(1)
	}

	// Handlers
	authHandler := handlers.NewAuthHandler(db, redisClient, cfg, logger)
	userHandler := handlers.NewUserHandler(db, logger)
	experienceHandler := handlers.NewExperienceHandler(db, logger)
	conversationHandler := handlers.NewConversationHandler(db, agentClient, logger)
	medalHandler := handlers.NewMedalHandler(db, agentClient, taskQueueClient, logger)
	assetHandler := handlers.NewAssetHandler(db, minioClient, logger)
	profileHandler := handlers.NewProfileHandler(db, logger)
	socialHandler := handlers.NewSocialHandler(db, logger)
	feedHandler := handlers.NewFeedHandler(db, logger)
	notificationHandler := handlers.NewNotificationHandler(db, logger)
	stageSummaryService := stagesummary.NewService(db, agentClient, logger)
	stageSummaryHandler := handlers.NewStageSummaryHandler(db, stageSummaryService, taskQueueClient, logger)
	agentProfileHandler := handlers.NewAgentProfileHandler(db, logger)
	growthProfileService := growthprofile.NewService(db, agentClient, logger)
	growthProfileHandler := handlers.NewGrowthProfileHandler(db, growthProfileService, logger)
	yearReviewService := yearreview.NewService(db, agentClient, logger)
	yearReviewHandler := handlers.NewYearReviewHandler(db, yearReviewService, taskQueueClient, logger)

	api := r.Group("/api/v1")

	// Public routes
	authPublic := api.Group("/auth")
	{
		authPublic.POST("/register", authHandler.Register)
		authPublic.POST("/login", authHandler.Login)
		authPublic.POST("/refresh", authHandler.Refresh)
	}

	// Authenticated routes
	authRequired := api.Group("")
	authRequired.Use(middleware.AuthMiddleware(cfg))
	{
		// Auth & user
		authRequired.POST("/auth/logout", authHandler.Logout)
		authRequired.GET("/me", authHandler.GetMe)
		authRequired.PUT("/me", userHandler.UpdateMe)

		// Profile (M5)
		authRequired.GET("/me/profile", profileHandler.GetMyProfile)
		authRequired.PUT("/me/profile", profileHandler.UpdateMyProfile)
		authRequired.GET("/me/medals", profileHandler.GetMyMedals)
		authRequired.GET("/users/:id/profile", profileHandler.GetUserProfile)
		authRequired.GET("/users/:id/medals", profileHandler.GetUserMedals)

		// Experiences
		authRequired.POST("/experiences", experienceHandler.CreateExperience)
		authRequired.GET("/experiences", experienceHandler.ListExperiences)
		authRequired.GET("/experiences/:id", experienceHandler.GetExperience)
		authRequired.PUT("/experiences/:id", experienceHandler.UpdateExperience)

		// Conversation sessions
		authRequired.POST("/experiences/:id/sessions", conversationHandler.CreateSession)
		authRequired.GET("/sessions/:id/messages", conversationHandler.ListMessages)
		authRequired.POST("/sessions/:id/messages", conversationHandler.SendMessage)
		authRequired.POST("/sessions/:id/summary", conversationHandler.GenerateSummary)

		// Agent SSE proxy
		authRequired.GET("/agent/sessions/:id/stream", conversationHandler.StreamSession)

		// Medals
		authRequired.POST("/experiences/:id/medals/generate", medalHandler.GenerateMedal)
		authRequired.GET("/medals", medalHandler.ListMedals)
		authRequired.GET("/medals/:id", medalHandler.GetMedal)
		authRequired.PUT("/medals/:id", medalHandler.UpdateMedal)
		authRequired.POST("/medals/:id/regenerate/meaning", medalHandler.RegenerateMeaning)
		authRequired.PUT("/medals/:id/visibility", profileHandler.UpdateMedalVisibility)
		authRequired.GET("/medals/:id/versions", medalHandler.ListVersions)
		authRequired.POST("/medals/:id/versions/:vid/restore", medalHandler.RestoreVersion)

		// Assets (M4)
		authRequired.POST("/assets/presign", assetHandler.PresignUpload)
		authRequired.POST("/assets", assetHandler.CreateAsset)
		authRequired.GET("/assets/:id", assetHandler.GetAsset)

		// Social — interactions (M6.1)
		authRequired.POST("/medals/:id/interactions", socialHandler.CreateInteraction)
		authRequired.DELETE("/medals/:id/interactions/:type", socialHandler.DeleteInteraction)

		// Social — follows / friends (M6.2)
		authRequired.POST("/users/:id/follow", socialHandler.FollowUser)
		authRequired.DELETE("/users/:id/follow", socialHandler.UnfollowUser)
		authRequired.GET("/me/following", socialHandler.ListFollowing)
		authRequired.GET("/me/followers", socialHandler.ListFollowers)
		authRequired.POST("/friends/:id/request", socialHandler.RequestFriend)
		authRequired.POST("/friends/:id/accept", socialHandler.AcceptFriend)
		authRequired.POST("/friends/:id/reject", socialHandler.RejectFriend)
		authRequired.GET("/me/friends", socialHandler.ListFriends)

		// Feed (M6.3)
		authRequired.GET("/feed", feedHandler.GetFeed)

		// Notifications (M6.4)
		authRequired.GET("/notifications", notificationHandler.ListNotifications)
		authRequired.GET("/notifications/unread-count", notificationHandler.UnreadCount)
		authRequired.POST("/notifications/:id/read", notificationHandler.MarkRead)
		authRequired.POST("/notifications/read-all", notificationHandler.MarkAllRead)

		// Stage summaries (M7)
		authRequired.POST("/stage-summaries/generate", stageSummaryHandler.GenerateStageSummary)
		authRequired.GET("/stage-summaries", stageSummaryHandler.ListStageSummaries)
		authRequired.GET("/stage-summaries/:id", stageSummaryHandler.GetStageSummary)

		// Agent profile (M7)
		authRequired.GET("/agent-profile", agentProfileHandler.GetAgentProfile)
		authRequired.PUT("/agent-profile", agentProfileHandler.UpdateAgentProfile)

		// Growth profile (M8)
		authRequired.GET("/growth-profile", growthProfileHandler.GetGrowthProfile)
		authRequired.POST("/growth-profile/refresh", growthProfileHandler.RefreshGrowthProfile)
		authRequired.GET("/growth-insights", growthProfileHandler.ListGrowthInsights)

		// Annual reviews (M9)
		authRequired.GET("/annual-reviews", yearReviewHandler.ListYearReviews)
		authRequired.GET("/annual-reviews/:year", yearReviewHandler.GetYearReview)
		authRequired.POST("/annual-reviews/generate", yearReviewHandler.GenerateYearReview)
		authRequired.DELETE("/annual-reviews/:year", yearReviewHandler.DeleteYearReview)
	}
}
