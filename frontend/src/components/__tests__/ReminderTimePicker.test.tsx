import { Platform } from "react-native";
import { screen, fireEvent } from "@testing-library/react-native";
import { ReminderTimePicker } from "../ReminderTimePicker";
import { renderWithQueryClient } from "../../test/renderWithQueryClient";

const mockOpen = jest.fn();

jest.mock("@react-native-community/datetimepicker", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  const ReactActual = jest.requireActual("react") as typeof import("react");
  return {
    __esModule: true,
    default: ({
      value,
      onChange,
      testID,
    }: {
      value: Date;
      onChange?: (event: { type: string }, date?: Date) => void;
      testID?: string;
    }) =>
      ReactActual.createElement(
        RN.Pressable,
        {
          testID: testID ?? "native-datetime-picker",
          onPress: () => {
            const next = new Date(value);
            next.setHours(8, 30, 0, 0);
            onChange?.({ type: "set" }, next);
          },
        },
        ReactActual.createElement(
          RN.Text,
          null,
          `${value.getHours()}:${value.getMinutes()}`,
        ),
      ),
    DateTimePickerAndroid: {
      open: (...args: unknown[]) => mockOpen(...args),
    },
  };
});

describe("ReminderTimePicker", () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
    jest.clearAllMocks();
  });

  it("renders a web time input wrapper", () => {
    Object.defineProperty(Platform, "OS", { value: "web", writable: true });
    const onChange = jest.fn();

    renderWithQueryClient(
      <ReminderTimePicker value="19:00" onChange={onChange} />,
    );

    expect(screen.getByTestId("reminder-time-picker")).toBeTruthy();
    expect(screen.queryByTestId("native-datetime-picker")).toBeNull();
  });

  it("uses DateTimePicker on iOS", () => {
    Object.defineProperty(Platform, "OS", { value: "ios", writable: true });
    const onChange = jest.fn();

    renderWithQueryClient(
      <ReminderTimePicker value="19:00" onChange={onChange} />,
    );

    fireEvent.press(screen.getByTestId("native-datetime-picker"));
    expect(onChange).toHaveBeenCalledWith("08:30");
  });

  it("opens Android time dialog on press", () => {
    Object.defineProperty(Platform, "OS", { value: "android", writable: true });
    const onChange = jest.fn();

    renderWithQueryClient(
      <ReminderTimePicker value="19:00" onChange={onChange} />,
    );

    fireEvent.press(screen.getByTestId("reminder-time-picker"));
    expect(mockOpen).toHaveBeenCalledTimes(1);
    const opts = mockOpen.mock.calls[0][0];
    expect(opts.mode).toBe("time");
    opts.onChange({ type: "set" }, new Date(2026, 0, 1, 7, 15));
    expect(onChange).toHaveBeenCalledWith("07:15");
  });
});
