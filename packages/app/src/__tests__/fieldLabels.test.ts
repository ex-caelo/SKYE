import { describe, it, expect } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import { humanizeFieldKey, backfillFieldLabels } from "../features/form/render/fieldLabels.js";
import type { GraphListColumn } from "../shared/sharepoint/types.js";

describe("humanizeFieldKey", () => {
  it("splits camelCase and title-cases", () => {
    expect(humanizeFieldKey("favouriteCampus")).toBe("Favourite Campus");
    expect(humanizeFieldKey("name")).toBe("Name");
  });
  it("decodes SharePoint _x0020_ escapes and normalises separators", () => {
    expect(humanizeFieldKey("Favourite_x0020_Campus")).toBe("Favourite Campus");
    expect(humanizeFieldKey("event_start-time")).toBe("Event start time");
  });
  it("falls back to the raw key when nothing usable remains", () => {
    expect(humanizeFieldKey("___")).toBe("___");
  });
});

describe("backfillFieldLabels", () => {
  const columns: GraphListColumn[] = [
    { name: "Title", displayName: "Full Title", columnType: "text" },
    { name: "Favourite_x0020_Campus", displayName: "Favourite Campus", columnType: "choice" },
  ];

  it("fills a missing label from the bound column's displayName", () => {
    const fields = { a: { source: "sharepoint", bindTo: "Title", controlType: "text" } } as unknown as Record<string, FieldConfig>;
    backfillFieldLabels(fields, columns);
    expect(fields.a.label).toBe("Full Title");
  });

  it("falls back to a humanised key when the field has no bound column", () => {
    const fields = { favouriteThing: { source: "virtual", controlType: "text" } } as unknown as Record<string, FieldConfig>;
    backfillFieldLabels(fields, columns);
    expect(fields.favouriteThing.label).toBe("Favourite Thing");
  });

  it("leaves an explicit label untouched", () => {
    const fields = { a: { source: "sharepoint", bindTo: "Title", controlType: "text", label: "Keep me" } } as unknown as Record<string, FieldConfig>;
    backfillFieldLabels(fields, columns);
    expect(fields.a.label).toBe("Keep me");
  });

  it("does not add a label to display-only / hidden controls", () => {
    const fields = {
      h: { source: "virtual", controlType: "heading" },
      d: { source: "virtual", controlType: "divider" },
      t: { source: "sharepoint", bindTo: "Title", controlType: "hidden" },
    } as unknown as Record<string, FieldConfig>;
    backfillFieldLabels(fields, columns);
    expect(fields.h.label).toBeUndefined();
    expect(fields.d.label).toBeUndefined();
    expect(fields.t.label).toBeUndefined();
  });
});
