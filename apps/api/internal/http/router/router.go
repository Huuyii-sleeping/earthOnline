package router

import (
	"log/slog"
	"os"

	"github.com/earth-online/api/internal/config"
	"github.com/earth-online/api/internal/http/handlers"
	"github.com/earth-online/api/internal/http/middleware"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// Setup registers all routes on the given gin.Engine.
// This signature matches the call in cmd/server/main.go:
//
//	router.Setup(r, db, redisClient, cfg)
func Setup(r *gin.Engine, db *gorm.DB, redisClient *redis.Client, cfg *config.Config) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// Middleware
	r.Use(middleware.RequestLogger(logger))

	// Health check (public)
	healthHandler := handlers.NewHealthHandler(db)
	r.GET("/healthz", healthHandler.Healthz)
	r.GET("/readyz", healthHandler.Readyz)

	// Handlers
	authHandler := handlers.NewAuthHandler(db, redisClient, cfg, logger)
	userHandler := handlers.NewUserHandler(db, logger)

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
		authRequired.POST("/auth/logout", authHandler.Logout)
		authRequired.GET("/me", authHandler.GetMe)
		authRequired.PUT("/me", userHandler.UpdateMe)
	}
}
