package habits

import (
	"strings"
	"testing"
	"time"
)

// TestRenderFlameBadgeSVG_HappyPath_MatchesExpectedOutputByteForByte pins the
// full rendered SVG for one representative input against a byte-for-byte
// expected string transcribed from GetFlameBadge's raw-string literal in
// PublicEndpoints.cs (verified indentation/newlines via `awk` against the
// C# source — see the bead report). A PM review additionally diffs this
// against a live C# run for the same inputs.
func TestRenderFlameBadgeSVG_HappyPath_MatchesExpectedOutputByteForByte(t *testing.T) {
	got := renderFlameBadgeSVG("alice", FlameNone, 0)
	want := `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="32" viewBox="0 0 160 32">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1C1917"/>
      <stop offset="100%" stop-color="#292524"/>
    </linearGradient>
  </defs>
  <rect width="160" height="32" rx="6" fill="url(#bg)"/>
  <!-- Flame icon -->
  <circle cx="20" cy="16" r="8" fill="#D1D5DB" opacity="0.25"/>
  <path d="M20 8 C20 8, 14 14, 14 18 C14 21.3, 16.7 24, 20 24 C23.3 24, 26 21.3, 26 18 C26 14, 20 8, 20 8Z"
        fill="#9CA3AF" opacity="0.9"/>
  <path d="M20 13 C20 13, 17 16, 17 18.5 C17 20.4, 18.3 22, 20 22 C21.7 22, 23 20.4, 23 18.5 C23 16, 20 13, 20 13Z"
        fill="#D1D5DB" opacity="0.7"/>
  <!-- Text -->
  <text x="36" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="12" font-weight="600" fill="#FAFAF9">
    alice
  </text>
  <!-- Consistency badge -->
  <rect x="108" y="7" width="44" height="18" rx="9" fill="#9CA3AF" opacity="0.2"/>
  <text x="130" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="#9CA3AF" text-anchor="middle">
    0%
  </text>
</svg>`
	if got != want {
		t.Errorf("renderFlameBadgeSVG() mismatch:\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
}

func TestRenderFlameBadgeSVG_HappyPath_ColorsMatchEachFlameLevel(t *testing.T) {
	tests := []struct {
		level               FlameLevel
		wantFlame, wantGlow string
	}{
		{FlameNone, "#9CA3AF", "#D1D5DB"},
		{FlameEmber, "#D97706", "#FCD34D"},
		{FlameSteady, "#EA580C", "#FDBA74"},
		{FlameStrong, "#F97316", "#FCA5A5"},
		{FlameBlazing, "#DC2626", "#FECACA"},
	}
	for _, tt := range tests {
		svg := renderFlameBadgeSVG("user", tt.level, 50)
		if !strings.Contains(svg, `fill="`+tt.wantFlame+`"`) {
			t.Errorf("level %v: svg missing flame color %s", tt.level, tt.wantFlame)
		}
		if !strings.Contains(svg, `fill="`+tt.wantGlow+`" opacity="0.25"`) {
			t.Errorf("level %v: svg missing glow color %s", tt.level, tt.wantGlow)
		}
	}
}

// TestRenderFlameBadgeSVG_EdgeCase_ConsistencyRoundsToNearestInteger proves
// the consistency text rounds half away from zero to a whole percentage.
func TestRenderFlameBadgeSVG_EdgeCase_ConsistencyRoundsToNearestInteger(t *testing.T) {
	tests := []struct {
		consistency float64
		want        string
	}{
		{62.5, "63%"},
		{63.4, "63%"},
		{99.95 + 0.05, "100%"}, // exact 100, sanity check on the upper end
	}
	for _, tt := range tests {
		svg := renderFlameBadgeSVG("user", FlameNone, tt.consistency)
		if !strings.Contains(svg, ">\n    "+tt.want+"\n  </text>\n</svg>") {
			t.Errorf("consistency %v: svg does not contain expected badge text %q:\n%s", tt.consistency, tt.want, svg)
		}
	}
}

func TestRenderFlameBadgeSVG_EdgeCase_EscapesUsername(t *testing.T) {
	svg := renderFlameBadgeSVG(`<script>alert(1)</script>`, FlameNone, 0)
	if strings.Contains(svg, "<script>") {
		t.Errorf("svg contains an unescaped <script> tag: %s", svg)
	}
	if !strings.Contains(svg, "&lt;script&gt;") {
		t.Errorf("svg should contain the HTML-escaped username, got: %s", svg)
	}
}

func TestGeneratePromiseStatement_HappyPath_FormatsTargetAndDate(t *testing.T) {
	p := Promise{TargetConsistency: 75, EndDate: time.Date(2026, time.August, 9, 0, 0, 0, 0, time.UTC)}
	got := generatePromiseStatement(p)
	want := "Keeping above 75% through August 9"
	if got != want {
		t.Errorf("generatePromiseStatement() = %q, want %q", got, want)
	}
}

func TestGeneratePromiseStatement_EdgeCase_TruncatesFractionalTarget(t *testing.T) {
	p := Promise{TargetConsistency: 75.9, EndDate: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)}
	got := generatePromiseStatement(p)
	if !strings.Contains(got, "75%") {
		t.Errorf("generatePromiseStatement() = %q, want it to truncate 75.9 to 75%%, not round to 76%%", got)
	}
}

func TestOnTrackFor_HappyPath_TrueWhenConsistencyMeetsTarget(t *testing.T) {
	current := 80.0
	got := onTrackFor(PromiseActive, 70, &current)
	if got == nil || !*got {
		t.Errorf("onTrackFor() = %v, want true", got)
	}
}

func TestOnTrackFor_HappyPath_FalseWhenConsistencyBelowTarget(t *testing.T) {
	current := 50.0
	got := onTrackFor(PromiseActive, 70, &current)
	if got == nil || *got {
		t.Errorf("onTrackFor() = %v, want false", got)
	}
}

func TestOnTrackFor_EdgeCase_NilWhenNotActive(t *testing.T) {
	current := 80.0
	if got := onTrackFor(PromiseKept, 70, &current); got != nil {
		t.Errorf("onTrackFor() for a Kept promise = %v, want nil", got)
	}
}

func TestOnTrackFor_EdgeCase_NilWhenConsistencyUnknown(t *testing.T) {
	if got := onTrackFor(PromiseActive, 70, nil); got != nil {
		t.Errorf("onTrackFor() with nil consistency = %v, want nil", got)
	}
}

func TestPromiseStatus_String_LowercasesEndedBelowWithoutSeparator(t *testing.T) {
	if got := PromiseEndedBelow.String(); got != "endedbelow" {
		t.Errorf("PromiseEndedBelow.String() = %q, want %q", got, "endedbelow")
	}
}
