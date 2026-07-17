import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { TodayTodosSection } from "../TodayTodosSection";
import type { TodayTodoItem } from "../../hooks/useTodos";
import type { Todo } from "../../api/todos";

const mockQuickAdd = jest.fn();
const mockToggle = jest.fn();
const mockShowComposer = jest.fn();

let mockState: {
  items: TodayTodoItem[];
  visible: boolean;
  forceShow: boolean;
  creating: boolean;
  showComposer: () => void;
  toggleComplete: (id: string) => void;
  quickAdd: (title: string) => Promise<Todo | null>;
};

jest.mock("../../hooks/useTodos", () => {
  const actual = jest.requireActual("../../hooks/useTodos");
  return {
    ...actual,
    useTodosToday: () => mockState,
  };
});

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "t1",
    title: "Buy milk",
    dueDate: null,
    position: 0,
    completedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    items: [],
    visible: false,
    forceShow: false,
    creating: false,
    showComposer: mockShowComposer,
    toggleComplete: mockToggle,
    quickAdd: mockQuickAdd,
  };
});

describe("TodayTodosSection", () => {
  it("is hidden when empty — shows quiet reveal affordance", () => {
    const { getByTestId, queryByTestId } = render(<TodayTodosSection />);
    expect(queryByTestId("today-todos-section")).toBeNull();
    expect(getByTestId("todos-reveal")).toBeTruthy();
    fireEvent.press(getByTestId("todos-reveal-button"));
    expect(mockShowComposer).toHaveBeenCalled();
  });

  it("renders due today, overdue (gentle tag), and undated", () => {
    mockState.visible = true;
    mockState.items = [
      {
        todo: makeTodo({ id: "over", title: "Overdue task", dueDate: "2026-07-13" }),
        bucket: "overdue",
        exiting: false,
      },
      {
        todo: makeTodo({ id: "today", title: "Due today", dueDate: "2026-07-17" }),
        bucket: "due_today",
        exiting: false,
      },
      {
        todo: makeTodo({ id: "none", title: "Undated", dueDate: null }),
        bucket: "undated",
        exiting: false,
      },
    ];

    const { getByTestId, getByText, queryByTestId } = render(<TodayTodosSection />);

    expect(getByTestId("today-todos-section")).toBeTruthy();
    expect(getByText("Overdue task")).toBeTruthy();
    expect(getByText("Due today")).toBeTruthy();
    expect(getByText("Undated")).toBeTruthy();
    expect(getByTestId("todo-overdue-over")).toBeTruthy();
    expect(getByText(/since /i)).toBeTruthy();
    expect(queryByTestId("todo-overdue-today")).toBeNull();
  });

  it("quick-add submits trimmed title and clears input", async () => {
    mockState.visible = true;
    mockState.forceShow = true;
    mockQuickAdd.mockResolvedValue(makeTodo({ id: "new", title: "Ship it" }));

    const { getByTestId } = render(<TodayTodosSection />);
    const input = getByTestId("todos-quick-add");
    fireEvent.changeText(input, "  Ship it  ");
    fireEvent(input, "submitEditing");

    await waitFor(() => {
      expect(mockQuickAdd).toHaveBeenCalledWith("  Ship it  ");
    });
  });

  it("quick-add empty submit is a no-op", () => {
    mockState.visible = true;
    mockState.forceShow = true;

    const { getByTestId } = render(<TodayTodosSection />);
    fireEvent(getByTestId("todos-quick-add"), "submitEditing");
    expect(mockQuickAdd).not.toHaveBeenCalled();
  });

  it("checkbox toggles completion", () => {
    mockState.visible = true;
    mockState.items = [
      {
        todo: makeTodo({ id: "t1", title: "Toggle me" }),
        bucket: "undated",
        exiting: false,
      },
    ];

    const { getByTestId } = render(<TodayTodosSection />);
    fireEvent.press(getByTestId("todo-toggle-t1"));
    expect(mockToggle).toHaveBeenCalledWith("t1");
  });
});
