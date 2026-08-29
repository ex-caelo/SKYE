import { describe, it, expect } from "vitest";
import { lintOverlay, assertOverlayIsAdditive } from "../merge/lintOverlay.js";
import type { FormConfig } from "../schema/types.js";

const base: FormConfig = {
  list: { id: "list-1" },
  pages: { p1: { title: "Page 1" } },
  fields: {
    name: { page: "p1", source: "sharepoint", bindTo: "Title", controlType: "text", required: false, maxlength: 255 },
    price: { page: "p1", source: "sharepoint", bindTo: "Price", controlType: "currency", readonly: true },
  },
};

describe("lintOverlay", () => {
  it("flags an overlay that adds a stricter constraint", () => {
    const issues = lintOverlay(base, { fields: { name: { required: true, maxlength: 10 } } });
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("fields.name.required");
    expect(paths).toContain("fields.name.maxlength");
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("does not flag loosening a constraint", () => {
    const issues = lintOverlay(base, { fields: { price: { readonly: false } } });
    expect(issues).toHaveLength(0);
  });

  it("does not flag a brand-new field the overlay adds", () => {
    const issues = lintOverlay(base, { fields: { staffNotes: { page: "p1", controlType: "peoplePicker", required: true } } });
    expect(issues).toHaveLength(0);
  });

  it("warns (not errors) on a newly added pattern or visibleIf", () => {
    const issues = lintOverlay(base, { fields: { name: { pattern: "^[A-Z]+$" } } });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("assertOverlayIsAdditive throws only on error-level issues", () => {
    expect(() => assertOverlayIsAdditive(base, { fields: { price: { readonly: false } } })).not.toThrow();
    expect(() => assertOverlayIsAdditive(base, { fields: { name: { required: true } } })).toThrow(/not additive-only/);
  });
});
