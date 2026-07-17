import React from "react";
import { Text as RNText } from "react-native";
import { render, fireEvent, act } from "@testing-library/react-native";
import { MeditationScreen, _resetMeditationStorage } from "../MeditationScreen";

const mockPlay = jest.fn();
const mockSeekTo = jest.fn();

jest.mock("expo-audio", () => ({
  useAudioPlayer: () => ({
    play: mockPlay,
    seekTo: mockSeekTo,
  }),
}));

jest.mock("expo-keep-awake", () => ({
  useKeepAwake: jest.fn(),
}));

jest.mock("expo-linear-gradient", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { LinearGradient: View };
});

jest.mock("react-native-svg", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { __esModule: true, default: View, Svg: View, Circle: View };
});

jest.mock("../../assets/sounds/meditation-chime.wav", () => 1, { virtual: true });

jest.mock("../../hooks/useTodayHabits", () => ({
  useTodayHabits: () => ({
    items: [],
    loading: false,
    toggleCompletion: jest.fn(),
    completing: new Set(),
    today: "2026-07-17",
  }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
  _resetMeditationStorage();
  mockPlay.mockClear();
  mockSeekTo.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("MeditationScreen", () => {
  it("shows setup with presets and starts a session", () => {
    const { getByTestId, getByLabelText, getByText } = render(
      <MeditationScreen onClose={jest.fn()} />,
    );

    expect(getByTestId("meditation-setup")).toBeTruthy();
    fireEvent.press(getByTestId("meditation-preset-15"));
    expect(getByTestId("meditation-duration-value")).toHaveTextContent("15 min");

    fireEvent.press(getByLabelText("Begin meditation"));
    expect(getByTestId("meditation-session")).toBeTruthy();
    expect(getByTestId("meditation-clock")).toBeTruthy();
    expect(getByText("15:00")).toBeTruthy();
  });

  it("stepper clamps between 1 and 120", () => {
    const { getByTestId } = render(<MeditationScreen onClose={jest.fn()} />);

    for (let i = 0; i < 20; i++) {
      fireEvent.press(getByTestId("meditation-stepper-dec"));
    }
    expect(getByTestId("meditation-duration-value")).toHaveTextContent("1 min");

    fireEvent.press(getByTestId("meditation-preset-20"));
    for (let i = 0; i < 200; i++) {
      fireEvent.press(getByTestId("meditation-stepper-inc"));
    }
    expect(getByTestId("meditation-duration-value")).toHaveTextContent("120 min");
  });

  it("chimes at start and again at completion", () => {
    const { getByTestId, getByLabelText } = render(<MeditationScreen onClose={jest.fn()} />);

    fireEvent.press(getByTestId("meditation-preset-5"));
    expect(mockPlay).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText("Begin meditation"));
    expect(mockPlay).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(5 * 60_000 + 1000);
    });
    expect(getByTestId("meditation-completion")).toBeTruthy();
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });

  it("tap ring to pause, resume preserves remaining via absolute time", () => {
    const { getByTestId, getByLabelText, getByText } = render(
      <MeditationScreen onClose={jest.fn()} />,
    );

    fireEvent.press(getByTestId("meditation-preset-5"));
    fireEvent.press(getByLabelText("Begin meditation"));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    fireEvent.press(getByLabelText("Pause session"));
    expect(getByText("Paused")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(10 * 60_000);
    });
    fireEvent.press(getByLabelText("Resume session"));
    // ~4:00 remaining (ceil)
    expect(getByTestId("meditation-clock").props.children).toMatch(/^4:/);
  });

  it("tap ring while paused also resumes", () => {
    const { getByTestId, getByLabelText, queryByText } = render(
      <MeditationScreen onClose={jest.fn()} />,
    );

    fireEvent.press(getByLabelText("Begin meditation"));
    fireEvent.press(getByTestId("meditation-ring"));
    expect(queryByText("Paused")).toBeTruthy();

    fireEvent.press(getByTestId("meditation-ring"));
    expect(queryByText("Paused")).toBeNull();
  });

  it("reaches completion when endsAt passes (hidden-through-end)", () => {
    const { getByTestId, getByLabelText } = render(<MeditationScreen onClose={jest.fn()} />);

    fireEvent.press(getByTestId("meditation-preset-5"));
    fireEvent.press(getByLabelText("Begin meditation"));

    act(() => {
      jest.advanceTimersByTime(5 * 60_000 + 1000);
    });

    expect(getByTestId("meditation-completion")).toBeTruthy();
    expect(getByLabelText("Done")).toBeTruthy();
  });

  it("end-early confirm closes only after confirm", () => {
    const onClose = jest.fn();
    const { getByTestId, getByLabelText, getByText } = render(
      <MeditationScreen onClose={onClose} />,
    );

    fireEvent.press(getByLabelText("Begin meditation"));
    fireEvent.press(getByTestId("meditation-close"));
    expect(onClose).not.toHaveBeenCalled();
    expect(getByText("End session?")).toBeTruthy();

    fireEvent.press(getByLabelText("Keep going"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.press(getByTestId("meditation-close"));
    fireEvent.press(getByLabelText("Confirm end session"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("paused controls offer end session with confirm", () => {
    const onClose = jest.fn();
    const { getByTestId, getByLabelText } = render(<MeditationScreen onClose={onClose} />);

    fireEvent.press(getByLabelText("Begin meditation"));
    fireEvent.press(getByTestId("meditation-ring"));

    fireEvent.press(getByLabelText("End session early"));
    expect(onClose).not.toHaveBeenCalled();
    expect(getByTestId("meditation-end-confirm")).toBeTruthy();

    fireEvent.press(getByLabelText("Confirm end session"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close from setup does not confirm", () => {
    const onClose = jest.fn();
    const { getByTestId } = render(<MeditationScreen onClose={onClose} />);
    fireEvent.press(getByTestId("meditation-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders optional completionExtra seam", () => {
    const { getByTestId, getByLabelText, getByText } = render(
      <MeditationScreen
        onClose={jest.fn()}
        completionExtra={<RNText>Log slot</RNText>}
      />,
    );

    fireEvent.press(getByTestId("meditation-preset-5"));
    fireEvent.press(getByLabelText("Begin meditation"));
    act(() => {
      jest.advanceTimersByTime(5 * 60_000 + 500);
    });

    expect(getByTestId("meditation-completion")).toBeTruthy();
    expect(getByText("Log slot")).toBeTruthy();
  });

  it("clears interval on unmount (no leak)", () => {
    const clearSpy = jest.spyOn(global, "clearInterval");
    const { getByLabelText, unmount } = render(<MeditationScreen onClose={jest.fn()} />);
    fireEvent.press(getByLabelText("Begin meditation"));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
