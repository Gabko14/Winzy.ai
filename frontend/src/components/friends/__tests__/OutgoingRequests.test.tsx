import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { OutgoingRequestsList } from "../OutgoingRequests";
import type { OutgoingRequest } from "../../../api/social";

function makeRequest(overrides: Partial<OutgoingRequest> = {}): OutgoingRequest {
  return {
    id: "req1",
    toUserId: "user-xyz",
    direction: "outgoing",
    createdAt: "2026-03-20T00:00:00Z",
    ...overrides,
  };
}

describe("OutgoingRequestsList", () => {
  const defaultProps = {
    outgoing: [makeRequest({ toDisplayName: "Bob", toUsername: "bob" })],
    processingIds: new Set<string>(),
    onCancel: jest.fn(),
  };

  // --- Happy path ---

  it("renders outgoing request with display name", () => {
    const { getByText } = render(<OutgoingRequestsList {...defaultProps} />);
    expect(getByText("Bob")).toBeTruthy();
  });

  it("renders Pending badge", () => {
    const { getByText } = render(<OutgoingRequestsList {...defaultProps} />);
    expect(getByText("Pending")).toBeTruthy();
  });

  it("renders initials in avatar", () => {
    const { getByText } = render(<OutgoingRequestsList {...defaultProps} />);
    expect(getByText("BO")).toBeTruthy();
  });

  it("calls onCancel when Cancel pressed", () => {
    const onCancel = jest.fn();
    const { getByText } = render(
      <OutgoingRequestsList {...defaultProps} onCancel={onCancel} />,
    );

    fireEvent.press(getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledWith(defaultProps.outgoing[0]);
  });

  // --- Edge cases ---

  it("renders multiple requests", () => {
    const requests = [
      makeRequest({ id: "r1", toDisplayName: "Bob" }),
      makeRequest({ id: "r2", toDisplayName: "Carol" }),
    ];
    const { getByText } = render(
      <OutgoingRequestsList
        outgoing={requests}
        processingIds={new Set()}
        onCancel={jest.fn()}
      />,
    );

    expect(getByText("Bob")).toBeTruthy();
    expect(getByText("Carol")).toBeTruthy();
  });

  it("renders nothing for empty list", () => {
    const { toJSON } = render(
      <OutgoingRequestsList
        outgoing={[]}
        processingIds={new Set()}
        onCancel={jest.fn()}
      />,
    );

    expect(toJSON()).toBeNull();
  });

  it("falls back to @username when no displayName", () => {
    const request = makeRequest({ toUsername: "carol" });
    const { getByText } = render(
      <OutgoingRequestsList
        outgoing={[request]}
        processingIds={new Set()}
        onCancel={jest.fn()}
      />,
    );

    expect(getByText("@carol")).toBeTruthy();
  });

  it("falls back to truncated userId when no name or username", () => {
    const request = makeRequest({ toUserId: "abcdef12-3456-7890" });
    const { getByText } = render(
      <OutgoingRequestsList
        outgoing={[request]}
        processingIds={new Set()}
        onCancel={jest.fn()}
      />,
    );

    expect(getByText("User abcdef12")).toBeTruthy();
  });

  // --- Error conditions ---

  it("disables Cancel when request is processing", () => {
    const onCancel = jest.fn();
    const { getByText } = render(
      <OutgoingRequestsList
        outgoing={[makeRequest({ toDisplayName: "Bob" })]}
        processingIds={new Set(["req1"])}
        onCancel={onCancel}
      />,
    );

    fireEvent.press(getByText("Cancel"));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
