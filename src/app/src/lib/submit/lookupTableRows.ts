import type { LookupTable } from "@skye/config";
import type { GraphClient } from "../graph/types.js";
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
  // SharePoint's Graph API writes a lookup column's value via a synthetic "<ColumnName>LookupId" field, set to the target item's numeric id.
  const lookupIdField = `${table.parentReferenceColumn}LookupId`;

  for (const row of rows) {
    if (row.deleted) {
      // A deleted row with no id was never saved server-side in the first place — nothing to do.
      if (row.id) await graph.deleteListItem(relatedSiteId, relatedListId, row.id);
      continue;
    }

    const sharepointFields = {
      ...mapValuesToSharePointFields(table.columns, row.values),
      [lookupIdField]: Number(parentItemId),
    };

    if (row.id) {
      await graph.updateListItem(relatedSiteId, relatedListId, row.id, sharepointFields);
    } else {
      await graph.createListItem(relatedSiteId, relatedListId, sharepointFields);
    }
  }
}
