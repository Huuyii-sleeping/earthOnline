package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/earth-online/api/internal/config"
	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/domain/auth"
	"github.com/earth-online/api/internal/http/dto"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

type AuthHandler struct {
	db            *gorm.DB
	redis         *redis.Client
	cfg           *config.Config
	logger        *slog.Logger
	accessSecret  []byte
	refreshSecret []byte
}

func NewAuthHandler(db *gorm.DB, redisClient *redis.Client, cfg *config.Config, logger *slog.Logger) *AuthHandler {
	return &AuthHandler{
		db:            db,
		redis:         redisClient,
		cfg:           cfg,
		logger:        logger,
		accessSecret:  []byte(cfg.JWTAccessSecret),
		refreshSecret: []byte(cfg.JWTRefreshSecret),
	}
}

// generateTokens creates access_token (15min) and refresh_token (7d) for a user.
func (h *AuthHandler) generateTokens(userID string) (accessToken, refreshToken string, err error) {
	now := time.Now()

	// Access token: 15 minutes
	accessClaims := jwt.MapClaims{
		"user_id": userID,
		"exp":     now.Add(15 * time.Minute).Unix(),
		"iat":     now.Unix(),
	}
	accessJWT := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessToken, err = accessJWT.SignedString(h.accessSecret)
	if err != nil {
		return "", "", err
	}

	// Refresh token: 7 days
	refreshClaims := jwt.MapClaims{
		"user_id": userID,
		"exp":     now.Add(7 * 24 * time.Hour).Unix(),
		"iat":     now.Unix(),
	}
	refreshJWT := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshToken, err = refreshJWT.SignedString(h.refreshSecret)
	if err != nil {
		return "", "", err
	}

	return accessToken, refreshToken, nil
}

// Register handles POST /auth/register
func (h *AuthHandler) Register(c *gin.Context) {
	var req dto.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	// Check if account already exists.
	var existingUser database.User
	if err := h.db.Where("account = ?", req.Account).First(&existingUser).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "account already exists"})
		return
	}

	// Hash password
	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		h.logger.Error("failed to hash password", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	user := database.User{
		Account:  req.Account,
		Nickname: req.Nickname,
		Password: hashedPassword,
	}

	if err := h.db.Create(&user).Error; err != nil {
		h.logger.Error("failed to create user", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		return
	}

	accessToken, refreshToken, err := h.generateTokens(user.ID)
	if err != nil {
		h.logger.Error("failed to generate tokens", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate tokens"})
		return
	}

	h.logger.Info("user registered", "user_id", user.ID)
	c.JSON(http.StatusCreated, gin.H{
		"data": dto.TokenResponse{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
		},
	})
}

// Login handles POST /auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	var req dto.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	var user database.User
	if err := h.db.Where("account = ?", req.Account).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid account or password"})
			return
		}
		h.logger.Error("failed to query user", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	if !auth.VerifyPassword(req.Password, user.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid account or password"})
		return
	}

	accessToken, refreshToken, err := h.generateTokens(user.ID)
	if err != nil {
		h.logger.Error("failed to generate tokens", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate tokens"})
		return
	}

	h.logger.Info("user logged in", "user_id", user.ID)
	c.JSON(http.StatusOK, gin.H{
		"data": dto.TokenResponse{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
		},
	})
}

// Refresh handles POST /auth/refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req dto.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request parameters"})
		return
	}

	// Check if refresh token is blacklisted
	blacklistKey := "refresh_token:blacklist:" + req.RefreshToken
	val, err := h.redis.Get(c.Request.Context(), blacklistKey).Result()
	if err == nil && val == "1" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token has been revoked"})
		return
	}

	// Parse refresh token
	token, err := jwt.Parse(req.RefreshToken, func(token *jwt.Token) (interface{}, error) {
		return h.refreshSecret, nil
	})
	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired refresh token"})
		return
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token claims"})
		return
	}

	userID, ok := claims["user_id"].(string)
	if !ok || userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token claims"})
		return
	}

	accessToken, refreshToken, err := h.generateTokens(userID)
	if err != nil {
		h.logger.Error("failed to generate tokens", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate tokens"})
		return
	}

	// Blacklist the old refresh token
	h.redis.Set(c.Request.Context(), blacklistKey, "1", 7*24*time.Hour)

	c.JSON(http.StatusOK, gin.H{
		"data": dto.TokenResponse{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
		},
	})
}

// Logout handles POST /auth/logout
func (h *AuthHandler) Logout(c *gin.Context) {
	refreshToken := c.GetHeader("X-Refresh-Token")
	if refreshToken != "" {
		// Blacklist the refresh token
		blacklistKey := "refresh_token:blacklist:" + refreshToken
		h.redis.Set(c.Request.Context(), blacklistKey, "1", 7*24*time.Hour)
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{"message": "logged out successfully"},
	})
}

// GetMe handles GET /me
func (h *AuthHandler) GetMe(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var user database.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		h.logger.Error("failed to query user", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": dto.UserResponse{
			ID:        user.ID,
			Nickname:  user.Nickname,
			AvatarURL: user.AvatarURL,
			Bio:       user.Bio,
			CreatedAt: user.CreatedAt.Format(time.RFC3339),
			UpdatedAt: user.UpdatedAt.Format(time.RFC3339),
		},
	})
}
