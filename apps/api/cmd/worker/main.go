package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/earth-online/api/internal/config"
	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/domain/growthprofile"
	"github.com/earth-online/api/internal/domain/stagesummary"
	"github.com/earth-online/api/internal/domain/yearreview"
	"github.com/earth-online/api/internal/integrations/agent"
	"github.com/earth-online/api/internal/integrations/taskqueue"
	"github.com/earth-online/api/internal/storage"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"
)

// Task type identifiers registered with the asynq scheduler.
const (
	TaskSpeechToText       = "speech_to_text"
	TaskImageUnderstanding = "image_understanding"
	TaskStageSummaryPeriod = "stage_summary.generate_period"

	// TaskGrowthProfileRefreshActiveUsers is the weekly sweep that enqueues a
	// per-user refresh. The per-user task type lives in the taskqueue package so
	// the API server can enqueue it too.
	TaskGrowthProfileRefreshActiveUsers = "growth_profile.refresh_active_users"

	// TaskYearReviewGenerateYear is the annual sweep that enqueues per-user
	// year review generation. The per-user task type lives in taskqueue.
	TaskYearReviewGenerateYear = "year_review.generate_year"
)

// concurrency is how many tasks the worker processes in parallel.
const concurrency = 5

// AssetTaskPayload is the shared payload for asset-based tasks.
type AssetTaskPayload struct {
	AssetID   string `json:"asset_id"`
	SessionID string `json:"session_id"`
}

// worker holds all the dependencies a task handler needs.
type worker struct {
	db          *gorm.DB
	minioClient *storage.MinIOClient
	openai      *openAIClient
	stage       *stagesummary.Service
	growth      *growthprofile.Service
	yearReview  *yearreview.Service
	queue       *taskqueue.Client
	logger      *slog.Logger
}

func main() {
	cfg := config.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	logger.Info("worker booted", "redis", cfg.RedisAddr)

	// Connect to Postgres so handlers can read assets and write messages.
	db, err := database.NewPostgres(cfg.DatabaseURL)
	if err != nil {
		logger.Error("failed to connect database", "error", err)
		os.Exit(1)
	}

	// Connect to MinIO so handlers can download asset bytes.
	minioClient, err := storage.NewMinIOClient(
		cfg.S3Endpoint,
		cfg.S3AccessKeyID,
		cfg.S3SecretAccessKey,
		cfg.S3Bucket,
		logger,
	)
	if err != nil {
		logger.Error("failed to connect minio", "error", err)
		os.Exit(1)
	}

	// Configure OpenAI client. If no key is configured we keep running so that
	// local development is not blocked; the handlers will simply fail per task.
	var openaiCli *openAIClient
	if cfg.OpenAIAPIKey == "" {
		logger.Warn("OPENAI_API_KEY is not set; speech_to_text and image_understanding tasks will fail until a key is provided")
	} else {
		openaiCli = newOpenAIClient(cfg.OpenAIAPIKey, os.Getenv("OPENAI_BASE_URL"), os.Getenv("OPENAI_VISION_MODEL"))
		logger.Info("openai client configured")
	}

	w := &worker{
		db:          db,
		minioClient: minioClient,
		openai:      openaiCli,
		stage:       stagesummary.NewService(db, agent.NewClient(cfg.AgentServiceURL, logger), logger),
		growth:      growthprofile.NewService(db, agent.NewClient(cfg.AgentServiceURL, logger), logger),
		yearReview:  yearreview.NewService(db, agent.NewClient(cfg.AgentServiceURL, logger), logger),
		queue:       taskqueue.NewClient(cfg.RedisAddr, logger),
		logger:      logger,
	}

	// asynq server: reads tasks from Redis.
	srv := asynq.NewServer(
		asynq.RedisClientOpt{Addr: cfg.RedisAddr},
		asynq.Config{
			Concurrency: concurrency,
			Queues: map[string]int{
				"critical": 6,
				"default":  3,
				"low":      1,
			},
		},
	)

	mux := asynq.NewServeMux()
	mux.HandleFunc(TaskSpeechToText, w.handleSpeechToText)
	mux.HandleFunc(TaskImageUnderstanding, w.handleImageUnderstanding)
	mux.HandleFunc(TaskStageSummaryPeriod, w.handleStageSummaryPeriod)
	mux.HandleFunc(taskqueue.TaskGrowthProfileRefresh, w.handleGrowthProfileRefresh)
	mux.HandleFunc(TaskGrowthProfileRefreshActiveUsers, w.handleGrowthProfileRefreshActiveUsers)
	mux.HandleFunc(taskqueue.TaskYearReviewGenerateUser, w.handleYearReviewGenerateUser)
	mux.HandleFunc(TaskYearReviewGenerateYear, w.handleYearReviewGenerateYear)

	scheduler := newStageSummaryScheduler(cfg.RedisAddr, logger)
	if err := registerStageSummarySchedules(scheduler); err != nil {
		logger.Error("failed to register stage summary schedules", "error", err)
		os.Exit(1)
	}
	go func() {
		if err := scheduler.Run(); err != nil {
			logger.Error("stage summary scheduler stopped with error", "error", err)
		}
	}()

	growthScheduler := newGrowthProfileScheduler(cfg.RedisAddr, logger)
	if err := registerGrowthProfileSchedules(growthScheduler); err != nil {
		logger.Error("failed to register growth profile schedules", "error", err)
		os.Exit(1)
	}
	go func() {
		if err := growthScheduler.Run(); err != nil {
			logger.Error("growth profile scheduler stopped with error", "error", err)
		}
	}()

	yearReviewScheduler := newYearReviewScheduler(cfg.RedisAddr, logger)
	if err := registerYearReviewSchedules(yearReviewScheduler); err != nil {
		logger.Error("failed to register year review schedules", "error", err)
		os.Exit(1)
	}
	go func() {
		if err := yearReviewScheduler.Run(); err != nil {
			logger.Error("year review scheduler stopped with error", "error", err)
		}
	}()

	// Graceful shutdown on SIGINT / SIGTERM.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-stop
		logger.Info("shutting down worker...")
		scheduler.Shutdown()
		growthScheduler.Shutdown()
		yearReviewScheduler.Shutdown()
		srv.Shutdown()
		w.queue.Close()
	}()

	if err := srv.Run(mux); err != nil {
		logger.Error("asynq server stopped with error", "error", err)
		os.Exit(1)
	}
}

// handleSpeechToText transcribes an audio asset with Whisper and stores the
// resulting text as a conversation message.
func (w *worker) handleSpeechToText(ctx context.Context, t *asynq.Task) error {
	var p AssetTaskPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("decode speech_to_text payload: %w", err)
	}
	if p.AssetID == "" {
		return fmt.Errorf("asset_id is required")
	}
	if p.SessionID == "" {
		return fmt.Errorf("session_id is required")
	}

	w.logger.Info("processing speech_to_text", "asset_id", p.AssetID, "session_id", p.SessionID)

	if w.openai == nil {
		return fmt.Errorf("openai not configured: set OPENAI_API_KEY")
	}

	asset, err := w.fetchAsset(p.AssetID)
	if err != nil {
		return err
	}

	audioBytes, err := w.downloadAssetBytes(ctx, asset.StorageKey)
	if err != nil {
		return fmt.Errorf("download audio: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	text, err := w.openai.transcribeAudio(ctx, audioBytes, asset.MimeType)
	if err != nil {
		return fmt.Errorf("transcribe audio: %w", err)
	}

	if err := w.writeMessage(p.SessionID, asset.ID, "语音转写：\n"+text); err != nil {
		return fmt.Errorf("save transcription message: %w", err)
	}

	w.logger.Info("speech_to_text done", "asset_id", p.AssetID, "chars", len(text))
	return nil
}

// handleImageUnderstanding asks a multimodal LLM to describe an image asset and
// stores the description as a conversation message.
func (w *worker) handleImageUnderstanding(ctx context.Context, t *asynq.Task) error {
	var p AssetTaskPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("decode image_understanding payload: %w", err)
	}
	if p.AssetID == "" {
		return fmt.Errorf("asset_id is required")
	}
	if p.SessionID == "" {
		return fmt.Errorf("session_id is required")
	}

	w.logger.Info("processing image_understanding", "asset_id", p.AssetID, "session_id", p.SessionID)

	if w.openai == nil {
		return fmt.Errorf("openai not configured: set OPENAI_API_KEY")
	}

	asset, err := w.fetchAsset(p.AssetID)
	if err != nil {
		return err
	}

	imageBytes, err := w.downloadAssetBytes(ctx, asset.StorageKey)
	if err != nil {
		return fmt.Errorf("download image: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	description, err := w.openai.describeImage(ctx, imageBytes, asset.MimeType, "")
	if err != nil {
		return fmt.Errorf("understand image: %w", err)
	}

	if err := w.writeMessage(p.SessionID, asset.ID, "图片理解：\n"+description); err != nil {
		return fmt.Errorf("save image understanding message: %w", err)
	}

	w.logger.Info("image_understanding done", "asset_id", p.AssetID, "chars", len(description))
	return nil
}

// fetchAsset loads the asset record from the database.
func (w *worker) fetchAsset(assetID string) (database.Asset, error) {
	var asset database.Asset
	if err := w.db.First(&asset, "id = ?", assetID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return asset, fmt.Errorf("asset %s not found", assetID)
		}
		return asset, fmt.Errorf("query asset: %w", err)
	}
	return asset, nil
}

// downloadAssetBytes generates a short-lived download URL and fetches the raw
// object bytes. This keeps the storage client API minimal.
func (w *worker) downloadAssetBytes(ctx context.Context, storageKey string) ([]byte, error) {
	downloadURL, err := w.minioClient.PresignDownload(ctx, storageKey)
	if err != nil {
		return nil, fmt.Errorf("presign download: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create download request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch object: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("object storage returned status %d: %s", resp.StatusCode, string(raw))
	}

	return io.ReadAll(resp.Body)
}

// writeMessage persists an agent message carrying the understanding result
// for a given asset. The caller must ensure sessionID is non-empty because the
// conversation_messages.session_id column is NOT NULL.
func (w *worker) writeMessage(sessionID, assetID, content string) error {
	msg := database.ConversationMessage{
		SessionID:   sessionID,
		Role:        "agent",
		Content:     content,
		ContentType: "text",
		AssetID:     &assetID,
	}

	if err := w.db.Create(&msg).Error; err != nil {
		return fmt.Errorf("create message: %w", err)
	}
	return nil
}
