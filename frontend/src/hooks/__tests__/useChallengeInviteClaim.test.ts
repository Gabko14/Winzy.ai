import { act, waitFor } from "@testing-library/react-native";
import {
  kindMessageForClaimError,
  useClaimChallengeInvite,
  usePublicChallengeInvite,
} from "../useChallengeInviteClaim";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";
import { queryKeys } from "../../api/queryKeys";
import type { ApiError } from "../../api/types";

jest.mock("../../api/challenges", () => ({
  viewChallengeInvite: jest.fn(),
  claimChallengeInvite: jest.fn(),
}));

const { viewChallengeInvite, claimChallengeInvite } = jest.requireMock("../../api/challenges");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("kindMessageForClaimError", () => {
  it("maps conflict to kind copy", () => {
    const err: ApiError = {
      status: 409,
      code: "conflict",
      message: "This invite is no longer active",
    };
    expect(kindMessageForClaimError(err)).toBe("This invite is no longer active");
  });
});

describe("usePublicChallengeInvite", () => {
  it("loads the public invite", async () => {
    viewChallengeInvite.mockResolvedValue({
      creatorDisplayName: "Alex",
      habitName: "Run",
      habitIcon: null,
      milestoneType: "consistencyTarget",
      targetValue: 60,
      periodDays: 30,
      rewardDescription: "Coffee",
      status: "pending",
    });
    const { result } = renderHookWithQueryClient(() => usePublicChallengeInvite("tok"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.habitName).toBe("Run");
  });
});

describe("useClaimChallengeInvite", () => {
  it("invalidates challenges + friends + habits on success", async () => {
    claimChallengeInvite.mockResolvedValue({ id: "c1" });
    const { result, queryClient } = renderHookWithQueryClient(() => useClaimChallengeInvite());
    const spy = jest.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.claim("tok");
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.challenges.list() });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.friends.list() });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.habits.list() });
  });
});
