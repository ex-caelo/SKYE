import type { FieldConfig, FieldValues } from "@skye/form-config";

/**
 * Converts a values object keyed by SKYE field key into a SharePoint
 * `fields` payload keyed by internal column name (`bindTo`), ready to pass
 * to GraphClient's createListItem/updateListItem. Only `source: "sharepoint"`
 * fields participate — `virtual` fields exist client-side only and are
 * never written back (per the schema's own description of `source`).
 * Reused for both the primary item and lookupTable row writes, since both
 * are "a dict of FieldConfig keyed by field key" in the same shape.
 */
export function mapValuesToSharePointFields(fields: Record<string, FieldConfig>, values: FieldValues): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [fieldKey, field] of Object.entries(fields)) {
    if (field.source === "virtual") continue;
    if (!field.bindTo) continue; // shouldn't happen for a sharepoint-source field per schema, but guard rather than write "undefined" as a key
    if (!(fieldKey in values)) continue; // field was never touched — don't send a null/undefined overwrite

    result[field.bindTo] = values[fieldKey];
  }

  return result;
}
