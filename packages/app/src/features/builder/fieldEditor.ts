import type { FieldConfig } from "@skye/form-config";
import { getFieldSchemaProperties } from "@skye/form-config";
import type { GraphListColumn } from "../../shared/sharepoint/types.js";
import {
  renderObjectEditor,
  wrapRow,
  humanizeKey,
  coerceUnknown,
  stringifyUnknown,
  type ChangeHandler,
  type PropertyControlOverrides,
} from "./schemaControls.js";
import { renderButtonActionsEditor } from "./buttonActionsEditor.js";
import type { PostActionEntry } from "./formSettingsEditor.js";

/** controlTypes whose rendering reads field.options (see fieldRegistry.ts) — mirrors populateChoiceOptions.ts's own list. */
const CHOICE_CONTROL_TYPES = new Set(["select", "radio", "checkboxGroup"]);

/**
 * The full FieldConfig property editor used by /builder's right pane —
 * every property comes straight from getFieldSchemaProperties() (see
 * schemaIntrospection.ts), so this stays in sync with the schema
 * automatically. Layers exactly two narrow, well-justified UX enhancements
 * on top of the fully generic renderObjectEditor, both using data the
 * builder already has on hand:
 *
 *  - `bindTo` renders as a dropdown of the target list's real live column
 *    names (from GraphClient.getListColumns), instead of a freeform text
 *    box an author could easily mistype.
 *  - `page` renders as a dropdown of the config's own current page keys,
 *    instead of free text — a field whose `page` doesn't match a real page
 *    key silently never renders (see renderForm.ts), so this closes off a
 *    whole class of "my field doesn't show up" confusion.
 *
 * Everything else — every other property, and both of these when the
 * relevant data isn't available (e.g. list columns failed to load) — falls
 * straight back through to the generic schema-driven renderer.
 */
export function renderFieldEditor(
  field: FieldConfig & Record<string, unknown>,
  onChange: ChangeHandler,
  document: Document,
  context: { listColumns?: GraphListColumn[]; pageKeys?: string[]; scriptActionNames?: string[] }
): HTMLElement {
  const overrides: PropertyControlOverrides = {};

  // Only for controlType "button" — every other field gets the generic, presence-toggled
  // "dictionary" editor this same `actions` property would otherwise fall back to (matching how
  // `fileStorage`/`calculatedDisplay`/`table` already render for a field whose controlType
  // doesn't need them). A button's own `actions` isn't optional the same way those are (the
  // schema requires the key to be present, if empty), so it renders directly — no toggle — with
  // the same wave-grouped, dependsOn-aware card UI the form-root Post Actions editor uses.
  if (field.controlType === "button") {
    overrides.actions = (_prop, parent, notify, doc) => {
      const actions = (parent.actions ??= {}) as Record<string, PostActionEntry>;
      const wrap = doc.createElement("div");
      const heading = doc.createElement("h4");
      heading.textContent = "Actions (run on click)";
      wrap.append(heading, renderButtonActionsEditor(actions, notify, doc, context.scriptActionNames ?? []));
      return wrap;
    };
  }

  if (context.listColumns && context.listColumns.length > 0) {
    overrides.bindTo = (prop, parent, notify, doc) => {
      const select = doc.createElement("select");
      const blank = doc.createElement("option");
      blank.value = "";
      blank.textContent = "— none —";
      select.appendChild(blank);
      for (const column of context.listColumns!) {
        const opt = doc.createElement("option");
        opt.value = column.name;
        opt.textContent = column.displayName === column.name ? column.name : `${column.displayName} (${column.name})`;
        select.appendChild(opt);
      }
      select.value = typeof parent[prop.key] === "string" ? (parent[prop.key] as string) : "";
      select.addEventListener("change", () => {
        parent[prop.key] = select.value === "" ? undefined : select.value;
        notify();
      });

      const row = wrapRow(humanizeKey(prop.key) + (prop.required ? " *" : ""), "SharePoint column internal name — from the target list's live column schema.", select, doc);

      // A one-click way to pull a Choice column's real allowed values into `options`, for the
      // three control types that read them (see populateChoiceOptions.ts, used the same way at
      // render time for a form that DOESN'T set static options at all).
      const controlType = parent.controlType as string | undefined;
      if (controlType && CHOICE_CONTROL_TYPES.has(controlType)) {
        const fillBtn = doc.createElement("button");
        fillBtn.type = "button";
        fillBtn.textContent = "Fill options from this column's choices";
        fillBtn.addEventListener("click", () => {
          const column = context.listColumns!.find((c) => c.name === select.value);
          if (column?.choices) {
            parent.options = column.choices.map((choice) => ({ value: choice, label: choice }));
            notify();
          }
        });
        row.appendChild(fillBtn);
      }

      return row;
    };
  }

  if (context.pageKeys && context.pageKeys.length > 0) {
    overrides.page = (prop, parent, notify, doc) => {
      const select = doc.createElement("select");
      const blank = doc.createElement("option");
      blank.value = "";
      blank.textContent = "— none —";
      select.appendChild(blank);
      for (const pageKey of context.pageKeys!) {
        const opt = doc.createElement("option");
        opt.value = pageKey;
        opt.textContent = pageKey;
        select.appendChild(opt);
      }
      select.value = typeof parent[prop.key] === "string" ? (parent[prop.key] as string) : "";
      select.addEventListener("change", () => {
        parent[prop.key] = select.value === "" ? undefined : select.value;
        notify();
      });
      return wrapRow(humanizeKey(prop.key) + (prop.required ? " *" : ""), "Which page (from the form's own pages dict) this field belongs to.", select, doc);
    };
  }

  // customValidators entries can be a bare name or a { name, args } object (see
  // docs/custom-validators-authoring.md), which is genuinely mixed-shape, so it falls
  // back to the same raw-JSON textarea the generic "unknown" kind already renders —
  // this override just swaps in a placeholder that actually explains the shape.
  overrides.customValidators = (prop, parent, notify, doc) => {
    const textarea = doc.createElement("textarea");
    textarea.rows = 3;
    textarea.value = stringifyUnknown(parent[prop.key]);
    textarea.placeholder = '["validatorName", { "name": "compareField", "args": { "field": "startTime", "operator": "greaterThan" } }]';
    textarea.addEventListener("input", () => {
      parent[prop.key] = coerceUnknown(textarea.value);
      notify();
    });
    return wrapRow(
      humanizeKey(prop.key),
      "Names of validator functions from the app's registry, plain or with args — see docs/custom-validators-authoring.md.",
      textarea,
      doc
    );
  };

  return renderObjectEditor(getFieldSchemaProperties(), field, onChange, document, overrides);
}
