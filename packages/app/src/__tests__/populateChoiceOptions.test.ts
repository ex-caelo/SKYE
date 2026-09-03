import { describe, it, expect } from "vitest";
import { populateChoiceOptionsFromColumns } from "../features/form/render/populateChoiceOptions.js";
import type { FieldConfig } from "@skye/form-config";
import type { GraphListColumn } from "../shared/sharepoint/types.js";

const CAMPUS_COLUMN: GraphListColumn = {
  name: "Favourite_x0020_Campus",
  displayName: "Favourite Campus",
  columnType: "choice",
  choices: ["Bloomington", "Indianapolis", "Columbus"],
};

describe("populateChoiceOptionsFromColumns", () => {
  it("populates options for a sharepoint select field with no static options, matched by bindTo", () => {
    const fields: Record<string, FieldConfig> = {
      campus: { source: "sharepoint", bindTo: "Favourite_x0020_Campus", controlType: "select" },
    };
    populateChoiceOptionsFromColumns(fields, [CAMPUS_COLUMN]);
    expect(fields.campus.options).toEqual([
      { value: "Bloomington", label: "Bloomington" },
      { value: "Indianapolis", label: "Indianapolis" },
      { value: "Columbus", label: "Columbus" },
    ]);
  });

  it("leaves a field's explicit static options untouched", () => {
    const fields: Record<string, FieldConfig> = {
      campus: {
        source: "sharepoint",
        bindTo: "Favourite_x0020_Campus",
        controlType: "select",
        options: [{ value: "onlyOption", label: "Only Option" }],
      },
    };
    populateChoiceOptionsFromColumns(fields, [CAMPUS_COLUMN]);
    expect(fields.campus.options).toEqual([{ value: "onlyOption", label: "Only Option" }]);
  });

  it("ignores virtual fields, non-choice controlTypes, and fields with no matching column", () => {
    const fields: Record<string, FieldConfig> = {
      attendingBanquet: { source: "virtual", controlType: "checkbox" },
      name: { source: "sharepoint", bindTo: "Title", controlType: "text" },
      unmatched: { source: "sharepoint", bindTo: "NoSuchColumn", controlType: "select" },
    };
    populateChoiceOptionsFromColumns(fields, [CAMPUS_COLUMN]);
    expect(fields.attendingBanquet.options).toBeUndefined();
    expect(fields.name.options).toBeUndefined();
    expect(fields.unmatched.options).toBeUndefined();
  });

  it("works for radio and checkboxGroup controlTypes too", () => {
    const fields: Record<string, FieldConfig> = {
      campusRadio: { source: "sharepoint", bindTo: "Favourite_x0020_Campus", controlType: "radio" },
    };
    populateChoiceOptionsFromColumns(fields, [CAMPUS_COLUMN]);
    expect(fields.campusRadio.options).toHaveLength(3);
  });
});
