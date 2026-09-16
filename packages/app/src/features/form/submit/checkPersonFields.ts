import type { FieldConfig, FieldValues } from "@skye/form-config";
import type { GraphClient, GraphListColumn } from "../../../shared/sharepoint/types.js";

/** Scalar-or-array -> array of non-empty strings. */
function toList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  return list.map(String).filter((s) => s.trim() !== "");
}

/**
 * Pre-submit check for people pickers bound to a SharePoint `personOrGroup`
 * column. A Graph `<col>LookupId` write can only target someone who is
 * already a member of this site (Graph, unlike the SharePoint UI, can't
 * "ensure" a brand-new site user) — so a picked person who doesn't resolve
 * has to BLOCK the submit with a field-level warning, not be silently
 * dropped and the item saved without them.
 *
 * Returns a `{ fieldKey: message }` map of fields that have unresolvable
 * picks; an empty object means every people picker is fine. Resolutions go
 * through `graph.resolveSiteUserId`, which caches per session, so the
 * encoder's later call for the same people is free.
 */
export async function checkPersonFieldsResolve(
  graph: GraphClient,
  siteId: string,
  fields: Record<string, FieldConfig>,
  columns: GraphListColumn[],
  values: FieldValues
): Promise<Record<string, string>> {
  const columnsByName = new Map(columns.map((column) => [column.name, column]));
  const errors: Record<string, string> = {};

  for (const [fieldKey, field] of Object.entries(fields)) {
    if (field.source === "virtual" || field.controlType !== "peoplePicker" || !field.bindTo) continue;
    if (columnsByName.get(field.bindTo)?.columnType !== "personOrGroup") continue;

    const picks = toList(values[fieldKey]);
    if (picks.length === 0) continue;

    const resolved = await Promise.all(picks.map((p) => graph.resolveSiteUserId(siteId, p).catch(() => null)));
    const missing = picks.filter((_, i) => resolved[i] == null);
    if (missing.length === 0) continue;

    const who = missing.join(", ");
    const isAre = missing.length === 1 ? "is" : "are";
    errors[fieldKey] = `${who} ${isAre} not a member of this site, so ${missing.length === 1 ? "they" : "they"} can't be added here. Remove ${missing.length === 1 ? "that person" : "them"} or pick someone who has access to this site.`;
  }

  return errors;
}
