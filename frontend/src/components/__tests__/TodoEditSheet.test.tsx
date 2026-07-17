import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { TodoEditSheet } from "../TodoEditSheet";
import type { Todo } from "../../api/todos";

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "t1",
    title: "Buy milk",
    dueDate: "2026-07-20",
    position: 0,
    completedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("TodoEditSheet", () => {
  it("saves title and due date", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const { getByTestId, getByText } = render(
      <TodoEditSheet
        todo={makeTodo()}
        visible
        onClose={onClose}
        onSave={onSave}
      />,
    );

    fireEvent.changeText(getByTestId("todo-edit-title"), "Buy oat milk");
    fireEvent.press(getByText("Save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("t1", {
        title: "Buy oat milk",
        dueDate: "2026-07-20",
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("clears due date to null", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, getByText } = render(
      <TodoEditSheet
        todo={makeTodo()}
        visible
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.press(getByTestId("todo-edit-clear-due"));
    fireEvent.press(getByText("Save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("t1", {
        title: "Buy milk",
        dueDate: null,
      });
    });
  });

  it("rejects empty title", async () => {
    const onSave = jest.fn();
    const { getByTestId, getByText } = render(
      <TodoEditSheet
        todo={makeTodo()}
        visible
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.changeText(getByTestId("todo-edit-title"), "   ");
    fireEvent.press(getByText("Save"));

    expect(getByTestId("todo-edit-error")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});
