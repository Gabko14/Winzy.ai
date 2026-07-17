import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { TodosManageScreen } from "../TodosManageScreen";
import type { Todo } from "../../api/todos";
import { reapplyOrderIntent } from "../../hooks/useTodos";

const mockOrderTodos = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockUncomplete = jest.fn();
const mockRefresh = jest.fn();

let mockOpen: Todo[] = [];
let mockCompleted: Todo[] = [];

jest.mock("../../hooks/useTodos", () => {
  const actual = jest.requireActual("../../hooks/useTodos");
  return {
    ...actual,
    useTodosManage: () => ({
      openTodos: mockOpen,
      completedTodos: mockCompleted,
      loading: false,
      error: null,
      updating: false,
      deleting: false,
      ordering: false,
      update: mockUpdate,
      remove: mockRemove,
      uncomplete: mockUncomplete,
      orderTodos: mockOrderTodos,
      refresh: mockRefresh,
    }),
  };
});

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "t1",
    title: "Task",
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
  mockOpen = [
    makeTodo({ id: "a", title: "Alpha", position: 0 }),
    makeTodo({ id: "b", title: "Beta", position: 1 }),
  ];
  mockCompleted = [];
  mockRefresh.mockResolvedValue(undefined);
});

describe("reapplyOrderIntent", () => {
  it("keeps intended order for surviving ids and appends new ones", () => {
    const fresh = [
      makeTodo({ id: "b" }),
      makeTodo({ id: "c" }),
      makeTodo({ id: "a" }),
    ];
    expect(reapplyOrderIntent(["a", "b"], fresh)).toEqual(["a", "b", "c"]);
  });

  it("drops ids that disappeared from the fresh list", () => {
    const fresh = [makeTodo({ id: "b" })];
    expect(reapplyOrderIntent(["a", "b"], fresh)).toEqual(["b"]);
  });
});

describe("TodosManageScreen", () => {
  it("enters reorder mode and commits Done via orderTodos", async () => {
    mockOrderTodos.mockResolvedValue({ retried: false });
    const { getByTestId } = render(<TodosManageScreen onBack={jest.fn()} />);

    fireEvent.press(getByTestId("todos-reorder-toggle"));
    fireEvent.press(getByTestId("todos-move-down-a"));
    fireEvent.press(getByTestId("todos-reorder-done"));

    await waitFor(() => {
      expect(mockOrderTodos).toHaveBeenCalledWith(["b", "a"]);
    });
  });

  it("on 409-retry success path, Done still succeeds after orderTodos resolves", async () => {
    mockOrderTodos.mockResolvedValue({ retried: true });
    const { getByTestId, queryByTestId } = render(
      <TodosManageScreen onBack={jest.fn()} />,
    );

    fireEvent.press(getByTestId("todos-reorder-toggle"));
    fireEvent.press(getByTestId("todos-reorder-done"));

    await waitFor(() => {
      expect(mockOrderTodos).toHaveBeenCalled();
      expect(queryByTestId("todos-order-error")).toBeNull();
    });
  });

  it("shows order error and refreshes when orderTodos fails after stale 409 retry", async () => {
    mockOrderTodos.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "List changed. Please try again.",
    });

    const { getByTestId } = render(<TodosManageScreen onBack={jest.fn()} />);

    fireEvent.press(getByTestId("todos-reorder-toggle"));
    fireEvent.press(getByTestId("todos-reorder-done"));

    await waitFor(() => {
      expect(getByTestId("todos-order-error")).toBeTruthy();
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("expands completed and uncompletes on tap", async () => {
    mockCompleted = [
      makeTodo({
        id: "done1",
        title: "Done task",
        completedAt: "2026-07-17T10:00:00Z",
      }),
    ];
    mockUncomplete.mockResolvedValue(makeTodo({ id: "done1", title: "Done task" }));

    const { getByTestId } = render(<TodosManageScreen onBack={jest.fn()} />);

    fireEvent.press(getByTestId("todos-completed-toggle"));
    fireEvent.press(getByTestId("todos-manage-completed-done1"));

    await waitFor(() => {
      expect(mockUncomplete).toHaveBeenCalledWith("done1");
    });
  });
});
