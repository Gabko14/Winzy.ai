import React from "react";
import { render } from "@testing-library/react-native";
import { Flame, FlameLevel, FlameSize } from "../components/Flame";
import { flameColors, getFlameGlow } from "../tokens/flame";

describe("Flame", () => {
  // --- Rendering for all flame levels ---

  const levels: FlameLevel[] = ["none", "ember", "steady", "strong", "blazing"];

  it.each(levels)("renders without crashing for flameLevel=%s", (level) => {
    const { getByTestId } = render(<Flame flameLevel={level} />);
    expect(getByTestId("flame-container")).toBeTruthy();
  });

  it.each(levels)("renders all flame layers for flameLevel=%s", (level) => {
    const { getByTestId } = render(<Flame flameLevel={level} />);
    expect(getByTestId("flame-glow")).toBeTruthy();
    expect(getByTestId("flame-body")).toBeTruthy();
    expect(getByTestId("flame-inner")).toBeTruthy();
    expect(getByTestId("flame-core")).toBeTruthy();
  });

  // --- The flame never fully disappears ---

  it("renders visible ember even at flameLevel=none", () => {
    const { getByTestId } = render(<Flame flameLevel="none" />);
    const body = getByTestId("flame-body");
    // Body should exist and have non-zero dimensions
    expect(body).toBeTruthy();
    // The container should be present with dimensions
    const container = getByTestId("flame-container");
    expect(container.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
      ]),
    );
  });

  // --- Size variants ---

  const sizes: FlameSize[] = ["sm", "md", "lg"];

  const expectedDimensions: Record<FlameSize, { width: number; height: number }> = {
    sm: { width: 24, height: 32 },
    md: { width: 36, height: 48 },
    lg: { width: 56, height: 72 },
  };

  it.each(sizes)("renders correct container dimensions for size=%s", (size) => {
    const { getByTestId } = render(<Flame flameLevel="steady" size={size} />);
    const container = getByTestId("flame-container");
    const expected = expectedDimensions[size];
    expect(container.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining(expected)]),
    );
  });

  it("defaults to md size when size prop is omitted", () => {
    const { getByTestId } = render(<Flame flameLevel="steady" />);
    const container = getByTestId("flame-container");
    expect(container.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 36, height: 48 })]),
    );
  });

  // --- Flame level visual differentiation ---

  describe("visual config per flame level", () => {
    it("uses cold color for none level", () => {
      const { getByTestId } = render(<Flame flameLevel="none" />);
      const body = getByTestId("flame-body");
      expect(body.props.style).toEqual(
        expect.objectContaining({ backgroundColor: flameColors.cold }),
      );
    });

    it("uses cool color for ember level", () => {
      const { getByTestId } = render(<Flame flameLevel="ember" />);
      const body = getByTestId("flame-body");
      expect(body.props.style).toEqual(
        expect.objectContaining({ backgroundColor: flameColors.cool }),
      );
    });

    it("uses warm color for steady level", () => {
      const { getByTestId } = render(<Flame flameLevel="steady" />);
      const body = getByTestId("flame-body");
      expect(body.props.style).toEqual(
        expect.objectContaining({ backgroundColor: flameColors.warm }),
      );
    });

    it("uses hot color for strong level", () => {
      const { getByTestId } = render(<Flame flameLevel="strong" />);
      const body = getByTestId("flame-body");
      expect(body.props.style).toEqual(
        expect.objectContaining({ backgroundColor: flameColors.hot }),
      );
    });

    it("uses inferno color for blazing level", () => {
      const { getByTestId } = render(<Flame flameLevel="blazing" />);
      const body = getByTestId("flame-body");
      expect(body.props.style).toEqual(
        expect.objectContaining({ backgroundColor: flameColors.inferno }),
      );
    });
  });

  // --- Opacity scales with level ---

  describe("opacity increases with flame level", () => {
    const expectedOpacities: Record<FlameLevel, number> = {
      none: 0.4,
      ember: 0.7,
      steady: 0.85,
      strong: 0.95,
      blazing: 1,
    };

    it.each(levels)("flameLevel=%s has expected body opacity", (level) => {
      const { getByTestId } = render(<Flame flameLevel={level} />);
      const body = getByTestId("flame-body");
      expect(body.props.style).toEqual(
        expect.objectContaining({ opacity: expectedOpacities[level] }),
      );
    });

    it("opacity is strictly increasing across levels", () => {
      const opacities = levels.map((l) => expectedOpacities[l]);
      for (let i = 1; i < opacities.length; i++) {
        expect(opacities[i]).toBeGreaterThan(opacities[i - 1]);
      }
    });
  });

  // --- Consistency prop for glow ---

  describe("consistency prop controls glow", () => {
    it("uses provided consistency for glow calculation", () => {
      const { getByTestId } = render(<Flame flameLevel="steady" consistency={75} />);
      const glow = getByTestId("flame-glow");
      // Glow should have the flame color as background
      expect(glow.props.style).toEqual(
        expect.objectContaining({ backgroundColor: flameColors.warm }),
      );
    });

    it("falls back to default consistency when prop is omitted", () => {
      const { getByTestId: withProp } = render(<Flame flameLevel="ember" consistency={50} />);
      const { getByTestId: withoutProp } = render(<Flame flameLevel="ember" />);
      // Both should render without errors — glow values will differ
      expect(withProp("flame-glow")).toBeTruthy();
      expect(withoutProp("flame-glow")).toBeTruthy();
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("handles consistency=0 without errors", () => {
      const { getByTestId } = render(<Flame flameLevel="none" consistency={0} />);
      expect(getByTestId("flame-container")).toBeTruthy();
    });

    it("handles consistency=100 without errors", () => {
      const { getByTestId } = render(<Flame flameLevel="blazing" consistency={100} />);
      expect(getByTestId("flame-container")).toBeTruthy();
    });

    it("handles consistency above 100 (clamped by getFlameGlow)", () => {
      const { getByTestId } = render(<Flame flameLevel="blazing" consistency={150} />);
      expect(getByTestId("flame-container")).toBeTruthy();
      // getFlameGlow clamps at 0.6 for values >= 100
      expect(getFlameGlow(150)).toBe(0.6);
    });

    it("handles negative consistency gracefully", () => {
      const { getByTestId } = render(<Flame flameLevel="none" consistency={-10} />);
      expect(getByTestId("flame-container")).toBeTruthy();
    });
  });

  // --- Accessibility ---

  describe("accessibility", () => {
    it("has image accessibility role", () => {
      const { getByTestId } = render(<Flame flameLevel="steady" />);
      const container = getByTestId("flame-container");
      expect(container.props.accessibilityRole).toBe("image");
    });

    it("generates default accessibility label with flame level", () => {
      const { getByTestId } = render(<Flame flameLevel="strong" />);
      const container = getByTestId("flame-container");
      expect(container.props.accessibilityLabel).toContain("strong");
    });

    it("includes consistency in default accessibility label", () => {
      const { getByTestId } = render(<Flame flameLevel="strong" consistency={72} />);
      const container = getByTestId("flame-container");
      expect(container.props.accessibilityLabel).toContain("72%");
    });

    it("uses custom accessibility label when provided", () => {
      const { getByTestId } = render(
        <Flame flameLevel="blazing" accessibilityLabel="My habit flame" />,
      );
      const container = getByTestId("flame-container");
      expect(container.props.accessibilityLabel).toBe("My habit flame");
    });
  });

  // --- All size + level combinations ---

  describe("all size/level combinations render", () => {
    for (const size of sizes) {
      for (const level of levels) {
        it(`renders size=${size} level=${level}`, () => {
          const { getByTestId } = render(<Flame flameLevel={level} size={size} />);
          expect(getByTestId("flame-container")).toBeTruthy();
          expect(getByTestId("flame-body")).toBeTruthy();
        });
      }
    }
  });
});
