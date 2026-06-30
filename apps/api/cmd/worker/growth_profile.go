package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/earth-online/api/internal/domain/growthprofile"
	"github.com/earth-online/api/internal/integrations/taskqueue"
	"github.com/hibiken/asynq"
)

// GrowthProfileRefreshPayload mirrors taskqueue.GrowthProfileRefreshPayload.
// Kept local so the worker does not import the taskqueue package's payload
// shape indirectly; the JSON must stay in sync.
type growthProfileRefreshPayload struct {
	UserID  string `json:"user_id"`
	Trigger string `json:"trigger"`
}

func newGrowthProfileScheduler(redisAddr string, logger *slog.Logger) *asynq.Scheduler {
	return asynq.NewScheduler(
		asynq.RedisClientOpt{Addr: redisAddr},
		&asynq.SchedulerOpts{
			Location: time.Local,
			PostEnqueueFunc: func(info *asynq.TaskInfo, err error) {
				if err != nil {
					logger.Error("failed to enqueue scheduled growth profile refresh", "error", err)
					return
				}
				logger.Info("scheduled growth profile task enqueued", "task_id", info.ID, "type", info.Type)
			},
		},
	)
}

func registerGrowthProfileSchedules(s *asynq.Scheduler) error {
	opts := []asynq.Option{
		asynq.Queue("low"),
		asynq.MaxRetry(1),
		asynq.Timeout(30 * time.Minute),
	}
	// Refresh active users' growth portraits weekly, offset from the stage
	// summary schedule (which runs at 03:00/03:30 Monday / 1st) so the Agent
	// is not hit by two heavy batches at once.
	if _, err := s.Register("0 4 * * MON", newGrowthProfileRefreshActiveUsersTask(), opts...); err != nil {
		return fmt.Errorf("register weekly growth profile refresh: %w", err)
	}
	return nil
}

func newGrowthProfileRefreshTask(userID, trigger string) *asynq.Task {
	payload, _ := json.Marshal(growthProfileRefreshPayload{
		UserID:  userID,
		Trigger: trigger,
	})
	return asynq.NewTask(taskqueue.TaskGrowthProfileRefresh, payload)
}

func newGrowthProfileRefreshActiveUsersTask() *asynq.Task {
	return asynq.NewTask("growth_profile.refresh_active_users", nil)
}

// handleGrowthProfileRefresh refreshes a single user's growth portrait. It is
// the consumer of taskqueue.TaskGrowthProfileRefresh enqueued by the API server
// (after medal/stage summary generation) or by the weekly active-users sweep.
func (w *worker) handleGrowthProfileRefresh(ctx context.Context, t *asynq.Task) error {
	var p growthProfileRefreshPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("decode growth profile refresh payload: %w", err)
	}
	if p.UserID == "" {
		return fmt.Errorf("user_id is required")
	}
	if p.Trigger == "" {
		p.Trigger = "scheduled"
	}

	w.logger.Info("refreshing growth profile", "user_id", p.UserID, "trigger", p.Trigger)

	_, err := w.growth.Refresh(ctx, growthprofile.RefreshInput{
		UserID:  p.UserID,
		Scope:   "all",
		Trigger: p.Trigger,
	})
	if err != nil {
		if errors.Is(err, growthprofile.ErrNoSignals) {
			// No experiences yet — expected for new users, not an error.
			w.logger.Info("growth profile refresh skipped: no signals", "user_id", p.UserID)
			return nil
		}
		return fmt.Errorf("refresh growth profile: %w", err)
	}

	w.logger.Info("growth profile refreshed", "user_id", p.UserID, "trigger", p.Trigger)
	return nil
}

// handleGrowthProfileRefreshActiveUsers is the weekly sweep: it loads active
// users and enqueues a deduplicated refresh task per user. Each user is then
// processed independently so a single slow Agent call cannot block the batch.
func (w *worker) handleGrowthProfileRefreshActiveUsers(ctx context.Context, _ *asynq.Task) error {
	userIDs, err := w.proactiveUserIDs()
	if err != nil {
		return err
	}

	w.logger.Info("sweeping active users for growth profile refresh", "user_count", len(userIDs))

	var enqueued int
	for _, userID := range userIDs {
		// Best-effort enqueue; Unique(6h) collapses duplicates.
		w.queue.EnqueueGrowthProfileRefresh(ctx, userID, "scheduled")
		enqueued++
	}

	w.logger.Info("growth profile active-users sweep done", "enqueued", enqueued, "user_count", len(userIDs))
	return nil
}
