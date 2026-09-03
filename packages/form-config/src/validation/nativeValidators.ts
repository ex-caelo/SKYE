import type { FieldConfig, FieldValues } from "../schema/types.js";

export interface ValidationResult {
  valid: boolean;
  /** Which constraint failed, if any — matches the ValidationMessages key so the app can look up custom text. */
  failedConstraint?: keyof NonNullable<FieldConfig["validationMessages"]>;
  message?: string;
}

const DEFAULT_MESSAGES: Record<string, string> = {
  required: "This field is required.",
  minlength: "This value is too short.",
  maxlength: "This value is too long.",
  min: "This value is too low.",
  max: "This value is too high.",
  pattern: "This value doesn't match the expected format.",
  matchesField: "This value doesn't match.",
};

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Validates a single field's current value against its own declarative
 * constraints (required/minlength/maxlength/min/max/pattern/matchesField).
 * Returns the FIRST failing constraint, in the same priority order HTML's
 * own Constraint Validation API checks them in, so behavior feels native.
 * Custom validators (registered functions) are deliberately NOT run here —
 * see runCustomValidators, which needs the app's registry injected.
 */
export function validateField(field: FieldConfig, value: unknown, allValues: FieldValues): ValidationResult {
  const msg = (key: keyof NonNullable<FieldConfig["validationMessages"]>) =>
    field.validationMessages?.[key] ?? DEFAULT_MESSAGES[key];

  if (field.required && isEmpty(value)) {
    return { valid: false, failedConstraint: "required", message: msg("required") };
  }

  // Constraints below don't apply to an empty, non-required value — matches native HTML behavior.
  if (isEmpty(value)) return { valid: true };

  if (typeof field.minlength === "number" && typeof value === "string" && value.length < field.minlength) {
    return { valid: false, failedConstraint: "minlength", message: msg("minlength") };
  }

  if (typeof field.maxlength === "number" && typeof value === "string" && value.length > field.maxlength) {
    return { valid: false, failedConstraint: "maxlength", message: msg("maxlength") };
  }

  if (typeof field.min === "number" && typeof value === "number" && value < field.min) {
    return { valid: false, failedConstraint: "min", message: msg("min") };
  }

  if (typeof field.max === "number" && typeof value === "number" && value > field.max) {
    return { valid: false, failedConstraint: "max", message: msg("max") };
  }

  if (field.pattern && typeof value === "string" && !new RegExp(field.pattern).test(value)) {
    return { valid: false, failedConstraint: "pattern", message: msg("pattern") };
  }

  if (field.matchesField && value !== allValues[field.matchesField]) {
    return { valid: false, failedConstraint: "matchesField", message: msg("matchesField") };
  }

  return { valid: true };
}

/**
 * Runs a field's registered custom validators (see customValidatorRegistry.ts
 * for the "hardcoded, never fetched from SharePoint" contract) after the
 * native constraints already passed. Returns the first failure, if any.
 */
export function runCustomValidators(
  field: FieldConfig,
  value: unknown,
  allValues: FieldValues,
  registry: Record<string, (value: unknown, allValues: FieldValues) => true | string>
): ValidationResult {
  for (const name of field.customValidators ?? []) {
    const validator = registry[name];
    if (!validator) {
      // A config referencing an unregistered validator is a loud error, not a silent pass.
      throw new Error(`Field references customValidator "${name}", which is not registered.`);
    }
    const outcome = validator(value, allValues);
    if (outcome !== true) {
      return { valid: false, message: outcome };
    }
  }
  return { valid: true };
}
