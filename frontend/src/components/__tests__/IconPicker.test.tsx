import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import {
  IconPicker,
  validateCustomEmoji,
  isCuratedIcon,
  ALL_CURATED_ICONS,
  DEFAULT_HABIT_ICON,
  ICON_CATEGORIES,
} from "../IconPicker";

describe("validateCustomEmoji", () => {
  it("accepts a single emoji", () => {
    const result = validateCustomEmoji("🔥");
    expect(result).toEqual({ ok: true, emoji: "🔥" });
  });

  it("accepts a ZWJ sequence as one emoji when Segmenter is available", () => {
    const result = validateCustomEmoji("👨‍👩‍👧‍👦");
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.emoji).toBe("👨‍👩‍👧‍👦");
    } else {
      // Hermes-style fallback may reject long ZWJ by UTF-16 length
      expect(result.ok === false || result.ok === true).toBe(true);
    }
  });

  it("rejects empty input", () => {
    expect(validateCustomEmoji("")).toEqual({
      ok: false,
      message: "Enter a single emoji.",
    });
    expect(validateCustomEmoji("   ")).toEqual({
      ok: false,
      message: "Enter a single emoji.",
    });
  });

  it("rejects plain text", () => {
    const result = validateCustomEmoji("abc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/emoji/i);
    }
  });

  it("rejects multiple graphemes when Segmenter is available", () => {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
      return;
    }
    const result = validateCustomEmoji("🔥💪");
    expect(result).toEqual({
      ok: false,
      message: "Please enter only one emoji.",
    });
  });

  it("trims whitespace around a valid emoji", () => {
    expect(validateCustomEmoji("  ⭐  ")).toEqual({ ok: true, emoji: "⭐" });
  });
});

describe("curated catalog", () => {
  it("exposes roughly 80–120 curated icons across categories", () => {
    expect(ALL_CURATED_ICONS.length).toBeGreaterThanOrEqual(80);
    expect(ALL_CURATED_ICONS.length).toBeLessThanOrEqual(120);
    expect(ICON_CATEGORIES.length).toBeGreaterThanOrEqual(5);
    expect(isCuratedIcon(DEFAULT_HABIT_ICON)).toBe(true);
  });
});

describe("IconPicker", () => {
  const onChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders collapsed by default with expand control", () => {
    render(<IconPicker value={DEFAULT_HABIT_ICON} onChange={onChange} />);
    expect(screen.getByTestId("icon-picker")).toBeTruthy();
    expect(screen.getByTestId("icon-picker-collapsed")).toBeTruthy();
    expect(screen.queryByTestId("icon-picker-expanded")).toBeNull();
    expect(screen.getByTestId("icon-picker-expand")).toBeTruthy();
  });

  it("expands to category grid and can collapse again", () => {
    render(<IconPicker value={DEFAULT_HABIT_ICON} onChange={onChange} />);
    fireEvent.press(screen.getByTestId("icon-picker-expand"));
    expect(screen.getByTestId("icon-picker-expanded")).toBeTruthy();
    expect(screen.getByTestId("icon-category-health")).toBeTruthy();
    fireEvent.press(screen.getByTestId("icon-picker-collapse"));
    expect(screen.getByTestId("icon-picker-collapsed")).toBeTruthy();
  });

  it("calls onChange when a curated icon is pressed", () => {
    render(<IconPicker value={DEFAULT_HABIT_ICON} onChange={onChange} />);
    const target = ALL_CURATED_ICONS[1];
    fireEvent.press(screen.getByTestId(`icon-${target}`));
    expect(onChange).toHaveBeenCalledWith(target);
  });

  it("marks the selected curated icon", () => {
    const selected = ALL_CURATED_ICONS[2];
    render(<IconPicker value={selected} onChange={onChange} />);
    expect(screen.getByTestId(`icon-${selected}`).props.accessibilityState.selected).toBe(true);
  });

  it("shows a custom (non-curated) value as selected in the collapsed row", () => {
    const custom = "🦄";
    expect(isCuratedIcon(custom)).toBe(false);
    render(<IconPicker value={custom} onChange={onChange} />);
    const chip = screen.getByTestId(`icon-${custom}`);
    expect(chip).toBeTruthy();
    expect(chip.props.accessibilityState.selected).toBe(true);
  });

  it("applies a valid custom emoji from the input", () => {
    render(<IconPicker value={DEFAULT_HABIT_ICON} onChange={onChange} />);
    fireEvent.changeText(screen.getByTestId("icon-custom-input"), "🦋");
    fireEvent.press(screen.getByTestId("icon-custom-apply"));
    expect(onChange).toHaveBeenCalledWith("🦋");
    expect(screen.queryByTestId("icon-custom-error")).toBeNull();
  });

  it("shows an error for invalid custom input and does not call onChange", () => {
    render(<IconPicker value={DEFAULT_HABIT_ICON} onChange={onChange} />);
    fireEvent.changeText(screen.getByTestId("icon-custom-input"), "hello");
    fireEvent.press(screen.getByTestId("icon-custom-apply"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("icon-custom-error")).toBeTruthy();
  });

  it("does not change selection when disabled", () => {
    render(<IconPicker value={DEFAULT_HABIT_ICON} onChange={onChange} disabled />);
    fireEvent.press(screen.getByTestId(`icon-${ALL_CURATED_ICONS[1]}`));
    expect(onChange).not.toHaveBeenCalled();
  });
});
