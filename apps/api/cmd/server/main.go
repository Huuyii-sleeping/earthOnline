package main

import (
	"fmt"
	"log"

	"github.com/earth-online/api/internal/config"
	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/middleware"
	"github.com/earth-online/api/internal/http/router"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	db, err := database.NewPostgres(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect database: %v", err)
	}

	redisClient, err := database.NewRedis(cfg.RedisAddr)
	if err != nil {
		log.Fatalf("failed to connect redis: %v", err)
	}

	// Auto migrate
	if err := database.AutoMigrate(db); err != nil {
		log.Fatalf("failed to auto migrate: %v", err)
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	r.Use(middleware.Cors())

	router.Setup(r, db, redisClient, cfg)

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("Server starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}
