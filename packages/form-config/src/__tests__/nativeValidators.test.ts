import { describe, it, expect } from "vitest";
import { validateField, runCustomValidators } from "../validation/nativeValidators.js";
import type { FieldConfig } from "../schema/types.js";

describe("validateField", () => {
  it("fails required on an empty value with the default message", () => {
    const field: FieldConfig = { controlType: "text", required: true };
    const result = validateField(field, "", {});
    expect(result.valid).toBe(false);
    expect(result.failedConstraint).toBe("required");
  });

  it("fails required on an empty array (multi-select / people picker with nothing chosen)", () => {
    const field: FieldConfig = { controlType: "checkboxGroup", required: true };
    expect(validateField(field, [], {}).failedConstraint).toBe("required");
    expect(validateField(field, ["a"], {}).valid).toBe(true);
  });

  it("uses a custom validationMessages override when present", () => {
    const field: FieldConfig = { controlType: "text", required: true, validationMessages: { required: "We need a name." } };
    expect(validateField(field, "", {}).message).toBe("We need a name.");
  });

  it("skips length/pattern checks on an empty, non-required value", () => {
    const field: FieldConfig = { controlType: "text", minlength: 5 };
    expect(validateField(field, "", {}).valid).toBe(true);
  });

  it("checks minlength/maxlength/min/max/pattern in order, returning the first failure", () => {
    expect(validateField({ controlType: "text", maxlength: 3 }, "toolong", {}).failedConstraint).toBe("maxlength");
    expect(validateField({ controlType: "number", min: 1, max: 25 }, 30, {}).failedConstraint).toBe("max");
    expect(validateField({ controlType: "text", pattern: "^\\d+$" }, "abc", {}).failedConstraint).toBe("pattern");
  });

  it("checks matchesField against another field's current value", () => {
    const field: FieldConfig = { controlType: "text", matchesField: "email" };
    expect(validateField(field, "a@b.com", { email: "a@b.com" }).valid).toBe(true);
    expect(validateField(field, "different", { email: "a@b.com" }).failedConstraint).toBe("matchesField");
  });
});

describe("runCustomValidators", () => {
  it("runs a registered validator and reports its message on failure", () => {
    const field: FieldConfig = { controlType: "text", customValidators: ["usEinFormat"] };
    const registry = { usEinFormat: (v: unknown) => (/^\d{2}-\d{7}$/.test(String(v)) ? true : "Must look like an EIN.") };
    expect(runCustomValidators(field, "12-3456789", {}, registry).valid).toBe(true);
    expect(runCustomValidators(field, "nope", {}, registry)).toEqual({ valid: false, message: "Must look like an EIN." });
  });

  it("throws loudly when a config references an unregistered validator", () => {
    const field: FieldConfig = { controlType: "text", customValidators: ["doesNotExist"] };
    expect(() => runCustomValidators(field, "x", {}, {})).toThrow(/not registered/);
  });

  it("passes a { name, args } entry's args through as the validator's third argument", () => {
    const field: FieldConfig = {
      controlType: "text",
      customValidators: [{ name: "minWordCount", args: { min: 2 } }],
    };
    const registry = {
      minWordCount: (v: unknown, _allValues: Record<string, unknown>, args?: Record<string, unknown>) =>
        String(v).trim().split(/\s+/).length >= (args?.min as number) ? true : "Not enough words.",
    };
    expect(runCustomValidators(field, "one two", {}, registry).valid).toBe(true);
    expect(runCustomValidators(field, "one", {}, registry)).toEqual({ valid: false, message: "Not enough words." });
  });

  it("mixes bare-name and { name, args } entries in the same list, checked in order", () => {
    const field: FieldConfig = {
      controlType: "text",
      customValidators: ["usEinFormat", { name: "minWordCount", args: { min: 5 } }],
    };
    const registry = {
      usEinFormat: (v: unknown) => (/^\d{2}-\d{7}$/.test(String(v)) ? true : "Must look like an EIN."),
      minWordCount: (): true => true,
    };
    expect(runCustomValidators(field, "not-an-ein", {}, registry)).toEqual({ valid: false, message: "Must look like an EIN." });
  });
});
