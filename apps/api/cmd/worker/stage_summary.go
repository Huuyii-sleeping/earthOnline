package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/earth-online/api/internal/database"
	"github.com/earth-online/api/internal/domain/stagesummary"
	"github.com/hibiken/asynq"
)

// StageSummaryPeriodPayload asks the worker to generate stage summaries for
// all users who allow proactive Agent work for the period immediately before
// RefDate.
type StageSummaryPeriodPayload struct {
	PeriodType string `json:"period_type"`
	RefDate    string `json:"ref_date"`
}

func newStageSummaryScheduler(redisAddr string, logger *slog.Logger) *asynq.Scheduler {
	return asynq.NewScheduler(
		asynq.RedisClientOpt{Addr: redisAddr},
		&asynq.SchedulerOpts{
			Location: time.Local,
			PostEnqueueFunc: func(info *asynq.TaskInfo, err error) {
				if err != nil {
					logger.Error("failed to enqueue scheduled stage summary", "error", err)
					return
				}
				logger.Info("scheduled stage summary task enqueued", "task_id", info.ID, "type", info.Type)
			},
		},
	)
}

func registerStageSummarySchedules(s *asynq.Scheduler) error {
	opts := []asynq.Option{
		asynq.Queue("low"),
		asynq.MaxRetry(1),
		asynq.Timeout(30 * time.Minute),
		asynq.Unique(23 * time.Hour),
	}
	if _, err := s.Register("0 3 * * MON", newStageSummaryPeriodTask(stagesummary.PeriodWeek, ""), opts...); err != nil {
		return fmt.Errorf("register weekly stage summary: %w", err)
	}
	if _, err := s.Register("30 3 1 * *", newStageSummaryPeriodTask(stagesummary.PeriodMonth, ""), opts...); err != nil {
		return fmt.Errorf("register monthly stage summary: %w", err)
	}
	return nil
}

func newStageSummaryPeriodTask(period stagesummary.PeriodType, refDate string) *asynq.Task {
	payload, _ := json.Marshal(StageSummaryPeriodPayload{
		PeriodType: string(period),
		RefDate:    refDate,
	})
	return asynq.NewTask(TaskStageSummaryPeriod, payload)
}

func (w *worker) handleStageSummaryPeriod(ctx context.Context, t *asynq.Task) error {
	var p StageSummaryPeriodPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("decode stage summary payload: %w", err)
	}

	period := stagesummary.PeriodType(p.PeriodType)
	if !period.Valid() {
		return fmt.Errorf("invalid period_type %q", p.PeriodType)
	}

	ref := time.Now()
	if p.RefDate != "" {
		parsed, err := time.ParseInLocation("2006-01-02", p.RefDate, time.Local)
		if err != nil {
			return fmt.Errorf("invalid ref_date %q: %w", p.RefDate, err)
		}
		ref = parsed
	}

	targetStart, targetEnd := previousCompletePeriod(period, ref)
	userIDs, err := w.proactiveUserIDs()
	if err != nil {
		return err
	}

	w.logger.Info(
		"processing stage summary period",
		"period_type", period,
		"period_start", targetStart,
		"period_end", targetEnd,
		"user_count", len(userIDs),
	)

	var failed int
	var skipped int
	var generated int
	for _, userID := range userIDs {
		_, err := w.stage.Generate(ctx, stagesummary.GenerateInput{
			UserID:      userID,
			Period:      period,
			PeriodStart: targetStart,
			PeriodEnd:   targetEnd,
			Trigger:     "scheduled",
		})
		if err != nil {
			if errors.Is(err, stagesummary.ErrNoExperiences) {
				skipped++
				continue
			}
			failed++
			w.logger.Error("failed to generate scheduled stage summary", "error", err, "user_id", userID, "period_type", period)
			continue
		}
		generated++
	}

	w.logger.Info(
		"stage summary period done",
		"period_type", period,
		"generated", generated,
		"skipped", skipped,
		"failed", failed,
	)
	if failed > 0 {
		return fmt.Errorf("stage summary period completed with %d failed users", failed)
	}
	return nil
}

func (w *worker) proactiveUserIDs() ([]string, error) {
	var users []database.User
	err := w.db.
		Model(&database.User{}).
		Select("users.id").
		Joins("LEFT JOIN agent_profiles ON agent_profiles.user_id = users.id").
		Where("agent_profiles.id IS NULL OR agent_profiles.proactive_level > ?", 0).
		Find(&users).Error
	if err != nil {
		return nil, fmt.Errorf("query proactive users: %w", err)
	}

	userIDs := make([]string, 0, len(users))
	seen := make(map[string]struct{}, len(users))
	for _, user := range users {
		if user.ID == "" {
			continue
		}
		if _, ok := seen[user.ID]; ok {
			continue
		}
		seen[user.ID] = struct{}{}
		userIDs = append(userIDs, user.ID)
	}
	return userIDs, nil
}

func previousCompletePeriod(period stagesummary.PeriodType, ref time.Time) (time.Time, time.Time) {
	currentStart, _ := stagesummary.PeriodBounds(period, ref)
	if period == stagesummary.PeriodMonth {
		previousRef := currentStart.AddDate(0, 0, -1)
		return stagesummary.PeriodBounds(period, previousRef)
	}
	previousRef := currentStart.AddDate(0, 0, -1)
	return stagesummary.PeriodBounds(period, previousRef)
}
