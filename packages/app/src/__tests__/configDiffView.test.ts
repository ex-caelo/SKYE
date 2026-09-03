import { describe, it, expect } from "vitest";
import type { ConfigDiff } from "@skye/form-config";
import { renderConfigDiff } from "../features/builder/configDiffView.js";

describe("renderConfigDiff", () => {
  it("shows 'No changes.' for an empty diff", () => {
    const diff: ConfigDiff = { settings: { changedProperties: [] }, pages: [], fields: [], postActions: [], isEmpty: true };
    const el = renderConfigDiff(diff, document);
    expect(el.textContent).toContain("No changes.");
  });

  it("renders a Form settings section listing changed top-level properties", () => {
    const diff: ConfigDiff = { settings: { changedProperties: ["title", "mode"] }, pages: [], fields: [], postActions: [], isEmpty: false };
    const el = renderConfigDiff(diff, document);
    expect(el.textContent).toContain("Changed: title, mode");
  });

  it("groups field entries by page, each showing status/changed properties/visibility change", () => {
    const diff: ConfigDiff = {
      settings: { changedProperties: [] },
      pages: [],
      fields: [
        { key: "name", status: "changed", changedProperties: ["label"], pageKey: "aboutYou" },
        { key: "price", status: "changed", visibilityChange: "added", changedProperties: ["visibleIf"], pageKey: "yourOrder" },
        { key: "staffNotes", status: "added", pageKey: "yourOrder" },
      ],
      postActions: [],
      isEmpty: false,
    };
    const el = renderConfigDiff(diff, document);
    const pageHeadings = Array.from(el.querySelectorAll("h5")).map((h) => h.textContent);
    expect(pageHeadings).toEqual(["aboutYou", "yourOrder"]);
    const items = Array.from(el.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual([
      "name — Changed (label)",
      "price — Changed (visibleIf) — visibility condition added",
      "staffNotes — Added",
    ]);
  });

  it("renders a removed field with the 'removed' status word, and dataset.status set for CSS/testing hooks", () => {
    const diff: ConfigDiff = {
      settings: { changedProperties: [] },
      pages: [],
      fields: [{ key: "oldField", status: "removed", pageKey: "main" }],
      postActions: [],
      isEmpty: false,
    };
    const el = renderConfigDiff(diff, document);
    const li = el.querySelector("li")!;
    expect(li.textContent).toBe("oldField — Removed");
    expect(li.dataset.status).toBe("removed");
  });

  it("renders Pages and Post Actions as flat (non-grouped) lists", () => {
    const diff: ConfigDiff = {
      settings: { changedProperties: [] },
      pages: [{ key: "review", status: "added" }],
      fields: [],
      postActions: [{ key: "notify", status: "added" }],
      isEmpty: false,
    };
    const el = renderConfigDiff(diff, document);
    const headings = Array.from(el.querySelectorAll("h4")).map((h) => h.textContent);
    expect(headings).toEqual(["Pages", "Post Actions"]);
  });
});
