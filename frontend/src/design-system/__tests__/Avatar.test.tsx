import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Avatar } from "../components/Avatar";

describe("Avatar", () => {
  // --- Happy path ---

  it("renders the given initials", () => {
    render(<Avatar initials="JS" />);
    expect(screen.getByText("JS")).toBeTruthy();
  });

  it("renders with custom testID", () => {
    render(<Avatar initials="AB" testID="profile-avatar" />);
    expect(screen.getByTestId("profile-avatar")).toBeTruthy();
  });

  it("renders with default size md (44px)", () => {
    render(<Avatar initials="TE" testID="md-avatar" />);
    const container = screen.getByTestId("md-avatar");
    expect(container.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 44, height: 44 }),
      ]),
    );
  });

  // --- Size variants ---

  it("renders with size sm (36px)", () => {
    render(<Avatar initials="SM" size="sm" testID="sm-avatar" />);
    const container = screen.getByTestId("sm-avatar");
    expect(container.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 36, height: 36 }),
      ]),
    );
  });

  it("renders with size base (48px)", () => {
    render(<Avatar initials="BA" size="base" testID="base-avatar" />);
    const container = screen.getByTestId("base-avatar");
    expect(container.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 48, height: 48 }),
      ]),
    );
  });

  it("renders with size lg (72px)", () => {
    render(<Avatar initials="LG" size="lg" testID="lg-avatar" />);
    const container = screen.getByTestId("lg-avatar");
    expect(container.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 72, height: 72 }),
      ]),
    );
  });

  it("renders with size xl (80px)", () => {
    render(<Avatar initials="XL" size="xl" testID="xl-avatar" />);
    const container = screen.getByTestId("xl-avatar");
    expect(container.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 80, height: 80 }),
      ]),
    );
  });

  // --- Edge cases ---

  it("renders single-character initials", () => {
    render(<Avatar initials="A" />);
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("renders fallback ?? initials", () => {
    render(<Avatar initials="??" />);
    expect(screen.getByText("??")).toBeTruthy();
  });

  it("renders empty string without crashing", () => {
    render(<Avatar initials="" testID="empty-avatar" />);
    expect(screen.getByTestId("empty-avatar")).toBeTruthy();
  });

  it("applies circular border radius", () => {
    render(<Avatar initials="JS" testID="round-avatar" />);
    const container = screen.getByTestId("round-avatar");
    const flatStyle = Array.isArray(container.props.style)
      ? container.props.style.find((s: Record<string, unknown>) => s.borderRadius !== undefined)
      : container.props.style;
    expect(flatStyle?.borderRadius).toBe(9999);
  });

  // --- Image + fallback ---

  it("shows initials while image is loading", () => {
    render(
      <Avatar
        initials="AL"
        imageUrl="https://example.com/avatar.jpg"
        testID="img-avatar"
      />,
    );
    expect(screen.getByText("AL")).toBeTruthy();
    expect(screen.getByTestId("img-avatar-image")).toBeTruthy();
  });

  it("falls back to initials when image errors", () => {
    render(
      <Avatar
        initials="AL"
        imageUrl="https://example.com/missing.jpg"
        testID="err-avatar"
      />,
    );
    const image = screen.getByTestId("err-avatar-image");
    fireEvent(image, "error");
    expect(screen.getByText("AL")).toBeTruthy();
    expect(screen.queryByTestId("err-avatar-image")).toBeNull();
  });

  it("keeps fixed container size when imageUrl is null", () => {
    render(<Avatar initials="XX" imageUrl={null} testID="null-url-avatar" />);
    const container = screen.getByTestId("null-url-avatar");
    expect(container.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 44, height: 44 }),
      ]),
    );
    expect(screen.queryByTestId("null-url-avatar-image")).toBeNull();
  });
});
