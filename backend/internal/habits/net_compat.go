package habits

// This file exposes two of this package's bit-exact .NET-compatibility
// helpers to other in-process modules, without duplicating (or subtly
// diverging from) their implementations. Neither wrapper changes behavior;
// they exist purely so a cross-module caller (internal/social today) can
// reuse the golden-verified logic instead of reimplementing it.

// RoundNET is the exported, cross-module entry point to this package's
// bit-exact port of .NET's Math.Round(value, digits) — default
// MidpointRounding.ToEven ("banker's rounding") — see consistency.go's
// roundNET for the full doc comment and rationale (deliberately left
// untouched: the flame engine's numeric behavior is golden-verified).
// internal/social uses this for parity ports of C# code that calls
// Math.Round on a value shown to the user (e.g. FetchFlameMap's average
// consistency in FriendEndpoints.cs), so the two stacks round identically at
// exact midpoints instead of Go's default round-half-away-from-zero
// silently diverging by a tenth of a percent.
func RoundNET(value float64, digits int) float64 {
	return roundNET(value, digits)
}

// UTF16Len is the exported, cross-module entry point to this package's
// UTF-16-code-unit length counter — see promise_service.go's utf16Len for
// the full doc comment (C#'s string.Length counts UTF-16 code units, not
// bytes or runes; counting UTF-8 bytes undercounts ASCII-adjacent multi-byte
// input in the wrong direction relative to the C# check it must match).
// internal/social's Witness Link label length validation needs the
// identical semantics WitnessLinkEndpoints.cs's `request.Label.Length > 100`
// applies.
func UTF16Len(s string) int {
	return utf16Len(s)
}
