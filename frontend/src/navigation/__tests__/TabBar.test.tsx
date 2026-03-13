import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { TabBar, type TabDefinition } from "../TabBar";

const defaultTabs: TabDefinition[] = [
  { id: "today", label: "Today", icon: "\u2600\uFE0F" },
  { id: "friends", label: "Friends", icon: "\uD83D\uDC65" },
  { id: "feed", label: "Feed", icon: "\uD83D\uDCE3" },
  { id: "profile", label: "Profile", icon: "\uD83D\uDC64" },
];

describe("TabBar", () => {
  // Happy path
  it("renders all tabs with labels", () => {
    const onTabPress = jest.fn();
    const { getByText } = render(
      <TabBar tabs={defaultTabs} activeTab="today" onTabPress={onTabPress} />,
    );

    expect(getByText("Today")).toBeTruthy();
    expect(getByText("Friends")).toBeTruthy();
    expect(getByText("Feed")).toBeTruthy();
    expect(getByText("Profile")).toBeTruthy();
  });

  it("marks active tab with selected accessibility state", () => {
    const onTabPress = jest.fn();
    const { getByTestId } = render(
      <TabBar tabs={defaultTabs} activeTab="profile" onTabPress={onTabPress} />,
    );

    expect(getByTestId("tab-profile").props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId("tab-today").props.accessibilityState).toEqual({ selected: false });
  });

  it("calls onTabPress with tab id when pressed", () => {
    const onTabPress = jest.fn();
    const { getByTestId } = render(
      <TabBar tabs={defaultTabs} activeTab="today" onTabPress={onTabPress} />,
    );

    fireEvent.press(getByTestId("tab-friends"));
    expect(onTabPress).toHaveBeenCalledWith("friends");

    fireEvent.press(getByTestId("tab-profile"));
    expect(onTabPress).toHaveBeenCalledWith("profile");
  });

  it("renders tab bar container with tablist role", () => {
    const onTabPress = jest.fn();
    const { getByTestId } = render(
      <TabBar tabs={defaultTabs} activeTab="today" onTabPress={onTabPress} />,
    );

    expect(getByTestId("tab-bar").props.accessibilityRole).toBe("tablist");
  });

  // Badge display
  it("renders badge when tab has badge > 0", () => {
    const onTabPress = jest.fn();
    const tabsWithBadge: TabDefinition[] = [
      { id: "today", label: "Today", icon: "\u2600\uFE0F", badge: 3 },
      { id: "friends", label: "Friends", icon: "\uD83D\uDC65" },
      { id: "feed", label: "Feed", icon: "\uD83D\uDCE3" },
      { id: "profile", label: "Profile", icon: "\uD83D\uDC64" },
    ];

    const { getByTestId } = render(
      <TabBar tabs={tabsWithBadge} activeTab="today" onTabPress={onTabPress} />,
    );

    // Badge accessible label includes unread count
    expect(getByTestId("tab-today").props.accessibilityLabel).toBe("Today, 3 unread");
  });

  it("does not show badge when count is 0", () => {
    const onTabPress = jest.fn();
    const tabsWithZeroBadge: TabDefinition[] = [
      { id: "today", label: "Today", icon: "\u2600\uFE0F", badge: 0 },
      { id: "friends", label: "Friends", icon: "\uD83D\uDC65" },
      { id: "feed", label: "Feed", icon: "\uD83D\uDCE3" },
      { id: "profile", label: "Profile", icon: "\uD83D\uDC64" },
    ];

    const { getByTestId } = render(
      <TabBar tabs={tabsWithZeroBadge} activeTab="today" onTabPress={onTabPress} />,
    );

    expect(getByTestId("tab-today").props.accessibilityLabel).toBe("Today");
  });

  it("does not show badge when badge is undefined", () => {
    const onTabPress = jest.fn();
    const { getByTestId } = render(
      <TabBar tabs={defaultTabs} activeTab="today" onTabPress={onTabPress} />,
    );

    expect(getByTestId("tab-today").props.accessibilityLabel).toBe("Today");
  });

  // Edge cases
  it("handles pressing already-active tab", () => {
    const onTabPress = jest.fn();
    const { getByTestId } = render(
      <TabBar tabs={defaultTabs} activeTab="today" onTabPress={onTabPress} />,
    );

    fireEvent.press(getByTestId("tab-today"));
    expect(onTabPress).toHaveBeenCalledWith("today");
  });

  it("renders with single tab", () => {
    const onTabPress = jest.fn();
    const singleTab: TabDefinition[] = [
      { id: "today", label: "Today", icon: "\u2600\uFE0F" },
    ];

    const { getByText } = render(
      <TabBar tabs={singleTab} activeTab="today" onTabPress={onTabPress} />,
    );

    expect(getByText("Today")).toBeTruthy();
  });
});
