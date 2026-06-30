package main

import (
	"fmt"
	"log"
	"strings"

	"github.com/earth-online/api/internal/config"
	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/http/middleware"
	"github.com/earth-online/api/internal/http/router"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	cfg := config.Load()

	// Connect to database — auto-detect SQLite vs PostgreSQL
	var db *gorm.DB
	var err error

	if strings.HasPrefix(cfg.DatabaseURL, "sqlite") {
		dbPath := strings.TrimPrefix(strings.TrimPrefix(cfg.DatabaseURL, "sqlite://"), "sqlite:")
		if dbPath == "" {
			dbPath = "earth_online.db"
		}
		db, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Info),
		})
		if err != nil {
			log.Fatalf("failed to connect sqlite: %v", err)
		}
		log.Println("Connected to SQLite")
	} else {
		db, err = gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Info),
		})
		if err != nil {
			log.Fatalf("failed to connect postgres: %v", err)
		}
		log.Println("Connected to PostgreSQL")
	}

	// Redis is optional — degrade gracefully if not available
	redisClient, redisErr := database.NewRedis(cfg.RedisAddr)
	if redisErr != nil {
		log.Printf("Warning: Redis not available, some features may not work: %v", redisErr)
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
