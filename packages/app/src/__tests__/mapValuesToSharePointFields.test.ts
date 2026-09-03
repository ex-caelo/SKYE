import { describe, it, expect } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import { mapValuesToSharePointFields } from "../features/form/submit/mapValuesToSharePointFields.js";

const fields: Record<string, FieldConfig> = {
  name: { page: "p1", source: "sharepoint", bindTo: "Title", controlType: "text" },
  campus: { page: "p1", source: "sharepoint", bindTo: "Favourite_x0020_Campus", controlType: "select" },
  agreeToTerms: { page: "p1", source: "virtual", controlType: "checkbox" },
};

describe("mapValuesToSharePointFields", () => {
  it("maps sharepoint-source fields from field key to bindTo", () => {
    const result = mapValuesToSharePointFields(fields, { name: "Jane Doe", campus: "Bloomington" });
    expect(result).toEqual({ Title: "Jane Doe", Favourite_x0020_Campus: "Bloomington" });
  });

  it("excludes virtual fields entirely, even if a value exists for them", () => {
    const result = mapValuesToSharePointFields(fields, { name: "Jane Doe", agreeToTerms: true });
    expect(result).toEqual({ Title: "Jane Doe" });
    expect(result).not.toHaveProperty("agreeToTerms");
  });

  it("skips fields that were never touched rather than sending an overwrite", () => {
    const result = mapValuesToSharePointFields(fields, { name: "Jane Doe" });
    expect(result).toEqual({ Title: "Jane Doe" });
    expect(result).not.toHaveProperty("Favourite_x0020_Campus");
  });
});
