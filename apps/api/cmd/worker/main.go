package main

import (
	"log/slog"
	"os"

	"github.com/earth-online/api/internal/config"
)

func main() {
	cfg := config.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	logger.Info("worker booted", "redis", cfg.RedisAddr)
}
