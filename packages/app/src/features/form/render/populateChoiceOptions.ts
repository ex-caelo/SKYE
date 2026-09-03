import type { FieldConfig } from "@skye/form-config";
import type { GraphListColumn } from "../../../shared/sharepoint/types.js";

/** controlTypes whose rendering reads field.options (see fieldRegistry.ts). */
const CHOICE_CONTROL_TYPES = new Set(["select", "radio", "checkboxGroup"]);

/**
 * Fills in `options` for sharepoint-sourced select/radio/checkboxGroup
 * fields that don't already declare static options, using the live
 * SharePoint choice column's `choices` (from GraphClient.getListColumns).
 * This lets a form author bind a control to a SharePoint Choice column via
 * just `bindTo`, without duplicating its values in form.config.json — the
 * allowed values come from SharePoint itself and stay in sync automatically.
 * A field with explicit static `options` already set is left untouched, so
 * an author can still override or extend the live choices deliberately.
 * Mutates `fields` in place (matches entry-form.ts's existing pattern for
 * the view-mode readonly pass).
 */
export function populateChoiceOptionsFromColumns(fields: Record<string, FieldConfig>, columns: GraphListColumn[]): void {
  const columnsByName = new Map(columns.map((column) => [column.name, column]));

  for (const field of Object.values(fields)) {
    if (field.source !== "sharepoint" || !CHOICE_CONTROL_TYPES.has(field.controlType) || field.options || !field.bindTo) {
      continue;
    }
    const column = columnsByName.get(field.bindTo);
    if (column?.choices) {
      field.options = column.choices.map((choice) => ({ value: choice, label: choice }));
    }
  }
}
