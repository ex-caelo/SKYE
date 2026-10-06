import type { SchemaProperty } from "@skye/form-config";
import { getPostActionSchemaProperties } from "@skye/form-config";
import {
  renderObjectEditor,
  renderPropertyControl,
  wrapRow,
  type ChangeHandler,
  type PropertyControlOverrides,
} from "./schemaControls.js";
import { computeWaves, renderFunctionNameControl, type PostActionEntry } from "./formSettingsEditor.js";

/**
 * The action-list editor for one `controlType: "button"` field's own
 * `actions` dict — the same wave-grouped, dependsOn-aware card UI
 * `formSettingsEditor.ts`'s Post Actions editor already gives the form-root
 * `postActions`, minus the trigger-PHASE grouping that doesn't apply here:
 * a button has exactly one implicit "phase" (its own click), so every
 * action in this dict is already scoped to it by construction (it's a
 * field-local dict, not the form-wide one) — there's no phase to choose or
 * move between. `trigger` is fixed to `"onClick"` on every entry and never
 * shown as an editable control (same idea as the postAction editor already
 * hiding `trigger`, just for a different reason: there it's owned by which
 * phase section a card sits in; here it's simply always the same value).
 */
export function renderButtonActionsEditor(
  actions: Record<string, PostActionEntry>,
  onChange: ChangeHandler,
  document: Document,
  scriptActionNames: string[]
): HTMLElement {
  const root = document.createElement("div");
  root.className = "skye-builder__phases skye-builder__button-actions";

  const rerender = (): void => {
    root.replaceChildren();

    const keys = Object.keys(actions);
    if (keys.length === 0) {
      const none = document.createElement("p");
      none.className = "skye-builder__phase-empty";
      none.textContent = "No actions yet — this button does nothing when clicked.";
      root.appendChild(none);
    } else {
      const waves = computeWaves(keys, actions);
      waves.forEach((waveKeys, waveIndex) => {
        if (waveKeys.length === 0) return;
        if (waveIndex > 0) {
          const sep = document.createElement("p");
          sep.className = "skye-builder__wave-sep";
          sep.textContent = "↓ then";
          root.appendChild(sep);
        }
        const wave = document.createElement("div");
        wave.className = "skye-builder__wave";

        const waveLabel = document.createElement("p");
        waveLabel.className = "skye-builder__wave-label";
        waveLabel.textContent =
          waveKeys.length > 1 ? `Step ${waveIndex + 1} — these ${waveKeys.length} actions run at the same time` : `Step ${waveIndex + 1}`;
        wave.appendChild(waveLabel);

        for (const key of waveKeys) wave.appendChild(renderCard(key));
        root.appendChild(wave);
      });
    }

    const addRow = document.createElement("div");
    addRow.className = "skye-builder__dict-add skye-builder__phase-add";
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.placeholder = "action key (letters, digits, underscore; must start with a letter)";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+ Add action";
    const errorEl = document.createElement("span");
    errorEl.className = "skye-builder__dict-add-error";
    addBtn.addEventListener("click", () => {
      const newKey = keyInput.value.trim();
      errorEl.textContent = "";
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(newKey)) {
        errorEl.textContent = "Key must start with a letter and contain only letters, digits, underscore.";
        return;
      }
      if (newKey in actions) {
        errorEl.textContent = "That action key already exists.";
        return;
      }
      actions[newKey] = { trigger: "onClick" };
      keyInput.value = "";
      onChange();
      rerender();
    });
    addRow.append(keyInput, addBtn, errorEl);
    root.appendChild(addRow);
  };

  const renderCard = (key: string): HTMLElement => {
    const entry = (actions[key] ??= { trigger: "onClick" });
    entry.trigger = "onClick"; // fixed — see this function's own doc comment

    const card = document.createElement("div");
    card.className = "skye-builder__dict-entry skye-builder__action-card";
    card.dataset.actionKey = key;

    const heading = document.createElement("div");
    heading.className = "skye-builder__dict-entry-heading";
    const name = document.createElement("span");
    name.textContent = key;
    heading.appendChild(name);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      delete actions[key];
      for (const other of Object.values(actions)) {
        if (other.dependsOn) {
          other.dependsOn = other.dependsOn.filter((d) => d !== key);
          if (other.dependsOn.length === 0) delete other.dependsOn;
        }
      }
      onChange();
      rerender();
    });
    heading.appendChild(removeBtn);
    card.appendChild(heading);

    const deps = (entry.dependsOn ?? []).filter((d) => d !== key);
    const seq = document.createElement("p");
    seq.className = "skye-builder__seq";
    if (deps.length > 0) {
      seq.classList.add("skye-builder__seq--after");
      seq.textContent = `Waits for: ${deps.join(", ")}`;
    } else {
      const siblingCount = Object.keys(actions).length - 1;
      seq.classList.add("skye-builder__seq--parallel");
      seq.textContent = siblingCount > 0 ? "Starts immediately, alongside this button's other unblocked actions." : "Starts immediately.";
    }
    card.appendChild(seq);

    const body = document.createElement("div");
    card.appendChild(body);

    const renderBody = (): void => {
      body.replaceChildren();
      // `trigger` is fixed (see above); `type` and `dependsOn` get smarter controls; everything
      // else — the type-specific payload (request/to/message/functionName/etc) — is generic.
      const props = getPostActionSchemaProperties(entry.type ?? "").filter((p) => p.key !== "trigger");
      const overrides: PropertyControlOverrides = {
        type: (prop, parent, notify, doc) =>
          renderPropertyControl(prop, parent, () => {
            notify();
            renderBody();
          }, doc),
        dependsOn: renderDependsOnControl(key, actions, () => {
          onChange();
          rerender();
        }),
      };
      if (scriptActionNames.length > 0) overrides.functionName = renderFunctionNameControl(scriptActionNames);
      body.appendChild(renderObjectEditor(props, entry as Record<string, unknown>, onChange, document, overrides));
    };
    renderBody();

    return card;
  };

  rerender();
  return root;
}

/**
 * `dependsOn` as a checkbox list of this button's OTHER actions — no phase
 * filtering needed (unlike formSettingsEditor.ts's own version): every
 * entry in `actions` already belongs to this one button by construction.
 */
function renderDependsOnControl(
  selfKey: string,
  actions: Record<string, PostActionEntry>,
  notifyStructural: ChangeHandler
): (prop: SchemaProperty, parent: Record<string, unknown>, onChange: ChangeHandler, document: Document) => HTMLElement {
  return (prop, parent, _onChange, document) => {
    const wrap = document.createElement("div");
    wrap.className = "skye-builder__depends";

    const siblings = Object.keys(actions).filter((k) => k !== selfKey);
    const description = typeof prop.schema.description === "string" ? (prop.schema.description as string) : undefined;

    if (siblings.length === 0) {
      const none = document.createElement("span");
      none.className = "skye-builder__depends-empty";
      none.textContent = "No other actions on this button to wait for yet.";
      wrap.appendChild(none);
      return wrapRow("Runs after", description, wrap, document);
    }

    const current = new Set((parent.dependsOn as string[] | undefined) ?? []);
    for (const sib of siblings) {
      const label = document.createElement("label");
      label.className = "skye-builder__depends-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = current.has(sib);
      cb.addEventListener("change", () => {
        if (cb.checked) current.add(sib);
        else current.delete(sib);
        parent.dependsOn = current.size > 0 ? [...current] : undefined;
        notifyStructural();
      });
      label.append(cb, ` ${sib}`);
      wrap.appendChild(label);
    }
    return wrapRow("Runs after", description, wrap, document);
  };
}
