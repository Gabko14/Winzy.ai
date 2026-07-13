package main

import (
	"strings"
	"testing"
	"time"
)

func TestSummarize_HappyPath_PackageTableAndWall(t *testing.T) {
	input := strings.Join([]string{
		`{"Time":"2026-07-13T10:00:00Z","Action":"pass","Package":"github.com/Gabko14/winzy/backend/internal/auth","Elapsed":11.5}`,
		`{"Time":"2026-07-13T10:00:00.1Z","Action":"pass","Package":"github.com/Gabko14/winzy/backend/internal/auth","Test":"TestFoo","Elapsed":0}`,
		`{"Time":"2026-07-13T10:00:05Z","Action":"pass","Package":"github.com/Gabko14/winzy/backend/internal/habits","Elapsed":5.0}`,
		`{"Time":"2026-07-13T10:00:13Z","Action":"pass","Package":"github.com/Gabko14/winzy/backend/internal/config","Elapsed":1.2}`,
		``,
	}, "\n")

	results, wall, err := summarize(strings.NewReader(input))
	if err != nil {
		t.Fatalf("summarize: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("len(results)=%d, want 3 (per-test events ignored)", len(results))
	}
	if results[0].Package != "github.com/Gabko14/winzy/backend/internal/auth" || results[0].Elapsed != 11.5 {
		t.Fatalf("slowest = %+v, want auth 11.5s", results[0])
	}
	if wall != 13*time.Second {
		t.Fatalf("wall = %v, want 13s", wall)
	}
}

func TestSummarize_ErrorCase_MalformedLinesSkipped(t *testing.T) {
	input := "not json\n{\"Time\":\"2026-07-13T10:00:00Z\",\"Action\":\"fail\",\"Package\":\"github.com/Gabko14/winzy/backend/internal/db\",\"Elapsed\":2}\n"
	results, _, err := summarize(strings.NewReader(input))
	if err != nil {
		t.Fatalf("summarize: %v", err)
	}
	if len(results) != 1 || results[0].Action != "fail" {
		t.Fatalf("results = %+v", results)
	}
}

func TestShortPkg_HappyPath_StripsModulePrefix(t *testing.T) {
	got := shortPkg("github.com/Gabko14/winzy/backend/internal/auth")
	if got != "internal/auth" {
		t.Fatalf("shortPkg = %q, want internal/auth", got)
	}
}
