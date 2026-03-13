import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { VisibilityPicker, visibilityLabel } from "../VisibilityPicker";
import type { HabitVisibility } from "../../api/visibility";

describe("VisibilityPicker", () => {
  const onChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders all three visibility options", () => {
    render(<VisibilityPicker value="private" onChange={onChange} />);
    expect(screen.getByTestId("visibility-picker")).toBeTruthy();
    expect(screen.getByTestId("visibility-private")).toBeTruthy();
    expect(screen.getByTestId("visibility-friends")).toBeTruthy();
    expect(screen.getByTestId("visibility-public")).toBeTruthy();
  });

  it("marks the selected option", () => {
    render(<VisibilityPicker value="friends" onChange={onChange} />);
    const friends = screen.getByTestId("visibility-friends");
    expect(friends.props.accessibilityState.selected).toBe(true);

    const priv = screen.getByTestId("visibility-private");
    expect(priv.props.accessibilityState.selected).toBe(false);
  });

  it("calls onChange when an option is pressed", () => {
    render(<VisibilityPicker value="private" onChange={onChange} />);
    fireEvent.press(screen.getByTestId("visibility-public"));
    expect(onChange).toHaveBeenCalledWith("public");
  });

  it("does not call onChange when disabled", () => {
    render(<VisibilityPicker value="private" onChange={onChange} disabled />);
    fireEvent.press(screen.getByTestId("visibility-public"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows description text for each option", () => {
    render(<VisibilityPicker value="private" onChange={onChange} />);
    expect(screen.getByText("Only you")).toBeTruthy();
    expect(screen.getByText("Approved friends")).toBeTruthy();
    expect(screen.getByText("Anyone with link")).toBeTruthy();
  });
});

describe("visibilityLabel", () => {
  it.each<[HabitVisibility, string]>([
    ["private", "Private"],
    ["friends", "Friends"],
    ["public", "Public"],
  ])("returns correct label for %s", (value, expected) => {
    expect(visibilityLabel(value)).toBe(expected);
  });
});
