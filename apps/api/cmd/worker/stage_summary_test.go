package main

import (
	"testing"
	"time"

	"github.com/earth-online/api/internal/domain/stagesummary"
)

func TestPreviousCompletePeriodWeek(t *testing.T) {
	loc := time.FixedZone("UTC+8", 8*60*60)
	ref := time.Date(2026, 6, 30, 12, 0, 0, 0, loc) // Tuesday

	start, end := previousCompletePeriod(stagesummary.PeriodWeek, ref)

	wantStart := time.Date(2026, 6, 22, 0, 0, 0, 0, loc)
	wantEnd := time.Date(2026, 6, 29, 0, 0, 0, 0, loc)
	if !start.Equal(wantStart) {
		t.Fatalf("start = %s, want %s", start, wantStart)
	}
	if !end.Equal(wantEnd) {
		t.Fatalf("end = %s, want %s", end, wantEnd)
	}
}

func TestPreviousCompletePeriodMonth(t *testing.T) {
	loc := time.UTC
	ref := time.Date(2026, 6, 30, 12, 0, 0, 0, loc)

	start, end := previousCompletePeriod(stagesummary.PeriodMonth, ref)

	wantStart := time.Date(2026, 5, 1, 0, 0, 0, 0, loc)
	wantEnd := time.Date(2026, 6, 1, 0, 0, 0, 0, loc)
	if !start.Equal(wantStart) {
		t.Fatalf("start = %s, want %s", start, wantStart)
	}
	if !end.Equal(wantEnd) {
		t.Fatalf("end = %s, want %s", end, wantEnd)
	}
}
