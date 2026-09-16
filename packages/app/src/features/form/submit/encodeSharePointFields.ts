import type { FieldConfig, FieldValues } from "@skye/form-config";
import type { GraphClient, GraphListColumn } from "../../../shared/sharepoint/types.js";

export interface EncodedFields {
  /** The `fields` payload to hand to createListItem / updateListItem. */
  fields: Record<string, unknown>;
  /** Per-field-key messages for anything that couldn't be fully encoded (e.g. a person who isn't a site user). The submission still proceeds; that field is left unwritten. */
  errors: Record<string, string>;
}

/** Coerces a scalar-or-array value into a clean array of non-empty entries. */
function toList(value: unknown): unknown[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  return list.filter((entry) => String(entry ?? "").trim() !== "");
}

/**
 * Builds the primary list item's `fields` payload from the form's values,
 * using each bound column's real type (from getListColumns) to encode
 * multi-value data the way SharePoint's Graph API actually expects:
 *
 *  - **personOrGroup** — each picked person (an email or directory id, as
 *    the people picker stores them) is resolved to this site's numeric
 *    User Information List id and written as `<col>LookupId` (a single id
 *    for a single-value column, a `Collection(Edm.Int32)` for a
 *    multi-value one). A person who can't be resolved to a site user is
 *    reported in `errors` and that field is left unwritten rather than
 *    failing the whole submit.
 *  - **choice** driven by a multi-select control (`checkboxGroup`) — a
 *    `Collection(Edm.String)` of the chosen values.
 *  - a stray array reaching any other column type is joined with `"; "` so
 *    it can't land as `[object Object]`.
 *  - everything else is passed straight through (same as the old
 *    mapValuesToSharePointFields, which is still used for lookupTable rows).
 *
 * Only `source: "sharepoint"` fields with a `bindTo` and a value present
 * in `values` participate — a field that was never touched is not sent, so
 * it isn't overwritten.
 */
export async function buildPrimarySharePointFields(
  graph: GraphClient,
  siteId: string,
  fields: Record<string, FieldConfig>,
  values: FieldValues,
  columns: GraphListColumn[]
): Promise<EncodedFields> {
  const columnsByName = new Map(columns.map((column) => [column.name, column]));
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const [fieldKey, field] of Object.entries(fields)) {
    if (field.source === "virtual" || !field.bindTo || !(fieldKey in values)) continue;

    const value = values[fieldKey];
    const column = columnsByName.get(field.bindTo);

    // --- Person / group column: resolve people to site user ids ---
    if (column?.columnType === "personOrGroup") {
      const identifiers = toList(value).map(String);
      if (identifiers.length === 0) continue; // cleared / untouched — don't overwrite

      const resolved = await Promise.all(identifiers.map((id) => graph.resolveSiteUserId(siteId, id).catch(() => null)));
      const ids = resolved.filter((id): id is number => typeof id === "number" && !Number.isNaN(id));
      const unresolved = identifiers.filter((_, i) => resolved[i] == null);

      if (unresolved.length > 0) {
        errors[fieldKey] = `Couldn't match ${unresolved.join(", ")} to a person on this site — left blank.`;
      }
      if (ids.length === 0) continue;

      const lookupField = `${field.bindTo}LookupId`;
      if (column.allowMultiple) {
        out[`${lookupField}@odata.type`] = "Collection(Edm.Int32)";
        out[lookupField] = ids;
      } else {
        out[lookupField] = ids[0];
      }
      continue;
    }

    // --- Choice column fed by a multi-select control ---
    if (column?.columnType === "choice" && field.controlType === "checkboxGroup") {
      const chosen = toList(value).map(String);
      // Send Collection(Edm.String) unless Graph POSITIVELY reports the column as single-value
      // (`allowMultiple === false`). It's often `undefined` for a real multi-choice column, and a
      // multi-select control is an explicit "this is multi" signal from the config author — so
      // default to the collection and let a genuinely-single column surface a clear 400.
      if (column.allowMultiple === false) {
        if (chosen.length > 0) out[field.bindTo] = chosen[0];
        if (chosen.length > 1) {
          errors[fieldKey] = `"${field.bindTo}" is a single-value Choice column — only "${chosen[0]}" was saved. Set it to allow multiple selections in SharePoint.`;
        }
      } else {
        out[`${field.bindTo}@odata.type`] = "Collection(Edm.String)";
        out[field.bindTo] = chosen;
      }
      continue;
    }

    // --- Any other column: never let an array through raw ---
    out[field.bindTo] = Array.isArray(value) ? toList(value).map(String).join("; ") : value;
  }

  return { fields: out, errors };
}
