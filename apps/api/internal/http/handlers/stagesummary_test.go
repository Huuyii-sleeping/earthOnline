package handlers

import (
	"testing"
	"time"
)

func TestParseStageSummaryRefDateUsesLocalTimezone(t *testing.T) {
	originalLocal := time.Local
	time.Local = time.FixedZone("UTC+8", 8*60*60)
	t.Cleanup(func() { time.Local = originalLocal })

	got, err := parseStageSummaryRefDate("2026-06-30")
	if err != nil {
		t.Fatalf("parse ref date: %v", err)
	}

	want := time.Date(2026, 6, 30, 0, 0, 0, 0, time.Local)
	if !got.Equal(want) {
		t.Fatalf("parsed date = %s, want %s", got, want)
	}
	if got.Location() != time.Local {
		t.Fatalf("parsed location = %v, want time.Local", got.Location())
	}
}
