import type { FieldConfig, FormConfig, FormConfigOverlay } from "../schema/types.js";

export interface LintIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

/**
 * Compares one field's base definition against what an overlay wants to
 * change on that same field, flagging any change that makes the field
 * *more* restrictive than the base — which the additive-only convention
 * disallows. Loosening (e.g. required: true -> false) is always fine and
 * never flagged.
 */
function lintFieldOverlay(fieldKey: string, base: FieldConfig, overlay: Partial<FieldConfig>): LintIssue[] {
  const issues: LintIssue[] = [];
  const path = `fields.${fieldKey}`;

  // required: false/absent -> true tightens the field.
  if (overlay.required === true && base.required !== true) {
    issues.push({ severity: "error", path: `${path}.required`, message: "Overlay sets required: true where base does not require it." });
  }

  // readonly: false/absent -> true tightens the field (locks out editing a lower permission could do).
  if (overlay.readonly === true && base.readonly !== true) {
    issues.push({ severity: "error", path: `${path}.readonly`, message: "Overlay sets readonly: true where base allows editing." });
  }

  // maxlength going down narrows what's allowed.
  if (typeof overlay.maxlength === "number" && typeof base.maxlength === "number" && overlay.maxlength < base.maxlength) {
    issues.push({ severity: "error", path: `${path}.maxlength`, message: `Overlay lowers maxlength from ${base.maxlength} to ${overlay.maxlength}.` });
  }

  // minlength going up narrows what's allowed.
  if (typeof overlay.minlength === "number" && typeof base.minlength === "number" && overlay.minlength > base.minlength) {
    issues.push({ severity: "error", path: `${path}.minlength`, message: `Overlay raises minlength from ${base.minlength} to ${overlay.minlength}.` });
  }

  // A higher `min` raises the floor — stricter.
  if (typeof overlay.min === "number" && typeof base.min === "number" && overlay.min > base.min) {
    issues.push({ severity: "error", path: `${path}.min`, message: `Overlay raises min from ${base.min} to ${overlay.min}.` });
  }

  // A lower `max` lowers the ceiling — stricter.
  if (typeof overlay.max === "number" && typeof base.max === "number" && overlay.max < base.max) {
    issues.push({ severity: "error", path: `${path}.max`, message: `Overlay lowers max from ${base.max} to ${overlay.max}.` });
  }

  // A pattern added where the base had none is a new constraint — can't judge regex strictness in general, so this is a warning, not a hard error.
  if (overlay.pattern && !base.pattern) {
    issues.push({ severity: "warning", path: `${path}.pattern`, message: "Overlay adds a pattern constraint the base config didn't have." });
  }

  // A visibleIf added where the base had none can newly hide the field for some values — flagged for a human to confirm intent.
  if (overlay.visibleIf && !base.visibleIf) {
    issues.push({ severity: "warning", path: `${path}.visibleIf`, message: "Overlay adds a visibleIf condition the base config didn't have." });
  }

  return issues;
}

/**
 * Lints a single overlay against its base config. Only checks fields that
 * exist in *both* base and overlay — new fields the overlay introduces are
 * always fine (that's the whole point of an overlay), and fields the
 * overlay doesn't touch are untouched by definition (merge patch, not a
 * replace), so there's nothing to compare there.
 */
export function lintOverlay(base: FormConfig, overlay: FormConfigOverlay): LintIssue[] {
  const issues: LintIssue[] = [];

  if (overlay.fields) {
    for (const [fieldKey, overlayField] of Object.entries(overlay.fields)) {
      const baseField = base.fields[fieldKey];
      if (baseField) {
        issues.push(...lintFieldOverlay(fieldKey, baseField, overlayField));
      }
      // If baseField doesn't exist, this is a brand-new field the overlay is adding — always fine.
    }
  }

  return issues;
}

/** Convenience for CI/dev: throws if any lint issue is an error (warnings are just logged by the caller). */
export function assertOverlayIsAdditive(base: FormConfig, overlay: FormConfigOverlay): LintIssue[] {
  const issues = lintOverlay(base, overlay);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `Overlay is not additive-only:\n${errors.map((e) => `  - [${e.path}] ${e.message}`).join("\n")}`
    );
  }
  return issues;
}
