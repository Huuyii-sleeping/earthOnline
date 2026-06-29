package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type HealthHandler struct {
	db *gorm.DB
}

func NewHealthHandler(db *gorm.DB) HealthHandler {
	return HealthHandler{db: db}
}

func (handler HealthHandler) Healthz(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, gin.H{
		"service": "api",
		"status":  "ok",
	})
}

func (handler HealthHandler) Readyz(ctx *gin.Context) {
	sqlDB, err := handler.db.DB()
	if err != nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
		return
	}

	if err := sqlDB.PingContext(ctx.Request.Context()); err != nil {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"service": "api",
		"status":  "ready",
	})
}
