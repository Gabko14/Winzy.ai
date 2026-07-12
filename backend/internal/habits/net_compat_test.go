package habits

import "testing"

func TestRoundNET_ExportedWrapper_MatchesMidpointBehavior(t *testing.T) {
	// FIX 5 (winzy.ai-rdc7.4 review): confirms the exported wrapper behaves
	// identically to the unexported roundNET consistency.go already tests —
	// the two documented midpoint cases a naive round-half-away-from-zero
	// (Go's math.Round) would get wrong.
	cases := []struct {
		name  string
		value float64
		want  float64
	}{
		{"HappyPath_RoundsDownAtEvenMidpoint", 82.25, 82.2},
		{"HappyPath_RoundsUpAtOddMidpoint", 82.35, 82.4},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := RoundNET(tc.value, 1); got != tc.want {
				t.Errorf("RoundNET(%v, 1) = %v, want %v", tc.value, got, tc.want)
			}
		})
	}
}

func TestUTF16Len_ExportedWrapper_CountsCodeUnitsNotBytes(t *testing.T) {
	t.Run("HappyPath_ASCII", func(t *testing.T) {
		if got := UTF16Len("hello"); got != 5 {
			t.Errorf("UTF16Len(hello) = %d, want 5", got)
		}
	})
	t.Run("EdgeCase_MultiByteBoundary", func(t *testing.T) {
		// "é" is 2 UTF-8 bytes but 1 UTF-16 code unit — counting bytes here
		// would wrongly reject input the C# `string.Length` check accepts.
		s := "café"
		if got := UTF16Len(s); got != 4 {
			t.Errorf("UTF16Len(%q) = %d, want 4 (UTF-16 code units, not %d UTF-8 bytes)", s, got, len(s))
		}
	})
	t.Run("EdgeCase_SurrogatePair", func(t *testing.T) {
		// An astral character (e.g. an emoji) is one Go rune but encodes to
		// a UTF-16 SURROGATE PAIR (2 code units) — the case runes/bytes both
		// diverge from C#'s string.Length.
		s := "\U0001F600" // 😀, one rune, 4 UTF-8 bytes, 2 UTF-16 code units
		if got := UTF16Len(s); got != 2 {
			t.Errorf("UTF16Len(%q) = %d, want 2 (a surrogate pair)", s, got)
		}
	})
}
