package router

import (
	"log/slog"
	"os"

	"github.com/earth-online/api/internal/config"
	"github.com/earth-online/api/internal/http/handlers"
	"github.com/earth-online/api/internal/http/middleware"
	"github.com/earth-online/api/internal/integrations/agent"
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

	// Handlers
	authHandler := handlers.NewAuthHandler(db, redisClient, cfg, logger)
	userHandler := handlers.NewUserHandler(db, logger)
	experienceHandler := handlers.NewExperienceHandler(db, logger)
	conversationHandler := handlers.NewConversationHandler(db, agentClient, logger)

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
	}
}