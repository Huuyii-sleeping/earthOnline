package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port              int
	DatabaseURL       string
	RedisAddr         string
	JWTAccessSecret   string
	JWTRefreshSecret  string
	S3Endpoint        string
	S3Region          string
	S3Bucket          string
	S3AccessKeyID     string
	S3SecretAccessKey string
	AgentServiceURL   string
}

func Load() *Config {
	port := 8080
	if p := getEnv("API_PORT", os.Getenv("PORT")); p != "" {
		fmt.Sscanf(p, "%d", &port)
	}

	return &Config{
		Port:              port,
		DatabaseURL:       getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/earth_online?sslmode=disable"),
		RedisAddr:         getEnv("REDIS_ADDR", "localhost:6379"),
		JWTAccessSecret:   getEnv("JWT_ACCESS_SECRET", "change-me-access-secret"),
		JWTRefreshSecret:  getEnv("JWT_REFRESH_SECRET", "change-me-refresh-secret"),
		S3Endpoint:        getEnv("S3_ENDPOINT", "http://localhost:9000"),
		S3Region:          getEnv("S3_REGION", "us-east-1"),
		S3Bucket:          getEnv("S3_BUCKET", "earth-online"),
		S3AccessKeyID:     getEnv("S3_ACCESS_KEY_ID", "minioadmin"),
		S3SecretAccessKey: getEnv("S3_SECRET_ACCESS_KEY", "minioadmin"),
		AgentServiceURL:   getEnv("AGENT_SERVICE_URL", "http://localhost:8787"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
