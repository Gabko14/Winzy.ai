import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { TextInput } from "../components/TextInput";

describe("TextInput", () => {
  it("renders with label", () => {
    render(<TextInput label="Email" />);
    expect(screen.getByText("Email")).toBeTruthy();
  });

  it("renders with placeholder", () => {
    render(<TextInput label="Email" placeholder="you@example.com" />);
    expect(screen.getByPlaceholderText("you@example.com")).toBeTruthy();
  });

  it("renders hint text", () => {
    render(<TextInput label="Email" hint="We will never share your email" />);
    expect(screen.getByText("We will never share your email")).toBeTruthy();
  });

  it("shows error message in error state", () => {
    render(
      <TextInput
        label="Email"
        validationState="error"
        errorMessage="Invalid email"
        hint="Enter your email"
      />,
    );
    expect(screen.getByText("Invalid email")).toBeTruthy();
    // Hint should be hidden when error is shown
    expect(screen.queryByText("Enter your email")).toBeNull();
  });

  it("calls onChangeText", () => {
    const onChange = jest.fn();
    render(<TextInput label="Name" onChangeText={onChange} />);
    fireEvent.changeText(screen.getByLabelText("Name"), "test");
    expect(onChange).toHaveBeenCalledWith("test");
  });
});
