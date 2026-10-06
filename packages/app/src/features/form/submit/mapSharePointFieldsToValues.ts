import type { FieldConfig, FieldValues } from "@skye/form-config";

/**
 * The `$select` list to pass to `getListItem` when loading an item for
 * edit/view-mode prefill — every bound column, so nothing loads with an
 * incomplete value.
 *
 * A single-value Person/Group column needs an extra push: Microsoft Graph
 * only returns that column's full `{LookupId, LookupValue}` object (the
 * display name) when the column is explicitly named in `$select` — left
 * out of a plain `$expand=fields` with no select, Graph falls back to
 * just the bare `<col>LookupId` scalar, which is why an edit-mode Person
 * chip could show a raw id ("14") instead of a name. A multi-value Person
 * column doesn't have this problem (it's always returned fully expanded,
 * with no scalar-only shortcut to fall back to), but selecting its
 * `LookupId` companion alongside it is harmless, so this does it for
 * every peoplePicker field uniformly rather than branching on
 * single-vs-multi (which isn't reliably knowable from the config alone).
 */
export function selectColumnsForEditPrefill(fields: Record<string, FieldConfig>): string[] {
  const columns = new Set<string>();
  for (const field of Object.values(fields)) {
    if (field.source !== "sharepoint" || !field.bindTo) continue;
    columns.add(field.bindTo);
    if (field.controlType === "peoplePicker") columns.add(`${field.bindTo}LookupId`);
  }
  return [...columns];
}

/**
 * Converts a SharePoint ISO datetime ("2026-10-01T22:00:00Z" — Graph always
 * returns DateTime columns as full UTC, regardless of the site's regional
 * settings) to what `<input type=date|datetime-local>` needs: the viewer's
 * OWN local wall-clock time, with no timezone suffix (the format
 * `datetime-local` itself always uses). A real, live bug this replaces: the
 * old version just string-sliced the UTC digits straight out of the ISO
 * string and dropped them into the control untouched, so a datetime-local
 * field displayed the UTC HOUR as if it were already local — a 4-hour
 * event created as 18:00 (America/Indiana/Indianapolis, UTC-4 in EDT) was
 * stored correctly as 22:00Z, then shown back as "22:00" in the edit/view
 * form while the Custom Views calendar (which already parses with `new
 * Date()` and reads back local components) showed the correct 18:00 for
 * the exact same item. `Date`'s local getters (`getFullYear`/`getMonth`/…)
 * do the UTC->local conversion for us — the same thing the calendar view
 * already relies on, just via explicit getters here instead of
 * `toLocaleString`, since the exact zero-padded shape `datetime-local`
 * requires isn't something `toLocaleString` produces directly.
 */
function trimDateForControl(value: string, controlType: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value; // not a parseable date — leave whatever's there alone
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (controlType === "date") return datePart;
  return `${datePart}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The inverse of the submit encoder: turns a SharePoint list item's
 * `fields` payload (from `getListItem`, `fields` expanded) into the value
 * map an edit- or view-mode form is seeded with (`renderForm`'s
 * `initialValues`).
 *
 * Only `source: "sharepoint"` fields with a `bindTo` are read.
 *  - Person columns arrive as `{ LookupId, LookupValue }` (or an array of
 *    them for a multi-value column) — passed through as-is: the chip
 *    picker's `normalisePeopleValue` renders them and keys on the numeric
 *    `LookupId`, which `personIdentifier` (used by both
 *    `checkPersonFieldsResolve` and the submit encoder) treats as an
 *    already-resolved site user (no re-lookup). **Real live-tenant
 *    deviation from that assumption, confirmed by an actual bug report**:
 *    a SINGLE-value `personOrGroup` column sometimes returns just the bare
 *    display-name STRING under `bindTo` (e.g. `"Cloteaux, Lison"`), not the
 *    `{LookupId, LookupValue}` object this file originally assumed —
 *    `selectColumnsForEditPrefill` already selects `<bindTo>LookupId`
 *    alongside it regardless, so below, a bare-string single-value person
 *    is rebuilt into `{LookupId, LookupValue: <the string>}` using that
 *    companion field, same shape as the multi-value case. Without this, an
 *    untouched edit-mode Host chip (a real, already-valid site member)
 *    resolved on nothing but its own display name, which
 *    `graph.resolveSiteUserId` can never match — surfacing as a false
 *    "is not a member of this site" on submit for someone who plainly was.
 *  - Multi-value Choice arrives as a string array — passed straight through
 *    to the multi-select control.
 *  - `date` / `datetime-local` values are trimmed to the control's format.
 *  - A `url` controlType field bound to a genuine Hyperlink/Picture column
 *    arrives as `{ Url, Description }` (the same shape `lookupTableRows.ts`
 *    writes it as — see that file for why a plain string isn't accepted by
 *    that column type) — unwrapped to just the URL string, which is what
 *    a plain `<input type="url">` (or a lookupTable row's own text input)
 *    can actually display. A `url` field bound to an ordinary Text column
 *    already arrives as a plain string and passes through unchanged.
 */
export function mapSharePointFieldsToValues(fields: Record<string, FieldConfig>, itemFields: Record<string, unknown>): FieldValues {
  const values: FieldValues = {};

  for (const [fieldKey, field] of Object.entries(fields)) {
    if (field.source === "virtual" || !field.bindTo) continue;

    // A person column's rich object lives under `bindTo`; some responses only carry `<bindTo>LookupId`.
    let raw = itemFields[field.bindTo];
    const lookupIdRaw = field.controlType === "peoplePicker" ? itemFields[`${field.bindTo}LookupId`] : undefined;
    if (raw === undefined && field.controlType === "peoplePicker") raw = lookupIdRaw;
    if (raw === undefined || raw === null || raw === "") continue;

    // See this function's own doc comment: a single-value personOrGroup column can return just
    // the bare display name here — rebuild a resolvable object from the separately-selected
    // LookupId companion, so an untouched Host chip stays resolvable on submit.
    if (field.controlType === "peoplePicker" && typeof raw === "string" && lookupIdRaw !== undefined && lookupIdRaw !== null) {
      const id = Number(lookupIdRaw);
      if (!Number.isNaN(id)) raw = { LookupId: id, LookupValue: raw };
    }

    if (field.controlType === "url" && raw && typeof raw === "object" && "Url" in raw) {
      values[fieldKey] = String((raw as { Url: unknown }).Url ?? "");
    } else if ((field.controlType === "date" || field.controlType === "datetime-local") && typeof raw === "string") {
      values[fieldKey] = trimDateForControl(raw, field.controlType);
    } else {
      values[fieldKey] = raw;
    }
  }

  return values;
}
