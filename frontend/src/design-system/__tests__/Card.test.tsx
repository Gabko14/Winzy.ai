import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { Card } from "../components/Card";

describe("Card", () => {
  it("renders children", () => {
    render(
      <Card>
        <Text>Card content</Text>
      </Card>,
    );
    expect(screen.getByText("Card content")).toBeTruthy();
  });

  it("renders with elevated style without crashing", () => {
    render(
      <Card elevated>
        <Text>Elevated</Text>
      </Card>,
    );
    expect(screen.getByText("Elevated")).toBeTruthy();
  });
});
