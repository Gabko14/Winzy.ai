import { act, waitFor } from "@testing-library/react-native";
import {
  useChallengeInvites,
  useCreateChallengeInvite,
  useRevokeChallengeInvite,
} from "../useChallengeInvites";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";
import { queryKeys } from "../../api/queryKeys";

jest.mock("../../api/challenges", () => ({
  listChallengeInvites: jest.fn(),
  createChallengeInvite: jest.fn(),
  revokeChallengeInvite: jest.fn(),
}));

const {
  listChallengeInvites,
  createChallengeInvite,
  revokeChallengeInvite,
} = jest.requireMock("../../api/challenges");

const invite = {
  id: "inv-1",
  token: "tok",
  url: "https://winzy.ai/ci/tok",
  habitName: "Run",
  habitIcon: "🏃",
  frequency: "daily",
  customDays: [],
  milestoneType: "consistencyTarget",
  targetValue: 60,
  periodDays: 30,
  rewardDescription: "Coffee",
  status: "pending",
  expiresAt: "2026-08-01T00:00:00Z",
  createdAt: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useChallengeInvites", () => {
  it("loads pending invites", async () => {
    listChallengeInvites.mockResolvedValue({ items: [invite] });
    const { result } = renderHookWithQueryClient(() => useChallengeInvites());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.invites).toEqual([invite]);
  });
});

describe("useCreateChallengeInvite", () => {
  it("invalidates the invites query key on success", async () => {
    createChallengeInvite.mockResolvedValue({
      id: "inv-2",
      token: "t2",
      url: "https://winzy.ai/ci/t2",
    });
    listChallengeInvites.mockResolvedValue({ items: [] });

    const { result, queryClient } = renderHookWithQueryClient(() =>
      useCreateChallengeInvite(),
    );
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.create({
        habitName: "Run",
        frequency: "daily",
        milestoneType: "consistencyTarget",
        targetValue: 60,
        periodDays: 30,
        rewardDescription: "Coffee",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.challenges.invites(),
    });
  });
});

describe("useRevokeChallengeInvite", () => {
  it("revokes and invalidates", async () => {
    revokeChallengeInvite.mockResolvedValue(undefined);
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useRevokeChallengeInvite(),
    );
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.revoke("inv-1");
    });

    expect(revokeChallengeInvite).toHaveBeenCalledWith("inv-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.challenges.invites(),
    });
  });
});
