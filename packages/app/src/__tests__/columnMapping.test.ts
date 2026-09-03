import { describe, it, expect } from "vitest";
import {
  controlTypeForColumn,
  fieldConfigForColumn,
  fieldKeyForColumn,
  missingRequiredColumns,
  requiredColumnFields,
  SINGLE_COLUMN_LAYOUT,
} from "../features/builder/columnMapping.js";
import type { GraphListColumn } from "../shared/sharepoint/types.js";

const col = (over: Partial<GraphListColumn>): GraphListColumn => ({ name: "X", displayName: "X", columnType: "text", ...over });

describe("controlTypeForColumn", () => {
  it("maps each SharePoint column type to a sensible SKYE controlType", () => {
    expect(controlTypeForColumn(col({ columnType: "text" }))).toBe("text");
    expect(controlTypeForColumn(col({ columnType: "note" }))).toBe("textarea");
    expect(controlTypeForColumn(col({ columnType: "number" }))).toBe("number");
    expect(controlTypeForColumn(col({ columnType: "currency" }))).toBe("currency");
    expect(controlTypeForColumn(col({ columnType: "boolean" }))).toBe("checkbox");
    expect(controlTypeForColumn(col({ columnType: "dateTime" }))).toBe("date");
    expect(controlTypeForColumn(col({ columnType: "choice" }))).toBe("select");
    expect(controlTypeForColumn(col({ columnType: "lookup" }))).toBe("lookupPicker");
    expect(controlTypeForColumn(col({ columnType: "personOrGroup" }))).toBe("peoplePicker");
    expect(controlTypeForColumn(col({ columnType: "hyperlinkOrPicture" }))).toBe("url");
  });
});

describe("fieldConfigForColumn", () => {
  it("produces a source:sharepoint field with bindTo, mapped controlType, label and page", () => {
    const field = fieldConfigForColumn(col({ name: "Start_x0020_Date", displayName: "Start Date", columnType: "dateTime", required: true }), "main");
    expect(field).toEqual({
      source: "sharepoint",
      bindTo: "Start_x0020_Date",
      controlType: "date",
      label: "Start Date",
      required: true,
      page: "main",
    });
  });

  it("always sets an explicit label (from displayName), and omits required/page when not applicable", () => {
    expect(fieldConfigForColumn(col({ name: "Title", displayName: "Title", columnType: "text" }))).toEqual({
      source: "sharepoint",
      bindTo: "Title",
      controlType: "text",
      label: "Title",
    });
  });
});

describe("fieldKeyForColumn", () => {
  it("camelCases the display name and decodes SharePoint _x0020_ escapes", () => {
    expect(fieldKeyForColumn(col({ name: "Favourite_x0020_Campus", displayName: "Favourite Campus" }), new Set())).toBe("favouriteCampus");
  });

  it("prefixes with 'field' when the name would not start with a letter, and de-duplicates", () => {
    expect(fieldKeyForColumn(col({ name: "123", displayName: "123" }), new Set())).toMatch(/^field/);
    expect(fieldKeyForColumn(col({ displayName: "Title" }), new Set(["title"]))).toBe("title2");
    expect(fieldKeyForColumn(col({ displayName: "Title" }), new Set(["title", "title2"]))).toBe("title3");
  });
});

describe("missingRequiredColumns", () => {
  const columns: GraphListColumn[] = [
    col({ name: "Title", required: true }),
    col({ name: "Start", columnType: "dateTime", required: true }),
    col({ name: "Notes", columnType: "note" }),
    col({ name: "Created", required: true, readOnly: true }),
  ];

  it("returns required, writable columns no sharepoint field binds to", () => {
    const fields = { a: { source: "sharepoint", bindTo: "Title" }, b: { source: "virtual" } };
    expect(missingRequiredColumns(fields, columns).map((c) => c.name)).toEqual(["Start"]);
  });

  it("ignores a virtual field that happens to share a bindTo-like value, and read-only required columns", () => {
    const fields = { x: { source: "virtual", bindTo: "Start" } };
    expect(missingRequiredColumns(fields, columns).map((c) => c.name)).toEqual(["Title", "Start"]);
  });

  it("treats a field with no explicit source as sharepoint (the schema default)", () => {
    const fields = { x: { bindTo: "Title" }, y: { bindTo: "Start" } };
    expect(missingRequiredColumns(fields, columns)).toEqual([]);
  });
});

describe("SINGLE_COLUMN_LAYOUT / requiredColumnFields", () => {
  it("SINGLE_COLUMN_LAYOUT is a one-column CSS grid with no gridTemplateAreas", () => {
    expect(SINGLE_COLUMN_LAYOUT).toEqual({ gridTemplateColumns: 1 });
  });

  it("requiredColumnFields produces one ordered, page-placed sharepoint field per required writable column", () => {
    const columns: GraphListColumn[] = [
      col({ name: "Title", displayName: "Title", required: true }),
      col({ name: "Start_x0020_Date", displayName: "Start Date", columnType: "dateTime", required: true }),
      col({ name: "Notes", displayName: "Notes", columnType: "note" }), // not required
      col({ name: "Created", required: true, readOnly: true }), // read-only
    ];
    const fields = requiredColumnFields(columns, "main");
    expect(Object.keys(fields)).toEqual(["title", "startDate"]);
    expect(fields.title).toMatchObject({ source: "sharepoint", bindTo: "Title", controlType: "text", required: true, page: "main", order: 1 });
    expect(fields.startDate).toMatchObject({ bindTo: "Start_x0020_Date", controlType: "date", order: 2 });
  });

  it("honours a startOrder so it can append after an existing form's fields", () => {
    const fields = requiredColumnFields([col({ name: "Title", displayName: "Title", required: true })], "main", 5);
    expect((fields.title as { order: number }).order).toBe(5);
  });
});
