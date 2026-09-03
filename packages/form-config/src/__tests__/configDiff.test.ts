import { describe, it, expect } from "vitest";
import { computeConfigDiff } from "../merge/configDiff.js";

describe("computeConfigDiff", () => {
  it("reports isEmpty: true and no entries for two identical configs", () => {
    const config = { title: "x", pages: { main: { title: "Main" } }, fields: { name: { page: "main", controlType: "text" } } };
    const diff = computeConfigDiff(config, config);
    expect(diff.isEmpty).toBe(true);
    expect(diff.fields).toEqual([]);
    expect(diff.pages).toEqual([]);
    expect(diff.settings.changedProperties).toEqual([]);
  });

  it("detects a top-level settings change", () => {
    const diff = computeConfigDiff({ title: "Old" }, { title: "New" });
    expect(diff.settings.changedProperties).toEqual(["title"]);
    expect(diff.isEmpty).toBe(false);
  });

  it("detects an added field", () => {
    const before = { fields: {} };
    const after = { fields: { name: { page: "main", controlType: "text" } } };
    const diff = computeConfigDiff(before, after);
    expect(diff.fields).toEqual([{ key: "name", status: "added", pageKey: "main" }]);
  });

  it("detects a removed field", () => {
    const before = { fields: { name: { page: "main", controlType: "text" } } };
    const after = { fields: {} };
    const diff = computeConfigDiff(before, after);
    expect(diff.fields).toEqual([{ key: "name", status: "removed", pageKey: "main" }]);
  });

  it("detects a changed field, listing which properties differ", () => {
    const before = { fields: { name: { page: "main", controlType: "text", label: "Name", maxlength: 100 } } };
    const after = { fields: { name: { page: "main", controlType: "text", label: "Full Name", maxlength: 100 } } };
    const diff = computeConfigDiff(before, after);
    expect(diff.fields).toEqual([{ key: "name", status: "changed", changedProperties: ["label"], visibilityChange: undefined, pageKey: "main" }]);
  });

  it("flags visibilityChange: 'added' when a visibleIf is newly introduced", () => {
    const before = { fields: { price: { page: "main", controlType: "currency" } } };
    const after = { fields: { price: { page: "main", controlType: "currency", visibleIf: { field: "isMember", operator: "equals", value: true } } } };
    const diff = computeConfigDiff(before, after);
    expect(diff.fields[0].visibilityChange).toBe("added");
    expect(diff.fields[0].changedProperties).toEqual(["visibleIf"]);
  });

  it("flags visibilityChange: 'removed' when an existing visibleIf is cleared", () => {
    const before = { fields: { price: { page: "main", controlType: "currency", visibleIf: { field: "isMember", operator: "equals", value: true } } } };
    const after = { fields: { price: { page: "main", controlType: "currency" } } };
    const diff = computeConfigDiff(before, after);
    expect(diff.fields[0].visibilityChange).toBe("removed");
  });

  it("flags visibilityChange: 'changed' when an existing visibleIf's shape changes", () => {
    const before = { fields: { price: { page: "main", controlType: "currency", visibleIf: { field: "isMember", operator: "equals", value: true } } } };
    const after = { fields: { price: { page: "main", controlType: "currency", visibleIf: { field: "isMember", operator: "equals", value: false } } } };
    const diff = computeConfigDiff(before, after);
    expect(diff.fields[0].visibilityChange).toBe("changed");
  });

  it("diffs pages and postActions the same way as fields, using 'when' as the visibility key for postActions", () => {
    const before = { pages: {}, postActions: {} };
    const after = {
      pages: { main: { title: "Main" } },
      postActions: { notify: { trigger: "afterSubmit", type: "showMessage", message: "hi", when: { field: "x", operator: "isNotEmpty" } } },
    };
    const diff = computeConfigDiff(before, after);
    expect(diff.pages).toEqual([{ key: "main", status: "added", pageKey: undefined }]);
    expect(diff.postActions[0]).toMatchObject({ key: "notify", status: "added" });
  });

  it("results are sorted by key for stable, predictable output", () => {
    const before = { fields: {} };
    const after = { fields: { zeta: { page: "main", controlType: "text" }, alpha: { page: "main", controlType: "text" } } };
    const diff = computeConfigDiff(before, after);
    expect(diff.fields.map((f) => f.key)).toEqual(["alpha", "zeta"]);
  });
});
