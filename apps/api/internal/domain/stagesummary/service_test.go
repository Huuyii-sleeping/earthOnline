package stagesummary

import (
	"testing"
	"time"
)

func TestPeriodBoundsWeekStartsOnMonday(t *testing.T) {
	loc := time.FixedZone("UTC+8", 8*60*60)
	ref := time.Date(2026, 6, 30, 15, 0, 0, 0, loc) // Tuesday

	start, end := PeriodBounds(PeriodWeek, ref)

	wantStart := time.Date(2026, 6, 29, 0, 0, 0, 0, loc)
	wantEnd := time.Date(2026, 7, 6, 0, 0, 0, 0, loc)
	if !start.Equal(wantStart) {
		t.Fatalf("start = %s, want %s", start, wantStart)
	}
	if !end.Equal(wantEnd) {
		t.Fatalf("end = %s, want %s", end, wantEnd)
	}
}

func TestPeriodBoundsMonth(t *testing.T) {
	loc := time.UTC
	ref := time.Date(2026, 2, 15, 12, 0, 0, 0, loc)

	start, end := PeriodBounds(PeriodMonth, ref)

	wantStart := time.Date(2026, 2, 1, 0, 0, 0, 0, loc)
	wantEnd := time.Date(2026, 3, 1, 0, 0, 0, 0, loc)
	if !start.Equal(wantStart) {
		t.Fatalf("start = %s, want %s", start, wantStart)
	}
	if !end.Equal(wantEnd) {
		t.Fatalf("end = %s, want %s", end, wantEnd)
	}
}

func TestNormalizeWeight(t *testing.T) {
	for _, weight := range []string{"light", "medium", "heavy"} {
		if got := normalizeWeight(weight); got != weight {
			t.Fatalf("normalizeWeight(%q) = %q, want %q", weight, got, weight)
		}
	}

	if got := normalizeWeight("unexpected"); got != "medium" {
		t.Fatalf("normalizeWeight unexpected = %q, want medium", got)
	}
}

func TestMarshalHighlights(t *testing.T) {
	got := marshalHighlights([]string{"坚持记录", "稳定探索"})
	if got == nil {
		t.Fatal("marshalHighlights returned nil")
	}
	want := `["坚持记录","稳定探索"]`
	if *got != want {
		t.Fatalf("marshalHighlights = %s, want %s", *got, want)
	}

	if got := marshalHighlights(nil); got != nil {
		t.Fatalf("marshalHighlights(nil) = %v, want nil", *got)
	}
}
