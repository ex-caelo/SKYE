import type { FieldConfig, FieldValues } from "@skye/form-config";
import type { GraphClient, GraphListColumn } from "../../../shared/sharepoint/types.js";
import { personIdentifier } from "./personIdentifier.js";

export interface EncodedFields {
  /** The `fields` payload to hand to createListItem / updateListItem. */
  fields: Record<string, unknown>;
  /** Per-field-key messages for anything that couldn't be fully encoded (e.g. a person who isn't a site user). The submission still proceeds; that field is left unwritten. */
  errors: Record<string, string>;
}

/**
 * A `file` controlType field can't be bound to a `hyperlinkOrPicture` or
 * `thumbnail` (Image) column — confirmed against a live tenant (2026-09):
 * both a plain URL string AND the fuller structured JSON shape these
 * column types otherwise expect both come back `generalException` from
 * Graph's `/fields` PATCH/POST, matching independent reports that Graph
 * doesn't support writing these column types at all, regardless of shape
 * or API version (only the older SharePoint REST API does). There is no
 * write this app can attempt here that's known to work — so rather than
 * retry a shape that's already failed live, this reports it as a
 * left-unwritten field error (like an unresolvable person). The message
 * itself stays short and user-facing (it surfaces verbatim in the
 * submit-status banner, same as the unresolvable-person case) — the fix a
 * config author actually needs (bind the field to a plain Text/Note
 * column instead, to store the URL as a string) belongs in this file's
 * comments and the form's own README, not in something an end user sees.
 */
function unsupportedFileColumnError(field: FieldConfig, column: GraphListColumn): string {
  const saved = field.fileStorage?.target === "library" ? " (the file itself still uploaded)" : "";
  return `"${column.displayName}" couldn't be saved on this item${saved} — ask whoever maintains this form to fix it.`;
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
 *  - **file controlType, bound to a hyperlinkOrPicture or thumbnail
 *    (Image) column** — reported as an error and left unwritten; see
 *    unsupportedFileColumnError for why (Graph can't write these column
 *    types, confirmed live). Any OTHER column type gets the uploaded
 *    webUrl (already substituted into `values` by submitForm's upload
 *    step) as a plain string, same as any other text-like field.
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

    // --- file field bound to a column type Graph can't write to at all — see unsupportedFileColumnError ---
    if (field.controlType === "file" && column && (column.columnType === "hyperlinkOrPicture" || column.columnType === "thumbnail")) {
      errors[fieldKey] = unsupportedFileColumnError(field, column);
      continue;
    }

    // --- Person / group column: resolve people to site user ids ---
    if (column?.columnType === "personOrGroup") {
      // personIdentifier (not a naive `.map(String)`) so an untouched edit-mode value — a raw
      // SharePoint `{LookupId, LookupValue, Email}` object/array — resolves correctly instead of
      // stringifying to "[object Object]" and getting dropped as an unresolvable person.
      const identifiers = toList(value).map(personIdentifier);
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
