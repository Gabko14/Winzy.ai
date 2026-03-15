import {
  TEMPLATE_CATEGORIES,
  getAllTemplates,
  getTemplateById,
} from "../habitTemplates";

describe("habitTemplates", () => {
  // --- Happy path ---

  it("has all four categories: Health, Productivity, Wellness, Social", () => {
    const labels = TEMPLATE_CATEGORIES.map((c) => c.label);
    expect(labels).toEqual(["Health", "Productivity", "Wellness", "Social"]);
  });

  it("each category has at least one template", () => {
    for (const cat of TEMPLATE_CATEGORIES) {
      expect(cat.templates.length).toBeGreaterThan(0);
    }
  });

  it("every template has required fields", () => {
    const allTemplates = getAllTemplates();
    for (const t of allTemplates) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.icon).toBeTruthy();
      expect(t.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(["daily", "weekly", "custom"]).toContain(t.frequency);
      expect(t.description).toBeTruthy();
    }
  });

  it("getAllTemplates returns flat list of all templates", () => {
    const all = getAllTemplates();
    const expectedCount = TEMPLATE_CATEGORIES.reduce(
      (sum, cat) => sum + cat.templates.length,
      0,
    );
    expect(all.length).toBe(expectedCount);
  });

  it("getTemplateById returns the correct template", () => {
    const meditation = getTemplateById("meditation");
    expect(meditation).toBeDefined();
    expect(meditation!.name).toBe("Meditation");
    expect(meditation!.icon).toBe("\uD83E\uDDD8");
  });

  // --- Edge cases ---

  it("all template IDs are unique", () => {
    const all = getAllTemplates();
    const ids = all.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all category IDs are unique", () => {
    const ids = TEMPLATE_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getTemplateById returns undefined for unknown id", () => {
    expect(getTemplateById("nonexistent")).toBeUndefined();
  });

  it("getTemplateById returns undefined for empty string", () => {
    expect(getTemplateById("")).toBeUndefined();
  });

  // --- Error conditions ---

  it("template data is not empty", () => {
    expect(TEMPLATE_CATEGORIES.length).toBeGreaterThan(0);
    expect(getAllTemplates().length).toBeGreaterThan(0);
  });

  it("no template has an empty name or description", () => {
    for (const t of getAllTemplates()) {
      expect(t.name.trim()).not.toBe("");
      expect(t.description.trim()).not.toBe("");
    }
  });
});
