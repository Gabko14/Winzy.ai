// Package enums holds the per-column enum mapping table for winzy.ai-rdc7.9.
//
// Source dumps store C# EF HasConversion<string>() PascalCase names.
// Go DB storage was verified against store writers + FromDB helpers:
//   habits: frequency.dbValue / completionKind.dbValue → "Daily"/"Full"/…
//   social: string(FriendshipStatus|HabitVisibility) → "Accepted"/"Public"/…
//   challenges: string(MilestoneType|ChallengeStatus) → PascalCase
//   notifications.type: string(NotificationType) → "HabitCompleted"/…
//   device_tokens.platform: request strings "web_push"/"expo_push"
// Wire JSON is lowercase (or camelCase for milestones) — that is NOT the DB
// column. Identity transform is correct for every mapped column.
package enums

import "fmt"

// Column identifies a stored enum-string column in the migration mapping table.
type Column string

const (
	CompletionsCompletionKind             Column = "completions.completion_kind"
	HabitsFrequency                       Column = "habits.frequency"
	PromisesStatus                        Column = "promises.status"
	ChallengesStatus                      Column = "challenges.status"
	ChallengesMilestoneType               Column = "challenges.milestone_type"
	FriendshipsStatus                     Column = "friendships.status"
	VisibilitySettingsVisibility          Column = "visibility_settings.visibility"
	SocialPreferencesDefaultHabitVisibility Column = "social_preferences.default_habit_visibility"
	DeviceTokensPlatform                  Column = "device_tokens.platform"
	NotificationsType                     Column = "notifications.type"
)

// Mapping describes one source→target enum transform.
type Mapping struct {
	Column       Column
	SourceSeen   []string // distinct values observed in the 2026-07-12_1945 dumps (empty = table empty)
	TargetValues []string // Go DB values accepted / written by FromDB+dbValue helpers
	Transform    string   // human-readable rule
}

// Table is the full per-enum mapping table (bead EXECUTION STEPS).
var Table = []Mapping{
	{
		Column:       CompletionsCompletionKind,
		SourceSeen:   []string{"Full", "Minimum"},
		TargetValues: []string{"None", "Full", "Minimum"},
		Transform:    "identity (PascalCase; matches habits.completionKindFromDB)",
	},
	{
		Column:       HabitsFrequency,
		SourceSeen:   []string{"Daily"},
		TargetValues: []string{"Daily", "Weekly", "Custom"},
		Transform:    "identity (PascalCase; matches habits.frequencyFromDB)",
	},
	{
		Column:       PromisesStatus,
		SourceSeen:   nil, // promises=0 in archive
		TargetValues: []string{"Active", "Kept", "EndedBelow", "Cancelled"},
		Transform:    "identity (PascalCase; matches habits.promiseStatusFromDB); no source rows",
	},
	{
		Column:       ChallengesStatus,
		SourceSeen:   []string{"Active"},
		TargetValues: []string{"Active", "Completed", "Claimed", "Cancelled", "Expired"},
		Transform:    "identity (PascalCase; matches challenges.challengeStatusFromDB)",
	},
	{
		Column:       ChallengesMilestoneType,
		SourceSeen:   []string{"ConsistencyTarget"},
		TargetValues: []string{"ConsistencyTarget", "DaysInPeriod", "TotalCompletions", "CustomDateRange", "ImprovementMilestone"},
		Transform:    "identity (PascalCase; matches challenges.milestoneTypeFromDB)",
	},
	{
		Column:       FriendshipsStatus,
		SourceSeen:   []string{"Accepted"},
		TargetValues: []string{"Pending", "Accepted"},
		Transform:    "identity (PascalCase; matches social.friendshipStatusFromDB)",
	},
	{
		Column:       VisibilitySettingsVisibility,
		SourceSeen:   []string{"Public", "Private"},
		TargetValues: []string{"Private", "Friends", "Public"},
		Transform:    "identity (PascalCase; matches social.habitVisibilityFromDB)",
	},
	{
		Column:       SocialPreferencesDefaultHabitVisibility,
		SourceSeen:   []string{"Public"},
		TargetValues: []string{"Private", "Friends", "Public"},
		Transform:    "identity (same HabitVisibility enum as visibility_settings.visibility)",
	},
	{
		Column:       DeviceTokensPlatform,
		SourceSeen:   nil, // device_tokens=0 in archive
		TargetValues: []string{"web_push", "expo_push"},
		Transform:    "identity (snake_case strings, not PascalCase — C# stored platform request strings verbatim); no source rows",
	},
	{
		Column:       NotificationsType,
		SourceSeen:   []string{"HabitCompleted", "FriendRequestAccepted", "ChallengeCreated", "FriendRequestSent"},
		TargetValues: []string{"HabitCompleted", "FriendRequestSent", "FriendRequestAccepted", "ChallengeCreated", "ChallengeCompleted"},
		Transform:    "identity (PascalCase; matches notifications.NotificationType constants)",
	},
}

var allowed map[Column]map[string]struct{}

func init() {
	allowed = make(map[Column]map[string]struct{}, len(Table))
	for _, m := range Table {
		set := make(map[string]struct{}, len(m.TargetValues))
		for _, v := range m.TargetValues {
			set[v] = struct{}{}
		}
		allowed[m.Column] = set
	}
}

// Map returns the target DB value for a source enum string.
// Unknown values fail the migration rather than being rewritten silently.
func Map(column Column, source string) (string, error) {
	set, ok := allowed[column]
	if !ok {
		return "", fmt.Errorf("enums: unknown column %q", column)
	}
	if _, ok := set[source]; !ok {
		return "", fmt.Errorf("enums: %s: unsupported source value %q (no transform defined)", column, source)
	}
	return source, nil // identity for every mapped column
}

// MarkdownTable renders the mapping table for the verification report / README.
func MarkdownTable() string {
	out := "| Column | Source values seen | Target DB values | Transform |\n"
	out += "|---|---|---|---|\n"
	for _, m := range Table {
		src := "_(none — empty table)_"
		if len(m.SourceSeen) > 0 {
			src = "`" + join(m.SourceSeen, "`, `") + "`"
		}
		tgt := "`" + join(m.TargetValues, "`, `") + "`"
		out += fmt.Sprintf("| `%s` | %s | %s | %s |\n", m.Column, src, tgt, m.Transform)
	}
	return out
}

func join(vals []string, sep string) string {
	if len(vals) == 0 {
		return ""
	}
	out := vals[0]
	for _, v := range vals[1:] {
		out += sep + v
	}
	return out
}
