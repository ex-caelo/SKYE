import type { FieldConfig, FieldValues, LookupTable } from "@skye/form-config";
import type { GraphClient, GraphListColumn } from "../../../shared/sharepoint/types.js";
import { mapValuesToSharePointFields } from "./mapValuesToSharePointFields.js";

/**
 * One row's current state, as a lookupTable field's value is expected to
 * shape it. `id` present means an existing related-list item (edit mode);
 * absent means a new row to create. `deleted: true` means the user removed
 * a previously-existing row and it should be deleted from the related list
 * (a row that was never saved, i.e. no `id`, and gets removed client-side
 * should just be dropped from the array entirely rather than marked
 * deleted — see skye-lookup-table's remove handler in registerElements.ts).
 */
export interface LookupTableRow {
  id?: string;
  values: Record<string, unknown>;
  deleted?: boolean;
}

/**
 * `mapValuesToSharePointFields`, plus one override: a Hyperlink/Picture
 * column needs its value as `{ Url, Description }`, not a plain string —
 * confirmed live (2026-09): a bare string 500s with `generalException`
 * from Graph's `/fields` endpoint (the same failure this app's Poster
 * field hit before it moved off that column type entirely — see
 * docs/build-log.md §26–§28). No separate "link text" concept exists in
 * this schema's `url` controlType, so `Description` reuses the same
 * value as `Url`.
 *
 * Which columns need this is decided by `field.controlType === "url"`
 * (the config's own declared intent — the same convention
 * `columnMapping.ts` already uses the other direction, mapping a live
 * `hyperlinkOrPicture` column TO `url` when a field is first bound), OR
 * by `relatedColumnsByName` reporting `hyperlinkOrPicture` directly,
 * whichever fires. **`controlType` is the primary signal, not a
 * fallback**: confirmed live that Graph's `/columns` endpoint — both the
 * collection AND a single-column GET by id or by name — can omit the
 * `hyperlinkOrPicture` facet entirely for a real Hyperlink column with no
 * way to ask for it differently (matches Microsoft's own columnDefinition
 * docs, which footnote that the type facets can be entirely absent from
 * this API for some columns). `relatedColumnsByName` is kept only as an
 * extra trigger for a tenant/column where Graph's metadata DOES report it
 * correctly — it can never suppress the controlType-based encoding.
 *
 * Returns whether any column in this row needed the override, so the
 * caller knows to send `Prefer: apiversion=2.1` on the write (required
 * for a hyperlinkOrPicture write specifically, confirmed via Microsoft
 * Q&A).
 */
function encodeLookupTableRowFields(
  columns: Record<string, FieldConfig>,
  values: FieldValues,
  relatedColumnsByName: Map<string, GraphListColumn>
): { fields: Record<string, unknown>; needsBetaApiVersion: boolean } {
  const fields = mapValuesToSharePointFields(columns, values);
  let needsBetaApiVersion = false;

  for (const field of Object.values(columns)) {
    if (!field.bindTo || !(field.bindTo in fields)) continue;
    const isHyperlink = field.controlType === "url" || relatedColumnsByName.get(field.bindTo)?.columnType === "hyperlinkOrPicture";
    if (!isHyperlink) continue;
    const value = fields[field.bindTo];
    if (typeof value !== "string" || !value) continue; // empty/untouched — nothing to encode
    fields[field.bindTo] = { Url: value, Description: value };
    needsBetaApiVersion = true;
  }

  return { fields, needsBetaApiVersion };
}

/**
 * Writes a lookupTable field's rows to its related list. Only meaningful
 * for `linkMode: "parentReference"` — `lookupColumn` mode's relationship
 * lives on the PRIMARY item's own lookup column value, which is written as
 * part of the primary item's normal field mapping, so there's nothing
 * extra to do here for that mode (see the schema's own `linkMode`
 * description).
 *
 * Requires `parentItemId` to already exist — this is why lookupTable row
 * writes happen after the primary item write in submitForm.ts, not before
 * (a brand-new item has no ID for rows to reference yet).
 */
export async function writeLookupTableRows(
  graph: GraphClient,
  siteId: string,
  table: LookupTable,
  parentItemId: string,
  rows: LookupTableRow[]
): Promise<void> {
  if (table.linkMode !== "parentReference") return;
  if (!table.parentReferenceColumn) throw new Error("parentReference linkMode requires parentReferenceColumn.");

  const relatedSiteId = table.relatedList.siteId ?? siteId;
  const relatedListId = table.relatedList.id;
  // SharePoint's Graph API writes a lookup column's value via a synthetic "<ColumnName>LookupId"
  // field, set to the target item's id — as a STRING, confirmed live (2026-09) and matching two
  // independent Microsoft/community examples: a genuine single-value "Lookup" column (distinct
  // from Person/Group, which this app's Host/CohostsLookupId already prove works as a *number*)
  // rejects a JSON number here with "Field '<name>' of type 'Lookup' was not converted properly" —
  // no @odata.type annotation needed for the single-value case, only for a multi-value Collection.
  const lookupIdField = `${table.parentReferenceColumn}LookupId`;

  // Only needed to encode a hyperlinkOrPicture-typed column correctly (see
  // encodeLookupTableRowFields) — skip the extra Graph call entirely when this batch is only
  // deletions (nothing to encode) or empty. Best-effort: a schema-lookup failure here (e.g. a
  // transient error, or a permissions gap on just the columns endpoint) falls back to an empty
  // map — no hyperlinkOrPicture encoding happens, same as before that existed — rather than
  // aborting every row write in this batch over it.
  const rowsToWrite = rows.filter((row) => !row.deleted);
  let relatedColumnsByName = new Map<string, GraphListColumn>();
  if (rowsToWrite.length > 0) {
    try {
      relatedColumnsByName = new Map((await graph.getListColumns(relatedSiteId, relatedListId)).map((c) => [c.name, c]));
    } catch (err) {
      console.warn(`writeLookupTableRows: couldn't load column types for related list "${relatedListId}" — writing values as-is.`, err);
    }
  }

  for (const row of rows) {
    if (row.deleted) {
      // A deleted row with no id was never saved server-side in the first place — nothing to do.
      if (row.id) await graph.deleteListItem(relatedSiteId, relatedListId, row.id);
      continue;
    }

    const { fields: encodedRowFields, needsBetaApiVersion } = encodeLookupTableRowFields(table.columns, row.values, relatedColumnsByName);
    const sharepointFields = { ...encodedRowFields, [lookupIdField]: parentItemId };
    const writeOptions = needsBetaApiVersion ? { preferBetaApiVersion: true } : undefined;

    if (row.id) {
      await graph.updateListItem(relatedSiteId, relatedListId, row.id, sharepointFields, undefined, writeOptions);
    } else {
      await graph.createListItem(relatedSiteId, relatedListId, sharepointFields, writeOptions);
    }
  }
}
