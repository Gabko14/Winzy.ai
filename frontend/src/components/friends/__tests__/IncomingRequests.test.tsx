import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { IncomingRequestsList } from "../IncomingRequests";
import type { IncomingRequest } from "../../../api/social";

function makeRequest(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    id: "req1",
    fromUserId: "user-abc",
    direction: "incoming",
    createdAt: "2026-03-20T00:00:00Z",
    ...overrides,
  };
}

describe("IncomingRequestsList", () => {
  const defaultProps = {
    incoming: [makeRequest({ fromDisplayName: "Alice", fromUsername: "alice" })],
    processingIds: new Set<string>(),
    onAccept: jest.fn(),
    onDecline: jest.fn(),
  };

  // --- Happy path ---

  it("renders incoming request with display name", () => {
    const { getByText } = render(<IncomingRequestsList {...defaultProps} />);
    expect(getByText("Alice")).toBeTruthy();
    expect(getByText("Wants to be friends")).toBeTruthy();
  });

  it("renders initials in avatar", () => {
    const { getByText } = render(<IncomingRequestsList {...defaultProps} />);
    expect(getByText("AL")).toBeTruthy();
  });

  it("calls onAccept when Accept pressed", () => {
    const onAccept = jest.fn();
    const { getByText } = render(
      <IncomingRequestsList {...defaultProps} onAccept={onAccept} />,
    );

    fireEvent.press(getByText("Accept"));
    expect(onAccept).toHaveBeenCalledWith(defaultProps.incoming[0]);
  });

  it("calls onDecline when Decline pressed", () => {
    const onDecline = jest.fn();
    const { getByText } = render(
      <IncomingRequestsList {...defaultProps} onDecline={onDecline} />,
    );

    fireEvent.press(getByText("Decline"));
    expect(onDecline).toHaveBeenCalledWith(defaultProps.incoming[0]);
  });

  // --- Edge cases ---

  it("renders multiple requests", () => {
    const requests = [
      makeRequest({ id: "r1", fromDisplayName: "Alice" }),
      makeRequest({ id: "r2", fromDisplayName: "Bob" }),
    ];
    const { getByText } = render(
      <IncomingRequestsList
        incoming={requests}
        processingIds={new Set()}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />,
    );

    expect(getByText("Alice")).toBeTruthy();
    expect(getByText("Bob")).toBeTruthy();
  });

  it("renders nothing for empty list", () => {
    const { toJSON } = render(
      <IncomingRequestsList
        incoming={[]}
        processingIds={new Set()}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />,
    );

    expect(toJSON()).toBeNull();
  });

  it("falls back to @username when no displayName", () => {
    const request = makeRequest({ fromUsername: "bob" });
    const { getByText } = render(
      <IncomingRequestsList
        incoming={[request]}
        processingIds={new Set()}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />,
    );

    expect(getByText("@bob")).toBeTruthy();
  });

  it("falls back to truncated userId when no name or username", () => {
    const request = makeRequest({ fromUserId: "abcdef12-3456-7890" });
    const { getByText } = render(
      <IncomingRequestsList
        incoming={[request]}
        processingIds={new Set()}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />,
    );

    expect(getByText("User abcdef12")).toBeTruthy();
  });

  // --- Error conditions ---

  it("disables buttons when request is processing", () => {
    const onAccept = jest.fn();
    const { getByLabelText } = render(
      <IncomingRequestsList
        incoming={[makeRequest({ fromDisplayName: "Alice" })]}
        processingIds={new Set(["req1"])}
        onAccept={onAccept}
        onDecline={jest.fn()}
      />,
    );

    // When processing, Accept shows a loading spinner — button is disabled via accessibilityState
    fireEvent.press(getByLabelText("Accept"));
    expect(onAccept).not.toHaveBeenCalled();
  });
});
