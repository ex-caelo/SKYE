import type { GraphListColumn } from "../graph/types.js";

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
  };
  if (column.displayName && column.displayName !== column.name) field.label = column.displayName;
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
