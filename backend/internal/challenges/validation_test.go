package challenges

import "testing"

func TestValidateCreateRequest_SelfChallenge_BeforeRewardCheck(t *testing.T) {
	// ChallengeEndpoints.cs:39-47 — HabitId, RecipientId, then self-check,
	// then RewardDescription. A self+blank-reward request must surface
	// "Cannot challenge yourself", not "RewardDescription is required".
	err := validateCreateRequest("user-a", CreateChallengeRequest{
		HabitID:           "11111111-1111-1111-1111-111111111111",
		RecipientID:       "user-a",
		MilestoneType:     MilestoneConsistencyTarget,
		TargetValue:       80,
		PeriodDays:        30,
		RewardDescription: "   ",
	})
	if err == nil || err.Error() != "Cannot challenge yourself" {
		t.Fatalf("got %v, want Cannot challenge yourself", err)
	}
}

func TestValidateCreateRequest_BlankReward_AfterSelfCheck(t *testing.T) {
	err := validateCreateRequest("user-a", CreateChallengeRequest{
		HabitID:           "11111111-1111-1111-1111-111111111111",
		RecipientID:       "22222222-2222-2222-2222-222222222222",
		MilestoneType:     MilestoneConsistencyTarget,
		TargetValue:       80,
		PeriodDays:        30,
		RewardDescription: "",
	})
	if err == nil || err.Error() != "RewardDescription is required" {
		t.Fatalf("got %v, want RewardDescription is required", err)
	}
}
