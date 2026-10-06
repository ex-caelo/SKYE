import { createCustomValidatorRegistry, type CustomValidatorFn } from "@skye/form-config";

/**
 * The app's real customValidators registry — per the security decision in
 * CLAUDE.md, these are reviewed, hardcoded functions shipped in this repo,
 * never fetched from SharePoint (a form config only ever references one by
 * NAME, optionally with an `args` object — see CustomValidatorRef in
 * @skye/form-config). `runCustomValidators` throws a clear error if a config
 * references a name that isn't in this list, so there's no risk of a typo
 * silently passing.
 *
 * Every entry here is deliberately GENERAL — parameterized via `args` so one
 * registered function covers a whole class of form needs (any two fields to
 * compare, any set of "at least one of" fields, ...) rather than a bespoke
 * validator per form. Full authoring reference, syntax, and worked examples:
 * docs/custom-validators-authoring.md — keep that file in sync with this one.
 */

/** Matches nativeValidators.ts's own isEmpty rule: constraints don't apply to a value that hasn't been filled in yet (that's `required`'s job). */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

type CompareOperator = "equals" | "notEquals" | "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual";

const OPERATOR_PHRASES: Record<CompareOperator, string> = {
  equals: "equal to",
  notEquals: "different from",
  greaterThan: "greater than",
  greaterThanOrEqual: "greater than or equal to",
  lessThan: "less than",
  lessThanOrEqual: "less than or equal to",
};

/**
 * Compares two field values the same way regardless of control type: both
 * plain numbers (number/currency controls) compare numerically; two strings
 * that both parse as dates (date/datetime-local controls, which always
 * render as local, timezone-free ISO-ish strings) compare chronologically;
 * anything else falls back to a plain string comparison. Returns undefined
 * when the two values aren't meaningfully comparable (mismatched shapes,
 * e.g. one is an array) — compareField treats that as "nothing to check"
 * rather than a validation failure, since that's a config/data problem, not
 * a real ordering violation.
 */
function compareValues(a: unknown, b: unknown): number | undefined {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    const dateA = Date.parse(a);
    const dateB = Date.parse(b);
    if (!Number.isNaN(dateA) && !Number.isNaN(dateB)) return dateA - dateB;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return undefined;
}

/**
 * Generic field-to-field ordering check — the one validator that covers
 * "End Time must be after Start Time", "Max Attendees must be >= Min
 * Attendees", a "confirm" field that must differ from the original, etc.
 * args: { field: string; operator: CompareOperator; message?: string }
 */
const compareField: CustomValidatorFn = (value, allValues, args) => {
  const field = args?.field as string | undefined;
  const operator = args?.operator as CompareOperator | undefined;
  if (!field || !operator) {
    throw new Error('customValidator "compareField" requires args.field and args.operator.');
  }
  if (isEmptyValue(value) || isEmptyValue(allValues[field])) return true;

  const cmp = compareValues(value, allValues[field]);
  if (cmp === undefined) return true;

  const outcome: Record<CompareOperator, boolean> = {
    equals: cmp === 0,
    notEquals: cmp !== 0,
    greaterThan: cmp > 0,
    greaterThanOrEqual: cmp >= 0,
    lessThan: cmp < 0,
    lessThanOrEqual: cmp <= 0,
  };
  if (!(operator in outcome)) {
    throw new Error(`customValidator "compareField": unknown operator "${operator}".`);
  }
  return outcome[operator] ? true : (args?.message as string) ?? `Must be ${OPERATOR_PHRASES[operator]} the "${field}" field.`;
};

/** "YYYY-MM-DD" from a Date, built from LOCAL components (not toISOString, which is UTC and would misread a calendar day near midnight). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A date/datetime-local field's value must not be in the past. Compares
 * calendar days (not exact instants) by default, so "today" always passes —
 * exact-instant comparisons are opt-in via args.allowToday: false, for a
 * "must be later than right now" case rather than "must be today or later".
 * date/datetime-local control values are always local, zero-padded
 * "YYYY-MM-DD[THH:mm]" strings, so comparing the first 10 characters directly
 * (no Date re-parsing) sidesteps any UTC/local timezone drift near midnight.
 * args: { allowToday?: boolean (default true); message?: string }
 */
const dateNotInPast: CustomValidatorFn = (value, _allValues, args) => {
  if (isEmptyValue(value) || typeof value !== "string") return true;

  const allowToday = args?.allowToday !== false;
  if (allowToday) {
    if (value.slice(0, 10) >= localDateKey(new Date())) return true;
  } else {
    const target = Date.parse(value);
    if (!Number.isNaN(target) && target >= Date.now()) return true;
  }
  return (args?.message as string) ?? "This date can't be in the past.";
};

/**
 * At least one of the named fields must be filled in — an N-ary rule plain
 * `required` can't express on its own (e.g. "Host or Cohosts"). Attach it to
 * one designated field in the group (commonly the last one, so its error
 * surfaces at the bottom of the set); the field's own value is ignored, only
 * `allValues` for the listed fields matters.
 * args: { fields: string[]; message?: string }
 */
const atLeastOneOf: CustomValidatorFn = (_value, allValues, args) => {
  const fields = args?.fields as string[] | undefined;
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('customValidator "atLeastOneOf" requires a non-empty args.fields array.');
  }
  if (fields.some((key) => !isEmptyValue(allValues[key]))) return true;
  return (args?.message as string) ?? `At least one of these is required: ${fields.join(", ")}.`;
};

export const customValidators = createCustomValidatorRegistry({
  compareField,
  dateNotInPast,
  atLeastOneOf,
});
