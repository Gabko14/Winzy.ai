/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { RootNavigator } from "../RootNavigator";

// Mock all screen components to simple stubs
jest.mock("../../screens/TodayScreen", () => ({
  TodayScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="today-screen">
        <RN.Text>TodayScreen</RN.Text>
        {props.onHabitPress && (
          <RN.Pressable testID="habit-press" onPress={() => (props.onHabitPress as (mockId: string) => void)("h1")}>
            <RN.Text>Habit</RN.Text>
          </RN.Pressable>
        )}
        {props.onNotifications && (
          <RN.Pressable testID="notif-press" onPress={props.onNotifications as () => void}>
            <RN.Text>Notifications</RN.Text>
          </RN.Pressable>
        )}
        {props.onCreateHabit && (
          <RN.Pressable testID="create-habit-press" onPress={props.onCreateHabit as () => void}>
            <RN.Text>Create Habit</RN.Text>
          </RN.Pressable>
        )}
      </RN.View>
    );
  },
}));

jest.mock("../../screens/ProfileScreen", () => ({
  ProfileScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="profile-screen">
        <RN.Text>ProfileScreen</RN.Text>
        {props.onEditProfile && (
          <RN.Pressable testID="edit-profile-press" onPress={props.onEditProfile as () => void}>
            <RN.Text>Edit</RN.Text>
          </RN.Pressable>
        )}
      </RN.View>
    );
  },
}));

jest.mock("../../screens/EditProfileScreen", () => ({
  EditProfileScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="edit-profile-screen">
        <RN.Text>EditProfileScreen</RN.Text>
        {props.onBack && (
          <RN.Pressable testID="edit-profile-back" onPress={props.onBack as () => void}>
            <RN.Text>Back</RN.Text>
          </RN.Pressable>
        )}
      </RN.View>
    );
  },
}));

jest.mock("../../screens/HabitDetailScreen", () => ({
  HabitDetailScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="habit-detail-screen">
        <RN.Text>HabitDetailScreen {props.habitId as string}</RN.Text>
        {props.onBack && (
          <RN.Pressable testID="habit-detail-back" onPress={props.onBack as () => void}>
            <RN.Text>Back</RN.Text>
          </RN.Pressable>
        )}
      </RN.View>
    );
  },
}));

jest.mock("../../components/notifications", () => ({
  NotificationScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="notification-screen">
        <RN.Text>NotificationScreen</RN.Text>
        {props.onBack && (
          <RN.Pressable testID="notif-back" onPress={props.onBack as () => void}>
            <RN.Text>Back</RN.Text>
          </RN.Pressable>
        )}
        {props.onMarkAllReadFailed && (
          <RN.Pressable testID="mark-all-read-failed" onPress={props.onMarkAllReadFailed as () => void}>
            <RN.Text>MarkAllReadFailed</RN.Text>
          </RN.Pressable>
        )}
      </RN.View>
    );
  },
  UnreadBadge: ({ count }: { count: number }) => {
    const RN = require("react-native");
    return <RN.Text testID="unread-badge">{count}</RN.Text>;
  },
}));

jest.mock("../../screens/HabitListScreen", () => ({
  HabitListScreen: () => {
    const RN = require("react-native");
    return (
      <RN.View testID="habit-list-screen">
        <RN.Text>HabitListScreen</RN.Text>
      </RN.View>
    );
  },
}));

jest.mock("../../screens/ProfileCompletionScreen", () => ({
  ProfileCompletionScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="profile-completion-screen">
        <RN.Text>ProfileCompletionScreen</RN.Text>
        {props.onComplete && (
          <RN.Pressable testID="complete-profile" onPress={props.onComplete as () => void}>
            <RN.Text>Complete</RN.Text>
          </RN.Pressable>
        )}
      </RN.View>
    );
  },
}));

jest.mock("../../screens/FriendsScreen", () => ({
  FriendsScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="friends-screen">
        <RN.Text>FriendsScreen</RN.Text>
        {props.onAddFriend && (
          <RN.Pressable testID="add-friend-press" onPress={props.onAddFriend as () => void}>
            <RN.Text>Add Friend</RN.Text>
          </RN.Pressable>
        )}
      </RN.View>
    );
  },
}));

jest.mock("../../screens/AddFriendScreen", () => ({
  AddFriendScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="add-friend-screen">
        <RN.Text>AddFriendScreen</RN.Text>
        {props.onBack && (
          <RN.Pressable testID="add-friend-back" onPress={props.onBack as () => void}>
            <RN.Text>Back</RN.Text>
          </RN.Pressable>
        )}
      </RN.View>
    );
  },
}));

jest.mock("../../screens/PublicFlameScreen", () => ({
  PublicFlameScreen: () => {
    const RN = require("react-native");
    return (
      <RN.View testID="public-flame-screen">
        <RN.Text>PublicFlameScreen</RN.Text>
      </RN.View>
    );
  },
}));

jest.mock("../../screens/SignInScreen", () => ({
  SignInScreen: () => {
    const RN = require("react-native");
    return (
      <RN.View testID="sign-in-screen">
        <RN.Text>SignInScreen</RN.Text>
      </RN.View>
    );
  },
}));

jest.mock("../../screens/SignUpScreen", () => ({
  SignUpScreen: () => {
    const RN = require("react-native");
    return (
      <RN.View testID="sign-up-screen">
        <RN.Text>SignUpScreen</RN.Text>
      </RN.View>
    );
  },
}));

jest.mock("../../components/OfflineIndicator", () => ({
  OfflineIndicator: () => null,
}));

jest.mock("expo-status-bar", () => ({
  StatusBar: () => null,
}));

// Mock useUnreadCount
const mockUnreadCount = {
  count: 0,
  decrementBy: jest.fn(),
  resetToZero: jest.fn(),
  refresh: jest.fn(),
};
jest.mock("../../hooks/useUnreadCount", () => ({
  useUnreadCount: () => mockUnreadCount,
}));

// Mock useAuth — default to authenticated
const mockAuth = {
  status: "authenticated" as string,
  user: { displayName: "Test User", username: "testuser", email: "test@test.com" },
  logout: jest.fn(),
};
jest.mock("../../hooks/useAuth", () => ({
  useAuth: () => mockAuth,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.status = "authenticated";
  mockAuth.user = { displayName: "Test User", username: "testuser", email: "test@test.com" };
  mockUnreadCount.count = 0;
});

describe("RootNavigator", () => {
  // --- Auth states ---
  it("shows loading screen when auth is loading", () => {
    mockAuth.status = "loading";
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId("loading-screen")).toBeTruthy();
  });

  it("shows auth navigator when unauthenticated", () => {
    mockAuth.status = "unauthenticated";
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId("sign-in-screen")).toBeTruthy();
  });

  it("shows profile completion when no display name", () => {
    mockAuth.user = { displayName: "", username: "testuser", email: "test@test.com" };
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId("profile-completion-screen")).toBeTruthy();
  });

  // --- Tab navigation ---
  it("renders app shell with tab bar for authenticated user", () => {
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId("app-shell")).toBeTruthy();
    expect(getByTestId("tab-bar")).toBeTruthy();
    expect(getByTestId("today-screen")).toBeTruthy();
  });

  it("defaults to Today tab", () => {
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId("today-screen")).toBeTruthy();
    expect(getByTestId("tab-today").props.accessibilityState).toEqual({ selected: true });
  });

  it("switches to Profile tab", () => {
    const { getByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("tab-profile"));
    expect(getByTestId("profile-screen")).toBeTruthy();
  });

  it("switches to Friends tab", () => {
    const { getByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("tab-friends"));
    expect(getByTestId("friends-screen")).toBeTruthy();
  });

  it("switches to Feed tab", () => {
    const { getByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("tab-feed"));
    expect(getByTestId("feed-tab-content")).toBeTruthy();
  });

  it("can switch back to Today from another tab", () => {
    const { getByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("tab-profile"));
    expect(getByTestId("profile-screen")).toBeTruthy();

    fireEvent.press(getByTestId("tab-today"));
    expect(getByTestId("today-screen")).toBeTruthy();
  });

  // --- Overlay screens ---
  it("navigates to notifications overlay from Today", () => {
    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("notif-press"));
    expect(getByTestId("notification-screen")).toBeTruthy();
    expect(queryByTestId("tab-bar")).toBeNull();
  });

  it("returns from notifications to Today", () => {
    const { getByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("notif-press"));
    expect(getByTestId("notification-screen")).toBeTruthy();

    fireEvent.press(getByTestId("notif-back"));
    expect(getByTestId("today-screen")).toBeTruthy();
    expect(getByTestId("tab-bar")).toBeTruthy();
  });

  it("navigates to habit detail overlay from Today", () => {
    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("habit-press"));
    expect(getByTestId("habit-detail-screen")).toBeTruthy();
    expect(queryByTestId("tab-bar")).toBeNull();
  });

  it("returns from habit detail to Today with tab bar", () => {
    const { getByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("habit-press"));
    fireEvent.press(getByTestId("habit-detail-back"));
    expect(getByTestId("today-screen")).toBeTruthy();
    expect(getByTestId("tab-bar")).toBeTruthy();
  });

  it("navigates to edit profile from Profile tab", () => {
    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("tab-profile"));
    fireEvent.press(getByTestId("edit-profile-press"));
    expect(getByTestId("edit-profile-screen")).toBeTruthy();
    expect(queryByTestId("tab-bar")).toBeNull();
  });

  it("returns from edit profile to Profile tab", () => {
    const { getByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("tab-profile"));
    fireEvent.press(getByTestId("edit-profile-press"));
    fireEvent.press(getByTestId("edit-profile-back"));
    expect(getByTestId("profile-screen")).toBeTruthy();
    expect(getByTestId("tab-bar")).toBeTruthy();
  });

  it("navigates to habits list overlay from create habit", () => {
    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("create-habit-press"));
    expect(getByTestId("habit-list-screen")).toBeTruthy();
    expect(queryByTestId("tab-bar")).toBeNull();
  });

  // --- 3ti: Badge drift fix ---
  it("passes onMarkAllReadFailed to NotificationScreen which calls unreadCount.refresh", () => {
    const { getByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("notif-press"));

    fireEvent.press(getByTestId("mark-all-read-failed"));
    expect(mockUnreadCount.refresh).toHaveBeenCalled();
  });

  // --- 3sc: Profile reachable through deliberate shell navigation ---
  it("Profile tab provides deliberate shell navigation to ProfileScreen", () => {
    const { getByTestId } = render(<RootNavigator />);
    fireEvent.press(getByTestId("tab-profile"));
    expect(getByTestId("profile-screen")).toBeTruthy();
  });
});
