import type { FieldConfig } from "@skye/form-config";
import type { GraphListColumn } from "../../../shared/sharepoint/types.js";

/** Control types that are display-only (or data-only) and are never given a `<label>`. */
const UNLABELLED_CONTROL_TYPES = new Set(["heading", "paragraph", "divider", "hidden"]);

/**
 * A readable fallback label from a field key: decodes SharePoint
 * `_x0020_`-style hex escapes, splits camelCase / underscores / hyphens,
 * and title-cases the first letter — e.g. `favouriteCampus` /
 * `Favourite_x0020_Campus` → `Favourite Campus`. Used when a field config
 * gives no `label` and there's no bound list column to borrow a
 * displayName from.
 */
export function humanizeFieldKey(key: string): string {
  const text = key
    .replace(/_x([0-9a-fA-F]{4})_/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

/**
 * Fills in `label` for every input field that doesn't already have one —
 * from its bound SharePoint column's `displayName` where possible (the
 * schema's own "label overrides the column's displayName" rule, applied),
 * otherwise from {@link humanizeFieldKey}. Mutates `fields` in place,
 * mirroring populateChoiceOptions' pattern; only ever run on the throwaway
 * merged config a render uses, never on anything saved. Display-only /
 * data-only controls (heading/paragraph/divider/hidden) are left alone —
 * they're not labelled fields.
 */
export function backfillFieldLabels(fields: Record<string, FieldConfig>, columns: GraphListColumn[]): void {
  const byName = new Map(columns.map((column) => [column.name, column]));
  for (const [key, field] of Object.entries(fields)) {
    if (field.label || UNLABELLED_CONTROL_TYPES.has(field.controlType)) continue;
    const column = field.bindTo ? byName.get(field.bindTo) : undefined;
    field.label = column?.displayName || humanizeFieldKey(key);
  }
}
