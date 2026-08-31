import { describe, it, expect } from "vitest";
import { controlTypeForColumn, fieldConfigForColumn, fieldKeyForColumn, missingRequiredColumns } from "../lib/builder/columnMapping.js";
import type { GraphListColumn } from "../lib/graph/types.js";

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

  it("omits label when displayName equals the internal name, and required/page when not applicable", () => {
    expect(fieldConfigForColumn(col({ name: "Title", displayName: "Title", columnType: "text" }))).toEqual({
      source: "sharepoint",
      bindTo: "Title",
      controlType: "text",
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
