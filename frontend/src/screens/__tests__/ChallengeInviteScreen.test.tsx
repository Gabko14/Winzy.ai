/* eslint-disable @typescript-eslint/no-require-imports */
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithQueryClient } from "../../test/renderWithQueryClient";
import { ChallengeInviteScreen } from "../ChallengeInviteScreen";
import {
  clearPendingChallengeInviteToken,
  getPendingChallengeInviteToken,
} from "../../utils/challengeInviteToken";

const mockView = jest.fn();
const mockClaim = jest.fn();

jest.mock("../../api/challenges", () => ({
  viewChallengeInvite: (...args: unknown[]) => mockView(...args),
  claimChallengeInvite: (...args: unknown[]) => mockClaim(...args),
}));

jest.mock("../../pwa/register-sw", () => ({
  updateChallengeInviteOgTags: jest.fn(),
}));

const pendingInvite = {
  creatorDisplayName: "Alex",
  habitName: "Morning run",
  habitIcon: "🏃",
  milestoneType: "consistencyTarget" as const,
  targetValue: 60,
  periodDays: 30,
  rewardDescription: "Grab coffee",
  status: "pending" as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearPendingChallengeInviteToken();
  mockView.mockResolvedValue(pendingInvite);
  mockClaim.mockResolvedValue({ id: "c1" });
});

describe("ChallengeInviteScreen", () => {
  it("renders pending invite terms and join CTA when logged out", async () => {
    const onNavigateToSignUp = jest.fn();
    const { getByTestId, getByText, getByRole } = renderWithQueryClient(
      <ChallengeInviteScreen
        token="tok123"
        isAuthenticated={false}
        onNavigateToSignUp={onNavigateToSignUp}
        onAccepted={jest.fn()}
      />,
    );

    await waitFor(() => expect(getByTestId("challenge-invite-screen")).toBeTruthy());
    expect(getByText("Alex challenges you")).toBeTruthy();
    expect(getByTestId("invite-habit")).toHaveTextContent(/Morning run/);
    expect(getByTestId("invite-goal")).toHaveTextContent("60% consistency over 30 days");
    expect(getByTestId("invite-reward")).toHaveTextContent("Grab coffee");

    fireEvent.press(getByRole("button", { name: "Join Winzy and accept challenge" }));
    expect(onNavigateToSignUp).toHaveBeenCalled();
    expect(getPendingChallengeInviteToken()).toBe("tok123");
  });

  it("shows accept CTA when logged in and claims", async () => {
    const onAccepted = jest.fn();
    const { getByTestId, getByRole } = renderWithQueryClient(
      <ChallengeInviteScreen
        token="tok123"
        isAuthenticated
        onNavigateToSignUp={jest.fn()}
        onAccepted={onAccepted}
      />,
    );

    await waitFor(() => expect(getByTestId("challenge-invite-screen")).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Accept challenge invite" }));
    });

    await waitFor(() => {
      expect(mockClaim).toHaveBeenCalledWith("tok123");
      expect(onAccepted).toHaveBeenCalledWith("Morning run");
    });
  });

  it("shows kind claimed state", async () => {
    mockView.mockResolvedValue({ ...pendingInvite, status: "claimed" });
    const { getByTestId } = renderWithQueryClient(
      <ChallengeInviteScreen
        token="tok"
        isAuthenticated={false}
        onNavigateToSignUp={jest.fn()}
        onAccepted={jest.fn()}
      />,
    );
    await waitFor(() => expect(getByTestId("challenge-invite-claimed")).toBeTruthy());
  });

  it("shows kind inactive state for expired", async () => {
    mockView.mockResolvedValue({ ...pendingInvite, status: "expired" });
    const { getByTestId } = renderWithQueryClient(
      <ChallengeInviteScreen
        token="tok"
        isAuthenticated={false}
        onNavigateToSignUp={jest.fn()}
        onAccepted={jest.fn()}
      />,
    );
    await waitFor(() => expect(getByTestId("challenge-invite-inactive")).toBeTruthy());
  });

  it("surfaces kind messaging on claim 409", async () => {
    mockClaim.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "This invite is no longer active",
    });
    const { getByTestId, getByRole } = renderWithQueryClient(
      <ChallengeInviteScreen
        token="tok123"
        isAuthenticated
        onNavigateToSignUp={jest.fn()}
        onAccepted={jest.fn()}
      />,
    );

    await waitFor(() => expect(getByTestId("challenge-invite-screen")).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Accept challenge invite" }));
    });
    await waitFor(() => expect(getByTestId("claim-error")).toBeTruthy());
    expect(getByTestId("claim-error")).toHaveTextContent(/no longer active/);
  });
});
