// Package taskqueue wraps the asynq client so the API server can enqueue
// background jobs (growth profile refresh, etc.) without depending on worker
// internals. Jobs are best-effort: enqueue failures are logged but never
// bubble up to the caller, so the main request flow is never blocked.
package taskqueue

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"
)

// Task type identifiers shared between the API (producer) and worker (consumer).
const (
	TaskGrowthProfileRefresh = "growth_profile.refresh_user"
)

// GrowthProfileRefreshPayload asks the worker to refresh a single user's
// growth profile. Trigger records what caused the refresh for traceability.
type GrowthProfileRefreshPayload struct {
	UserID  string `json:"user_id"`
	Trigger string `json:"trigger"`
}

// Client enqueues background tasks into Redis via asynq. A nil Client is safe
// to call — every method is a no-op — so callers can disable the queue without
// touching call sites.
type Client struct {
	client *asynq.Client
	logger *slog.Logger
}

// NewClient creates a task queue client connected to Redis. If redisAddr is
// empty it returns a nil-client so the API can run without a queue (enqueue
// calls become no-ops).
func NewClient(redisAddr string, logger *slog.Logger) *Client {
	if redisAddr == "" {
		logger.Warn("task queue disabled: redis address is empty, growth profile auto-refresh will be a no-op")
		return &Client{client: nil, logger: logger}
	}
	return &Client{
		client: asynq.NewClient(asynq.RedisClientOpt{Addr: redisAddr}),
		logger: logger,
	}
}

// Close releases the underlying asynq client connection.
func (c *Client) Close() error {
	if c == nil || c.client == nil {
		return nil
	}
	return c.client.Close()
}

// EnqueueGrowthProfileRefresh schedules a best-effort growth profile refresh.
// It is deduplicated with a 6-hour Unique window so repeated triggers (medal
// generation + stage summary in quick succession) collapse into one refresh.
func (c *Client) EnqueueGrowthProfileRefresh(ctx context.Context, userID, trigger string) {
	if c == nil || c.client == nil {
		return
	}
	if userID == "" {
		return
	}
	if trigger == "" {
		trigger = "manual"
	}

	payload, err := json.Marshal(GrowthProfileRefreshPayload{
		UserID:  userID,
		Trigger: trigger,
	})
	if err != nil {
		c.logger.Error("failed to marshal growth profile refresh payload", "error", err, "user_id", userID)
		return
	}

	task := asynq.NewTask(TaskGrowthProfileRefresh, payload)
	opts := []asynq.Option{
		asynq.Queue("low"),
		asynq.MaxRetry(1),
		asynq.Timeout(10 * time.Minute),
		// Collapse repeated refreshes for the same user within this window.
		asynq.Unique(6 * time.Hour),
	}

	info, err := c.client.EnqueueContext(ctx, task, opts...)
	if err != nil {
		// asynq returns ErrDuplicateTask when a Unique task is already pending;
		// that is the expected dedup behavior, not an error worth alarming on.
		c.logger.Warn("failed to enqueue growth profile refresh", "error", err, "user_id", userID, "trigger", trigger)
		return
	}
	c.logger.Info("enqueued growth profile refresh", "task_id", info.ID, "user_id", userID, "trigger", trigger)
}

// MustNewClient is a convenience for callers that want to fail fast when the
// queue cannot be initialized. Currently unused by the API server which prefers
// the resilient NewClient path, but kept for worker parity.
func MustNewClient(redisAddr string, logger *slog.Logger) *Client {
	c := NewClient(redisAddr, logger)
	if c == nil {
		panic(fmt.Errorf("task queue client is nil"))
	}
	return c
}
