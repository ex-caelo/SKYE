import type { GraphListColumn } from "../../shared/sharepoint/types.js";

/**
 * Maps a SharePoint list to SKYE form fields — the glue behind the
 * builder's "bind a field to a column" flow and its "you're missing a
 * required column" check.
 *
 * A form can only write a `source: "sharepoint"` field back to its column,
 * and SharePoint rejects a create that omits any required column, so the
 * builder uses this to (a) auto-pick a sensible `controlType` when an
 * author binds a new field to a column, and (b) surface / seed fields for
 * required columns that no field covers yet.
 */

/** The SKYE `controlType` that best fits a SharePoint column's type. */
export function controlTypeForColumn(column: GraphListColumn): string {
  switch (column.columnType) {
    case "note":
      return "textarea";
    case "number":
      return "number";
    case "currency":
      return "currency";
    case "boolean":
      return "checkbox";
    case "dateTime":
      return "date";
    case "choice":
      return "select";
    case "lookup":
      return "lookupPicker";
    case "personOrGroup":
      return "peoplePicker";
    case "hyperlinkOrPicture":
      return "url";
    case "text":
    default:
      return "text";
  }
}

/**
 * A ready-to-drop FieldConfig object bound to `column`: `source`
 * `"sharepoint"`, `bindTo` its internal name, `controlType` from
 * {@link controlTypeForColumn}, `label` its display name (when it differs
 * from the internal name), `required` when the column is, and `page` if
 * given. `controlType` can be overridden by the caller afterward.
 */
export function fieldConfigForColumn(column: GraphListColumn, page?: string): Record<string, unknown> {
  const field: Record<string, unknown> = {
    source: "sharepoint",
    bindTo: column.name,
    controlType: controlTypeForColumn(column),
    // Always give the field an explicit label so it renders with one and the author can see/edit it.
    label: column.displayName || column.name,
  };
  if (column.required) field.required = true;
  if (page) field.page = page;
  return field;
}

/**
 * A valid, readable field key derived from a column (its display name,
 * SharePoint `_x0020_`-style hex escapes decoded, camelCased), made unique
 * against `taken`. Falls back to `field`/`fieldN` if the name has nothing
 * usable.
 */
export function fieldKeyForColumn(column: GraphListColumn, taken: Set<string>): string {
  const words = (column.displayName || column.name)
    .replace(/_x([0-9a-fA-F]{4})_/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let base = words.map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
  if (!/^[a-zA-Z]/.test(base)) base = `field${base ? base[0].toUpperCase() + base.slice(1) : ""}`;
  if (!base) base = "field";

  let unique = base;
  let n = 2;
  while (taken.has(unique)) unique = `${base}${n++}`;
  return unique;
}

/**
 * A form-wide `layout` that stacks every field one per row in a single CSS
 * Grid column. There's no `gridTemplateAreas` — fields auto-flow in `order`
 * — so nothing goes stale as the author adds, removes or reorders fields
 * later. This is what a brand-new form defaults to (see entry-builder.ts).
 */
export const SINGLE_COLUMN_LAYOUT = { gridTemplateColumns: 1 } as const;

/**
 * Bound, `order`-ed FieldConfig objects for every required, writable
 * column, keyed by a generated field key. Used to seed a brand-new form so
 * it can submit against its list from the start.
 */
export function requiredColumnFields(
  columns: GraphListColumn[],
  page: string | undefined,
  startOrder = 1
): Record<string, Record<string, unknown>> {
  const fields: Record<string, Record<string, unknown>> = {};
  const taken = new Set<string>();
  let order = startOrder;
  for (const column of columns.filter((c) => c.required && !c.readOnly)) {
    const key = fieldKeyForColumn(column, taken);
    taken.add(key);
    fields[key] = { ...fieldConfigForColumn(column, page), order: order++ };
  }
  return fields;
}

/**
 * The list's required, writable columns that no `source: "sharepoint"`
 * field currently binds to — i.e. the columns whose absence would make a
 * create submission fail. Read-only/computed columns are excluded (a form
 * can't fill them).
 */
export function missingRequiredColumns(
  fields: Record<string, { bindTo?: unknown; source?: unknown }> | undefined,
  columns: GraphListColumn[]
): GraphListColumn[] {
  const bound = new Set(
    Object.values(fields ?? {})
      .filter((f) => (f.source ?? "sharepoint") === "sharepoint" && typeof f.bindTo === "string")
      .map((f) => f.bindTo as string)
  );
  return columns.filter((c) => c.required && !c.readOnly && !bound.has(c.name));
}
