import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { TemplatePicker } from "../TemplatePicker";
import { TEMPLATE_CATEGORIES } from "../../data/habitTemplates";

const onSelect = jest.fn();
const onSkip = jest.fn();

function renderPicker() {
  return render(<TemplatePicker onSelect={onSelect} onSkip={onSkip} />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("TemplatePicker", () => {
  // --- Happy path ---

  it("renders the template picker container", () => {
    renderPicker();
    expect(screen.getByTestId("template-picker")).toBeTruthy();
  });

  it("shows all four category tabs", () => {
    renderPicker();
    for (const cat of TEMPLATE_CATEGORIES) {
      expect(screen.getByTestId(`template-tab-${cat.id}`)).toBeTruthy();
      expect(screen.getByText(cat.label)).toBeTruthy();
    }
  });

  it("shows heading and subheading text", () => {
    renderPicker();
    expect(screen.getByText("Start with a template")).toBeTruthy();
    expect(screen.getByText("Pick one to get started, or create your own")).toBeTruthy();
  });

  it("defaults to first category (Health) with its templates visible", () => {
    renderPicker();
    const healthTab = screen.getByTestId("template-tab-health");
    expect(healthTab.props.accessibilityState.selected).toBe(true);

    const healthTemplates = TEMPLATE_CATEGORIES[0].templates;
    for (const t of healthTemplates) {
      expect(screen.getByTestId(`template-${t.id}`)).toBeTruthy();
    }
  });

  it("switching category tab shows that category's templates", () => {
    renderPicker();
    fireEvent.press(screen.getByTestId("template-tab-productivity"));

    const prodTab = screen.getByTestId("template-tab-productivity");
    expect(prodTab.props.accessibilityState.selected).toBe(true);

    const prodTemplates = TEMPLATE_CATEGORIES.find((c) => c.id === "productivity")!.templates;
    for (const t of prodTemplates) {
      expect(screen.getByTestId(`template-${t.id}`)).toBeTruthy();
    }
  });

  it("calls onSelect with the template when a template card is pressed", () => {
    renderPicker();
    const firstTemplate = TEMPLATE_CATEGORIES[0].templates[0];
    fireEvent.press(screen.getByTestId(`template-${firstTemplate.id}`));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(firstTemplate);
  });

  it("calls onSkip when 'Create custom habit' is pressed", () => {
    renderPicker();
    fireEvent.press(screen.getByTestId("template-skip"));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  // --- Edge cases ---

  it("shows frequency badge on each template", () => {
    renderPicker();
    const healthTemplates = TEMPLATE_CATEGORIES[0].templates;
    for (const t of healthTemplates) {
      expect(screen.getByTestId(`template-${t.id}`)).toBeTruthy();
    }
    // Frequency text is rendered (e.g., "daily")
    expect(screen.getAllByText("daily").length).toBeGreaterThan(0);
  });

  it("template cards have correct accessibility labels", () => {
    renderPicker();
    const firstTemplate = TEMPLATE_CATEGORIES[0].templates[0];
    const card = screen.getByTestId(`template-${firstTemplate.id}`);
    expect(card.props.accessibilityLabel).toBe(`${firstTemplate.name} template`);
  });

  it("templates render emoji icons without crashing", () => {
    renderPicker();
    // Cycle through all categories to render all templates
    for (const cat of TEMPLATE_CATEGORIES) {
      fireEvent.press(screen.getByTestId(`template-tab-${cat.id}`));
      for (const t of cat.templates) {
        expect(screen.getByTestId(`template-${t.id}`)).toBeTruthy();
      }
    }
  });

  it("shows description text for each template", () => {
    renderPicker();
    const healthTemplates = TEMPLATE_CATEGORIES[0].templates;
    for (const t of healthTemplates) {
      expect(screen.getByText(t.description)).toBeTruthy();
    }
  });
});
