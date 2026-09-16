import { describe, it, expect } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import { mapSharePointFieldsToValues } from "../features/form/submit/mapSharePointFieldsToValues.js";

const fields: Record<string, FieldConfig> = {
  title: { page: "p1", source: "sharepoint", bindTo: "Title", controlType: "text" },
  notes: { page: "p1", source: "virtual", controlType: "textarea" },
  start: { page: "p1", source: "sharepoint", bindTo: "StartTime", controlType: "datetime-local" },
  day: { page: "p1", source: "sharepoint", bindTo: "Day", controlType: "date" },
  host: { page: "p1", source: "sharepoint", bindTo: "Host", controlType: "peoplePicker" },
  cohosts: { page: "p1", source: "sharepoint", bindTo: "Cohosts", controlType: "peoplePicker" },
  categories: { page: "p1", source: "sharepoint", bindTo: "Categories", controlType: "checkboxGroup" },
};

describe("mapSharePointFieldsToValues", () => {
  it("maps bound fields, skips virtual ones and absent columns", () => {
    const values = mapSharePointFieldsToValues(fields, {
      Title: "Kickoff",
      Categories: ["Social", "Academic"],
    });
    expect(values).toEqual({ title: "Kickoff", categories: ["Social", "Academic"] });
    expect(values).not.toHaveProperty("notes"); // virtual — never read
  });

  it("trims a SharePoint ISO datetime to the control's format", () => {
    const values = mapSharePointFieldsToValues(fields, {
      StartTime: "2026-04-02T21:30:00Z",
      Day: "2026-04-02T00:00:00Z",
    });
    expect(values.start).toBe("2026-04-02T21:30");
    expect(values.day).toBe("2026-04-02");
  });

  it("passes a person column's rich object straight through", () => {
    const values = mapSharePointFieldsToValues(fields, {
      Host: { LookupId: 14, LookupValue: "Reece Needham", Email: "reeneedh@iu.edu" },
    });
    expect(values.host).toEqual({ LookupId: 14, LookupValue: "Reece Needham", Email: "reeneedh@iu.edu" });
  });

  it("falls back to <bindTo>LookupId when only the id array is present", () => {
    const values = mapSharePointFieldsToValues(fields, {
      CohostsLookupId: ["14", "22"],
    });
    expect(values.cohosts).toEqual(["14", "22"]);
  });

  it("ignores empty-string / null column values", () => {
    const values = mapSharePointFieldsToValues(fields, { Title: "", StartTime: null });
    expect(values).toEqual({});
  });
});
