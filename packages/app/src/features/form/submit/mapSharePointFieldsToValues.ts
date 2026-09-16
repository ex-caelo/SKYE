import type { FieldConfig, FieldValues } from "@skye/form-config";

/** Trims a SharePoint ISO datetime ("2026-04-02T21:30:00Z") to what `<input type=date|datetime-local>` accepts. */
function trimDateForControl(value: string, controlType: string): string {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) return value;
  return controlType === "date" ? m[1] : `${m[1]}T${m[2]}`;
}

/**
 * The inverse of the submit encoder: turns a SharePoint list item's
 * `fields` payload (from `getListItem`, `fields` expanded) into the value
 * map an edit- or view-mode form is seeded with (`renderForm`'s
 * `initialValues`).
 *
 * Only `source: "sharepoint"` fields with a `bindTo` are read.
 *  - Person columns arrive as `{ LookupId, LookupValue }` (or an array of
 *    them) — passed through as-is: the chip picker's `normalisePeopleValue`
 *    renders them and keys on the numeric `LookupId`, which the submit
 *    encoder treats as an already-resolved site user (no re-lookup).
 *  - Multi-value Choice arrives as a string array — passed straight through
 *    to the multi-select control.
 *  - `date` / `datetime-local` values are trimmed to the control's format.
 */
export function mapSharePointFieldsToValues(fields: Record<string, FieldConfig>, itemFields: Record<string, unknown>): FieldValues {
  const values: FieldValues = {};

  for (const [fieldKey, field] of Object.entries(fields)) {
    if (field.source === "virtual" || !field.bindTo) continue;

    // A person column's rich object lives under `bindTo`; some responses only carry `<bindTo>LookupId`.
    let raw = itemFields[field.bindTo];
    if (raw === undefined && field.controlType === "peoplePicker") raw = itemFields[`${field.bindTo}LookupId`];
    if (raw === undefined || raw === null || raw === "") continue;

    if ((field.controlType === "date" || field.controlType === "datetime-local") && typeof raw === "string") {
      values[fieldKey] = trimDateForControl(raw, field.controlType);
    } else {
      values[fieldKey] = raw;
    }
  }

  return values;
}
