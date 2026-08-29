import type { FormConfig, FormConfigOverlay } from "@skye/config";
import { getFormTopLevelProperties, getPageSchemaProperties, getPostActionSchemaProperties } from "@skye/config";
import { renderObjectEditor, renderNamedObjectDictionary, renderPropertyControl, type ChangeHandler } from "./schemaControls.js";

/**
 * The right pane's default panel (shown when no field is selected):
 * top-level form settings (title/description/mode/list/layout — everything
 * in the base FormConfig root except pages/fields/postActions, which get
 * their own dedicated sections below) plus the Pages and Post Actions
 * dictionaries. `fields` is deliberately NOT included here — it's edited
 * through the live preview's click-to-select flow (see builderPreview.ts
 * and entry-builder.ts) instead of a flat list, since a field only really
 * makes sense to edit in the context of seeing where it renders.
 */
export function renderFormSettingsEditor(config: FormConfig | FormConfigOverlay, onChange: ChangeHandler, document: Document): HTMLElement {
  const container = document.createElement("div");
  container.className = "skye-builder__settings";

  const settingsHeading = document.createElement("h3");
  settingsHeading.textContent = "Form settings";
  container.appendChild(settingsHeading);
  container.appendChild(renderObjectEditor(getFormTopLevelProperties(), config as unknown as Record<string, unknown>, onChange, document));

  const pagesHeading = document.createElement("h3");
  pagesHeading.textContent = "Pages";
  container.appendChild(pagesHeading);
  const pages = ((config as { pages?: Record<string, unknown> }).pages ??= {});
  container.appendChild(renderNamedObjectDictionary(getPageSchemaProperties(), pages, onChange, document));

  const postActionsHeading = document.createElement("h3");
  postActionsHeading.textContent = "Post actions";
  container.appendChild(postActionsHeading);
  const postActions = ((config as { postActions?: Record<string, unknown> }).postActions ??= {});
  container.appendChild(renderPostActionsDictionary(postActions, onChange, document));

  return container;
}

/**
 * postActions is the one dictionary whose per-entry property LIST changes
 * after it's already rendered — a postAction's real editable payload
 * (`request`/`to`/`message`/`functionName`/...) depends on its own `type`,
 * which lives inside the same entry (see getPostActionSchemaProperties).
 * Wires renderNamedObjectDictionary's dynamic `itemProperties` function
 * together with an `overridesFor` on just the `type` control, so choosing
 * a different type tears down and rebuilds THAT one entry's body — not the
 * whole postActions list, and not on every ordinary keystroke elsewhere.
 */
function renderPostActionsDictionary(postActions: Record<string, unknown>, onChange: ChangeHandler, document: Document): HTMLElement {
  return renderNamedObjectDictionary(
    (_key, entry) => getPostActionSchemaProperties((entry.type as string | undefined) ?? ""),
    postActions,
    onChange,
    document,
    {
      overridesFor: (_entryKey, rerenderEntry) => ({
        type: (prop, parent, notify, doc) => renderPropertyControl(prop, parent, () => { notify(); rerenderEntry(); }, doc),
      }),
    }
  );
}
