import type { FormConfig, FieldValues } from "@skye/form-config";
import { validateField, runCustomValidators, evaluateCondition } from "@skye/form-config";

export interface FieldValidationError {
  fieldKey: string;
  message: string;
}

/** controlTypes with nothing a user actually types/picks — never worth validating. */
const CONTENT_ONLY_CONTROL_TYPES = new Set(["heading", "paragraph", "divider", "calculatedDisplay"]);

/**
 * Runs every applicable field's native (required/minlength/maxlength/min/
 * max/pattern/matchesField) and custom validators against the current
 * values, skipping content-only controls, readonly fields, and fields
 * currently hidden by their own `visibleIf`. Pure and DOM-free — used
 * today only by entry-form.ts's draft-preview submit gate (see
 * router.ts's `draftId` and CLAUDE.md's "Form Config Builder" section),
 * which is the first real caller of @skye/form-config's `validateField`/
 * `runCustomValidators` in this app at all — worth noting as a real,
 * pre-existing gap this doesn't fully close: the NORMAL (non-draft) /form
 * submit path still doesn't run field validation before writing to
 * SharePoint (see TODO §17's "known gaps").
 */
export function validateFormValues(config: FormConfig, values: FieldValues, customValidatorRegistry: Record<string, (value: unknown, allValues: FieldValues) => true | string> = {}): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  for (const [fieldKey, field] of Object.entries(config.fields)) {
    if (CONTENT_ONLY_CONTROL_TYPES.has(field.controlType)) continue;
    if (field.readonly) continue;
    if (field.visibleIf && !evaluateCondition(field.visibleIf, values)) continue;

    const value = values[fieldKey];
    const native = validateField(field, value, values);
    if (!native.valid) {
      errors.push({ fieldKey, message: native.message ?? "Invalid value." });
      continue;
    }
    const custom = runCustomValidators(field, value, values, customValidatorRegistry);
    if (!custom.valid) errors.push({ fieldKey, message: custom.message ?? "Invalid value." });
  }

  return errors;
}
