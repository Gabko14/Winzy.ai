import React from "react";
import { render, screen } from "@testing-library/react-native";
import { Badge } from "../components/Badge";

describe("Badge", () => {
  it("renders label text", () => {
    render(<Badge label="New" />);
    expect(screen.getByText("New")).toBeTruthy();
  });

  it("renders with different variants without crashing", () => {
    const variants = ["default", "success", "warning", "error", "info"] as const;
    for (const variant of variants) {
      const { unmount } = render(<Badge label={variant} variant={variant} />);
      expect(screen.getByText(variant)).toBeTruthy();
      unmount();
    }
  });
});
