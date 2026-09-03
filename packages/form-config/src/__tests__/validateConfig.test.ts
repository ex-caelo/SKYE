import { describe, it, expect } from "vitest";
import { validateFormConfig, validateFormConfigOverlay, formatSchemaErrors } from "../validation/validateConfig.js";

const validConfig = {
  title: "Test form",
  list: { id: "list1" },
  pages: { main: { title: "Main" } },
  fields: {
    name: { page: "main", source: "sharepoint", bindTo: "Title", controlType: "text" },
  },
};

describe("validateFormConfig", () => {
  it("accepts a valid base config", () => {
    const result = validateFormConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a config missing a required top-level key (list/pages/fields)", () => {
    const result = validateFormConfig({ title: "No list, pages, or fields" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a sharepoint-sourced field missing its required bindTo", () => {
    const result = validateFormConfig({
      list: { id: "list1" },
      pages: { main: { title: "Main" } },
      fields: { name: { page: "main", source: "sharepoint", controlType: "text" } },
    });
    expect(result.valid).toBe(false);
  });

  it("formatSchemaErrors turns ajv errors into short human-readable lines", () => {
    const result = validateFormConfig({ title: "bad" });
    const lines = formatSchemaErrors(result.errors);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
  });
});

describe("validateFormConfigOverlay", () => {
  it("accepts an empty overlay — nothing is required at the top level", () => {
    expect(validateFormConfigOverlay({}).valid).toBe(true);
  });

  it("accepts an overlay that only loosens one existing field, as a FULL field redeclaration", () => {
    const overlay = {
      fields: {
        price: { page: "yourOrder", source: "sharepoint", bindTo: "Price", controlType: "currency", readonly: false },
      },
    };
    expect(validateFormConfigOverlay(overlay).valid).toBe(true);
  });

  it("rejects an overlay field that's a sparse patch missing the field def's own required controlType", () => {
    const overlay = { fields: { price: { readonly: false } } };
    const result = validateFormConfigOverlay(overlay);
    expect(result.valid).toBe(false);
  });
});
