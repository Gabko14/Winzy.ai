/* eslint-disable @typescript-eslint/no-require-imports */
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert, Platform, Share } from "react-native";
import { renderWithQueryClient } from "../../test/renderWithQueryClient";
import {
  CreateChallengeInviteScreen,
  buildInviteShareMessage,
  copyInviteText,
  shareInviteText,
} from "../CreateChallengeInviteScreen";

const mockCreate = jest.fn();
const mockRevoke = jest.fn();
const mockInvites = jest.fn(() => ({
  invites: [],
  loading: false,
  error: null,
  refresh: jest.fn(),
}));

jest.mock("../../hooks/useChallengeInvites", () => ({
  useChallengeInvites: () => mockInvites(),
  useCreateChallengeInvite: (onSuccess?: (r: unknown) => void) => ({
    loading: false,
    error: null,
    create: async (req: unknown) => {
      const result = await mockCreate(req);
      onSuccess?.(result);
      return result;
    },
  }),
  useRevokeChallengeInvite: () => ({
    loading: false,
    error: null,
    revoke: mockRevoke,
  }),
}));

jest.mock("../../components/IconPicker", () => {
  const React = require("react") as typeof import("react");
  const { Pressable, Text } = require("react-native") as typeof import("react-native");
  return {
    DEFAULT_HABIT_ICON: "💪",
    IconPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      <Pressable testID="icon-picker" onPress={() => onChange("🏃")}>
        <Text>{value}</Text>
      </Pressable>
    ),
  };
});

jest.spyOn(Alert, "alert");

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({
    id: "inv-1",
    token: "tok",
    url: "https://winzy.ai/ci/tok",
  });
  mockInvites.mockReturnValue({
    invites: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
  });
});

describe("buildInviteShareMessage / copy / share", () => {
  it("builds the ready-made share message", () => {
    expect(buildInviteShareMessage("Morning run", "Coffee", "https://winzy.ai/ci/x")).toBe(
      "I challenge you to Morning run — Coffee. https://winzy.ai/ci/x",
    );
  });

  it("copyInviteText uses clipboard on web", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });

    await expect(copyInviteText("https://winzy.ai/ci/x")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://winzy.ai/ci/x");

    Platform.OS = originalOS;
  });

  it("shareInviteText falls back to copy when Web Share is unavailable", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });

    await expect(shareInviteText("msg", "https://winzy.ai/ci/x")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://winzy.ai/ci/x");

    Platform.OS = originalOS;
  });

  it("shareInviteText uses RN Share on native", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "ios";
    const shareSpy = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });

    await expect(shareInviteText("msg", "https://winzy.ai/ci/x")).resolves.toBe("shared");
    expect(shareSpy).toHaveBeenCalled();

    shareSpy.mockRestore();
    Platform.OS = originalOS;
  });
});

describe("CreateChallengeInviteScreen proposal step validation", () => {
  it("disables continue until habit name is set", () => {
    const { getByRole, getByTestId } = renderWithQueryClient(
      <CreateChallengeInviteScreen />,
    );
    expect(getByTestId("step-1-propose-habit")).toBeTruthy();
    expect(getByRole("button", { name: "Continue to next step" })).toBeDisabled();
  });

  it("requires custom days for weekly frequency", () => {
    const { getByRole, getByTestId } = renderWithQueryClient(
      <CreateChallengeInviteScreen />,
    );

    fireEvent.changeText(getByTestId("invite-habit-name"), "Morning run");
    fireEvent.press(getByTestId("freq-weekly"));

    expect(getByRole("button", { name: "Continue to next step" })).toBeDisabled();
    fireEvent.press(getByTestId("day-Mon"));
    expect(getByRole("button", { name: "Continue to next step" })).not.toBeDisabled();
  });

  it("walks through steps and creates an invite", async () => {
    const { getByRole, getByTestId, getByText } = renderWithQueryClient(
      <CreateChallengeInviteScreen />,
    );

    fireEvent.changeText(getByTestId("invite-habit-name"), "Morning run");
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    expect(getByTestId("step-2-set-target")).toBeTruthy();

    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    expect(getByTestId("step-3-reward")).toBeTruthy();

    fireEvent.changeText(getByTestId("reward-input"), "Grab coffee together");
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    expect(getByTestId("step-4-preview")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Create challenge invite" }));
    });

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          habitName: "Morning run",
          frequency: "daily",
          milestoneType: "consistencyTarget",
          rewardDescription: "Grab coffee together",
        }),
      );
      expect(getByTestId("create-challenge-invite-success")).toBeTruthy();
      expect(getByText("https://winzy.ai/ci/tok")).toBeTruthy();
    });
  });

  it("surfaces the 20-pending cap kindly", async () => {
    mockCreate.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "Maximum of 20 pending invites reached",
    });

    const { getByRole, getByTestId } = renderWithQueryClient(
      <CreateChallengeInviteScreen />,
    );

    fireEvent.changeText(getByTestId("invite-habit-name"), "Yoga");
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    fireEvent.changeText(getByTestId("reward-input"), "Sunset walk");
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));

    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Create challenge invite" }));
    });

    await waitFor(() => {
      expect(getByTestId("submit-error")).toBeTruthy();
    });
    expect(getByTestId("submit-error")).toHaveTextContent(/20 pending invites/);
  });
});
