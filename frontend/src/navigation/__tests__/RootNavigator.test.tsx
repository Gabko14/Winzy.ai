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
  HabitListScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="habit-list-screen">
        <RN.Text>HabitListScreen</RN.Text>
        {props.onHabitCreated && (
          <RN.Pressable testID="habit-created-trigger" onPress={props.onHabitCreated as () => void}>
            <RN.Text>Habit Created</RN.Text>
          </RN.Pressable>
        )}
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

jest.mock("../../screens/FeedScreen", () => ({
  FeedScreen: () => {
    const RN = require("react-native");
    return (
      <RN.View testID="feed-screen">
        <RN.Text>FeedScreen</RN.Text>
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

// Mock useOnboarding — default to returning user (already seen welcome)
const mockOnboarding = {
  loading: false,
  hasSeenWelcome: true,
  hasSeenFlameIntro: true,
  markWelcomeSeen: jest.fn(),
  markFlameIntroSeen: jest.fn(),
};
jest.mock("../../hooks/useOnboarding", () => ({
  useOnboarding: () => mockOnboarding,
}));

jest.mock("../../screens/WelcomeScreen", () => ({
  WelcomeScreen: (props: Record<string, unknown>) => {
    const RN = require("react-native");
    return (
      <RN.View testID="welcome-screen">
        <RN.Text>WelcomeScreen</RN.Text>
        {props.onContinue && (
          <RN.Pressable testID="welcome-continue" onPress={props.onContinue as () => void}>
            <RN.Text>Continue</RN.Text>
          </RN.Pressable>
        )}
      </RN.View>
    );
  },
}));

jest.mock("../../screens/FlameIntroModal", () => ({
  FlameIntroModal: ({ visible }: { visible: boolean }) => {
    const RN = require("react-native");
    if (!visible) return null;
    return (
      <RN.View testID="flame-intro-modal">
        <RN.Text>FlameIntroModal</RN.Text>
      </RN.View>
    );
  },
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

// Mock usePendingFriendCount
const mockPendingFriendCount = {
  count: 0,
  refresh: jest.fn(),
};
jest.mock("../../hooks/usePendingFriendCount", () => ({
  usePendingFriendCount: () => mockPendingFriendCount,
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
  mockPendingFriendCount.count = 0;
  mockOnboarding.loading = false;
  mockOnboarding.hasSeenWelcome = true;
  mockOnboarding.hasSeenFlameIntro = true;
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
    expect(getByTestId("feed-screen")).toBeTruthy();
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

  // --- Pending friend requests badge ---
  it("shows badge on Friends tab when pending requests exist", () => {
    mockPendingFriendCount.count = 2;
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId("tab-friends").props.accessibilityLabel).toBe("Friends, 2 unread");
  });

  it("does not show badge on Friends tab when no pending requests", () => {
    mockPendingFriendCount.count = 0;
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId("tab-friends").props.accessibilityLabel).toBe("Friends");
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

  // --- Onboarding ---
  it("shows welcome screen for new users who haven't seen it", () => {
    mockOnboarding.hasSeenWelcome = false;
    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    expect(getByTestId("welcome-screen")).toBeTruthy();
    expect(queryByTestId("app-shell")).toBeNull();
  });

  it("transitions from welcome to app shell when continue is pressed", () => {
    mockOnboarding.hasSeenWelcome = false;
    const { getByTestId } = render(<RootNavigator />);
    expect(getByTestId("welcome-screen")).toBeTruthy();

    // Pressing continue calls markWelcomeSeen which updates the mock
    fireEvent.press(getByTestId("welcome-continue"));
    expect(mockOnboarding.markWelcomeSeen).toHaveBeenCalledTimes(1);
  });

  it("skips welcome screen for returning users", () => {
    mockOnboarding.hasSeenWelcome = true;
    const { getByTestId, queryByTestId } = render(<RootNavigator />);
    expect(getByTestId("app-shell")).toBeTruthy();
    expect(queryByTestId("welcome-screen")).toBeNull();
  });

  it("shows flame intro modal after first habit creation", () => {
    mockOnboarding.hasSeenFlameIntro = false;
    const { getByTestId } = render(<RootNavigator />);

    // Navigate to habits overlay
    fireEvent.press(getByTestId("create-habit-press"));
    expect(getByTestId("habit-list-screen")).toBeTruthy();

    // Simulate habit creation callback
    fireEvent.press(getByTestId("habit-created-trigger"));
    expect(getByTestId("flame-intro-modal")).toBeTruthy();
  });

  it("does not show flame intro if already seen", () => {
    mockOnboarding.hasSeenFlameIntro = true;
    const { getByTestId, queryByTestId } = render(<RootNavigator />);

    fireEvent.press(getByTestId("create-habit-press"));
    fireEvent.press(getByTestId("habit-created-trigger"));
    expect(queryByTestId("flame-intro-modal")).toBeNull();
  });
});
