import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { EmptyState } from "../components/EmptyState";

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No habits yet" />);
    expect(screen.getByText("No habits yet")).toBeTruthy();
  });

  it("renders message when provided", () => {
    render(<EmptyState title="No habits yet" message="Create your first habit" />);
    expect(screen.getByText("Create your first habit")).toBeTruthy();
  });

  it("renders action button and handles press", () => {
    const onAction = jest.fn();
    render(<EmptyState title="Empty" actionLabel="Add one" onAction={onAction} />);
    fireEvent.press(screen.getByText("Add one"));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("does not render action button when no handler provided", () => {
    render(<EmptyState title="Empty" actionLabel="Add one" />);
    expect(screen.queryByText("Add one")).toBeNull();
  });
});
