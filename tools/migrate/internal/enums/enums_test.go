package enums

import (
	"strings"
	"testing"
)

func TestMap_HappyPath_IdentityForDumpValues(t *testing.T) {
	cases := []struct {
		col Column
		in  string
	}{
		{CompletionsCompletionKind, "Full"},
		{CompletionsCompletionKind, "Minimum"},
		{HabitsFrequency, "Daily"},
		{ChallengesStatus, "Active"},
		{ChallengesMilestoneType, "ConsistencyTarget"},
		{FriendshipsStatus, "Accepted"},
		{VisibilitySettingsVisibility, "Public"},
		{VisibilitySettingsVisibility, "Private"},
		{SocialPreferencesDefaultHabitVisibility, "Public"},
		{NotificationsType, "HabitCompleted"},
		{DeviceTokensPlatform, "web_push"},
		{PromisesStatus, "Active"},
	}
	for _, tc := range cases {
		got, err := Map(tc.col, tc.in)
		if err != nil {
			t.Errorf("Map(%s, %q) err = %v", tc.col, tc.in, err)
			continue
		}
		if got != tc.in {
			t.Errorf("Map(%s, %q) = %q, want identity", tc.col, tc.in, got)
		}
	}
}

func TestMap_ErrorCase_UnknownValueRejected(t *testing.T) {
	_, err := Map(HabitsFrequency, "daily") // wire form, not DB form
	if err == nil {
		t.Fatal("Map(habits.frequency, \"daily\") should reject lowercase wire form")
	}
}

func TestMap_ErrorCase_UnknownColumn(t *testing.T) {
	_, err := Map(Column("nope.col"), "Full")
	if err == nil {
		t.Fatal("Map(unknown column) should error")
	}
}

func TestMap_EdgeCase_EmptySourceRejected(t *testing.T) {
	_, err := Map(CompletionsCompletionKind, "")
	if err == nil {
		t.Fatal("Map with empty string should error")
	}
}

func TestMarkdownTable_HappyPath_ContainsRequiredColumns(t *testing.T) {
	md := MarkdownTable()
	for _, col := range []string{
		string(CompletionsCompletionKind),
		string(HabitsFrequency),
		string(PromisesStatus),
		string(ChallengesStatus),
		string(ChallengesMilestoneType),
		string(FriendshipsStatus),
		string(VisibilitySettingsVisibility),
		string(DeviceTokensPlatform),
		string(NotificationsType),
	} {
		if !strings.Contains(md, col) {
			t.Errorf("MarkdownTable missing column %s", col)
		}
	}
}
