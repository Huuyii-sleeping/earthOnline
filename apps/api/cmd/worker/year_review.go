package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/earth-online/api/internal/domain/yearreview"
	"github.com/earth-online/api/internal/integrations/taskqueue"
	"github.com/hibiken/asynq"
)

// Task type identifiers for year review. The per-user task type
// TaskYearReviewGenerateUser lives in taskqueue so the API server can enqueue
// it too. The batch sweep TaskYearReviewGenerateYear is worker-only.
const (
// TaskYearReviewGenerateUser is shared with taskqueue; alias for readability.
// TaskYearReviewGenerateYear is declared in main.go.
)

// yearReviewGenerateUserPayload asks the worker to generate one user's review.
type yearReviewGenerateUserPayload struct {
	UserID  string `json:"user_id"`
	Year    int    `json:"year"`
	Trigger string `json:"trigger"`
}

// yearReviewGenerateYearPayload is the batch payload. If Year is 0 the handler
// derives it from the current time (last year on Jan 1).
type yearReviewGenerateYearPayload struct {
	Year int `json:"year"`
}

func newYearReviewScheduler(redisAddr string, logger *slog.Logger) *asynq.Scheduler {
	return asynq.NewScheduler(
		asynq.RedisClientOpt{Addr: redisAddr},
		&asynq.SchedulerOpts{
			Location: time.Local,
			PostEnqueueFunc: func(info *asynq.TaskInfo, err error) {
				if err != nil {
					logger.Error("failed to enqueue scheduled year review", "error", err)
					return
				}
				logger.Info("scheduled year review task enqueued", "task_id", info.ID, "type", info.Type)
			},
		},
	)
}

func registerYearReviewSchedules(s *asynq.Scheduler) error {
	opts := []asynq.Option{
		asynq.Queue("low"),
		asynq.MaxRetry(1),
		asynq.Timeout(60 * time.Minute),
		asynq.Unique(24 * time.Hour),
	}
	// Every Jan 1 at 05:00 — offset from stage summary (03:00/03:30) and
	// growth profile (04:00) so the Agent is not hit by overlapping batches.
	if _, err := s.Register("0 5 1 1 *", newYearReviewGenerateYearTask(0), opts...); err != nil {
		return fmt.Errorf("register yearly year review sweep: %w", err)
	}
	return nil
}

func newYearReviewGenerateUserTask(userID string, year int, trigger string) *asynq.Task {
	if trigger == "" {
		trigger = "year_end"
	}
	payload, _ := json.Marshal(yearReviewGenerateUserPayload{
		UserID:  userID,
		Year:    year,
		Trigger: trigger,
	})
	return asynq.NewTask(taskqueue.TaskYearReviewGenerateUser, payload)
}

func newYearReviewGenerateYearTask(year int) *asynq.Task {
	payload, _ := json.Marshal(yearReviewGenerateYearPayload{Year: year})
	return asynq.NewTask(TaskYearReviewGenerateYear, payload)
}

// handleYearReviewGenerateUser generates a single user's annual review.
func (w *worker) handleYearReviewGenerateUser(ctx context.Context, t *asynq.Task) error {
	var p yearReviewGenerateUserPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("decode year_review.generate_user payload: %w", err)
	}
	if p.UserID == "" {
		return fmt.Errorf("user_id is required")
	}
	if p.Year == 0 {
		return fmt.Errorf("year is required")
	}
	if p.Trigger == "" {
		p.Trigger = "scheduled"
	}

	w.logger.Info("generating year review", "user_id", p.UserID, "year", p.Year, "trigger", p.Trigger)

	_, err := w.yearReview.Generate(ctx, yearreview.GenerateInput{
		UserID:  p.UserID,
		Year:    p.Year,
		Trigger: p.Trigger,
	})
	if err != nil {
		if errors.Is(err, yearreview.ErrAlreadyExists) {
			w.logger.Info("year review already exists, skipping", "user_id", p.UserID, "year", p.Year)
			return nil
		}
		if errors.Is(err, yearreview.ErrNoData) {
			w.logger.Info("year review skipped: no data", "user_id", p.UserID, "year", p.Year)
			return nil
		}
		return fmt.Errorf("generate year review: %w", err)
	}

	// Best-effort: refresh growth portrait with the new annual signal.
	w.queue.EnqueueGrowthProfileRefresh(ctx, p.UserID, "year_review_generated")

	w.logger.Info("year review generated", "user_id", p.UserID, "year", p.Year)
	return nil
}

// handleYearReviewGenerateYear is the batch sweep: load active users and
// enqueue a per-user task for each. The per-user task is deduplicated with
// Unique(24h) so repeated sweeps within the same day collapse.
func (w *worker) handleYearReviewGenerateYear(ctx context.Context, t *asynq.Task) error {
	var p yearReviewGenerateYearPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("decode year_review.generate_year payload: %w", err)
	}
	if p.Year == 0 {
		// On Jan 1 we generate last year's review.
		p.Year = time.Now().Year() - 1
	}

	w.logger.Info("sweeping active users for year review", "year", p.Year)

	userIDs, err := w.proactiveUserIDs()
	if err != nil {
		return err
	}

	var enqueued int
	for _, userID := range userIDs {
		w.queue.EnqueueYearReviewGenerateUser(ctx, userID, p.Year, "year_end")
		enqueued++
	}

	w.logger.Info("year review sweep done", "year", p.Year, "enqueued", enqueued, "user_count", len(userIDs))
	return nil
}
