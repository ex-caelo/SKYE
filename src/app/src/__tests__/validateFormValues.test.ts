import { describe, it, expect } from "vitest";
import type { FormConfig } from "@skye/config";
import { validateFormValues } from "../lib/validation/validateFormValues.js";

function makeConfig(fields: FormConfig["fields"]): FormConfig {
  return { list: { id: "list1" }, pages: { main: { title: "Main" } }, fields };
}

describe("validateFormValues", () => {
  it("returns no errors when every field is valid", () => {
    const config = makeConfig({ name: { page: "main", source: "sharepoint", bindTo: "Title", controlType: "text", required: true } });
    expect(validateFormValues(config, { name: "Jane" })).toEqual([]);
  });

  it("reports a required field left empty", () => {
    const config = makeConfig({ name: { page: "main", source: "sharepoint", bindTo: "Title", controlType: "text", required: true } });
    const errors = validateFormValues(config, {});
    expect(errors).toEqual([{ fieldKey: "name", message: "This field is required." }]);
  });

  it("skips content-only controls (heading/paragraph/divider/calculatedDisplay)", () => {
    const config = makeConfig({ intro: { page: "main", source: "virtual", controlType: "heading", label: "Welcome" } });
    expect(validateFormValues(config, {})).toEqual([]);
  });

  it("skips readonly fields", () => {
    const config = makeConfig({ name: { page: "main", source: "sharepoint", bindTo: "Title", controlType: "text", required: true, readonly: true } });
    expect(validateFormValues(config, {})).toEqual([]);
  });

  it("skips a field currently hidden by its own visibleIf", () => {
    const config = makeConfig({
      other: { page: "main", source: "sharepoint", bindTo: "Other", controlType: "text" },
      price: {
        page: "main",
        source: "sharepoint",
        bindTo: "Price",
        controlType: "currency",
        required: true,
        visibleIf: { field: "other", operator: "equals", value: "show-price" },
      },
    });
    expect(validateFormValues(config, { other: "nope" })).toEqual([]);
  });

  it("validates a visible field whose visibleIf currently evaluates true", () => {
    const config = makeConfig({
      other: { page: "main", source: "sharepoint", bindTo: "Other", controlType: "text" },
      price: {
        page: "main",
        source: "sharepoint",
        bindTo: "Price",
        controlType: "currency",
        required: true,
        visibleIf: { field: "other", operator: "equals", value: "show-price" },
      },
    });
    const errors = validateFormValues(config, { other: "show-price" });
    expect(errors).toEqual([{ fieldKey: "price", message: "This field is required." }]);
  });

  it("runs a registered custom validator after native constraints pass", () => {
    const config = makeConfig({ code: { page: "main", source: "sharepoint", bindTo: "Code", controlType: "text", customValidators: ["evenLength"] } });
    const registry = { evenLength: (v: unknown) => (typeof v === "string" && v.length % 2 === 0 ? true : "Must have an even number of characters.") };
    expect(validateFormValues(config, { code: "abc" }, registry)).toEqual([{ fieldKey: "code", message: "Must have an even number of characters." }]);
    expect(validateFormValues(config, { code: "abcd" }, registry)).toEqual([]);
  });
});
