import type { FormConfig, FormConfigOverlay, SchemaProperty } from "@skye/config";
import { getFormTopLevelProperties, getPageSchemaProperties, getPostActionSchemaProperties } from "@skye/config";
import type { GraphListColumn } from "../graph/types.js";
import { fieldConfigForColumn, fieldKeyForColumn, missingRequiredColumns } from "./columnMapping.js";
import { renderObjectEditor, renderNamedObjectDictionary, renderPropertyControl, wrapRow, type ChangeHandler, type PropertyControlOverrides } from "./schemaControls.js";

/** Options a caller can thread through to the settings editor. */
export interface FormSettingsEditorOptions {
  /**
   * The app's real `scriptActions` registry keys (e.g. `teams.sendMessage`,
   * `outlook.createCalendarEvent`, `engage.createEvent`) — see
   * `src/actions/registry.ts`. When provided, a `script` postAction's
   * `functionName` renders as a grouped dropdown of exactly these instead
   * of a free-text box, so a form author can only pick an action this
   * build actually ships.
   */
  scriptActionNames?: string[];
  /** The target list's live column schema — powers the "missing required columns" check below. */
  listColumns?: GraphListColumn[];
  /** Page a newly-added required-column field is placed on (usually the first page). */
  defaultPageKey?: string;
  /** Show the "required SharePoint columns with no field" panel (only meaningful for a full config — base or draft, not an additive overlay). */
  requiredColumnCheck?: boolean;
  /** Called after this editor adds one or more fields, so the caller can re-render the field list / preview. Falls back to a local re-render of just the panel. */
  onFieldsChanged?: () => void;
}

/**
 * The right pane's default panel (shown when no field is selected):
 * top-level form settings (title/description/mode/list/layout — everything
 * in the base FormConfig root except pages/fields/postActions, which get
 * their own dedicated sections below) plus the Pages editor and the Post
 * Actions editor. `fields` is deliberately NOT included here — it's edited
 * through the live preview's click-to-select flow (see builderPreview.ts
 * and entry-builder.ts) instead of a flat list, since a field only really
 * makes sense to edit in the context of seeing where it renders.
 */
export function renderFormSettingsEditor(
  config: FormConfig | FormConfigOverlay,
  onChange: ChangeHandler,
  document: Document,
  options: FormSettingsEditorOptions = {}
): HTMLElement {
  const container = document.createElement("div");
  container.className = "skye-builder__settings";

  // A form can't submit while a required SharePoint column has no field bound to it — surface those
  // up front, with one-click "add a field for this column". Only for a full config (base/draft).
  if (options.requiredColumnCheck && options.listColumns && options.listColumns.length > 0) {
    container.appendChild(
      renderMissingRequiredPanel(config, options.listColumns, options.defaultPageKey, onChange, options.onFieldsChanged, document)
    );
  }

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
  const postActions = ((config as { postActions?: Record<string, unknown> }).postActions ??= {}) as Record<string, PostActionEntry>;
  container.appendChild(renderPostActionPhases(postActions, onChange, document, options.scriptActionNames ?? []));

  return container;
}

// --- "missing required columns" panel --------------------------------------

/**
 * Lists the target list's required, writable columns that no field binds
 * to yet (see columnMapping.missingRequiredColumns) and gives one-click
 * "Add field" / "Add all" buttons that drop in a correctly-shaped
 * `source: "sharepoint"` field via `fieldConfigForColumn`. Self-renders
 * when it has nothing to show (so it's invisible once the form is
 * complete), and re-checks after each add.
 */
function renderMissingRequiredPanel(
  config: FormConfig | FormConfigOverlay,
  listColumns: GraphListColumn[],
  defaultPageKey: string | undefined,
  onChange: ChangeHandler,
  onFieldsChanged: (() => void) | undefined,
  document: Document
): HTMLElement {
  const box = document.createElement("div");
  box.className = "skye-builder__required-warn";

  const addFieldForColumn = (fields: Record<string, unknown>, column: GraphListColumn, taken: Set<string>): void => {
    const key = fieldKeyForColumn(column, taken);
    taken.add(key);
    fields[key] = fieldConfigForColumn(column, defaultPageKey);
  };

  const rerender = (): void => {
    box.replaceChildren();
    const fields = ((config as { fields?: Record<string, unknown> }).fields ??= {}) as Record<string, unknown>;
    const missing = missingRequiredColumns(fields as Record<string, { bindTo?: unknown; source?: unknown }>, listColumns);

    if (missing.length === 0) {
      box.hidden = true;
      return;
    }
    box.hidden = false;

    const msg = document.createElement("p");
    msg.className = "skye-builder__required-warn-msg";
    msg.textContent =
      missing.length === 1
        ? "1 required SharePoint column has no field — the form can't submit without it."
        : `${missing.length} required SharePoint columns have no field — the form can't submit without them.`;
    box.appendChild(msg);

    const list = document.createElement("ul");
    for (const column of missing) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = column.displayName === column.name ? column.name : `${column.displayName} (${column.name})`;
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "Add field";
      addBtn.addEventListener("click", () => {
        addFieldForColumn(fields, column, new Set(Object.keys(fields)));
        onChange();
        (onFieldsChanged ?? rerender)();
      });
      li.append(name, addBtn);
      list.appendChild(li);
    }
    box.appendChild(list);

    if (missing.length > 1) {
      const addAllBtn = document.createElement("button");
      addAllBtn.type = "button";
      addAllBtn.className = "skye-builder__required-addall";
      addAllBtn.textContent = `Add all ${missing.length} fields`;
      addAllBtn.addEventListener("click", () => {
        const taken = new Set(Object.keys(fields));
        for (const column of missing) addFieldForColumn(fields, column, taken);
        onChange();
        (onFieldsChanged ?? rerender)();
      });
      box.appendChild(addAllBtn);
    }
  };

  rerender();
  return box;
}

// --- post actions, grouped by trigger phase ---------------------------------

type PostActionEntry = Record<string, unknown> & { trigger?: string; type?: string; dependsOn?: string[] };

/** The four `trigger` phases, in the order the submit pipeline runs them (submitForm.ts). */
const PHASES: ReadonlyArray<{ key: string; label: string; blurb: string }> = [
  { key: "beforeSubmit", label: "Before submit", blurb: "Runs before the form's list item is written. If one fails, the submission stops and nothing is saved." },
  { key: "afterSubmit", label: "After submit", blurb: "Runs after the item is written. A failure is reported but does not undo the save; onError actions then run." },
  { key: "onSuccess", label: "On success", blurb: "Runs once every After-submit action has finished cleanly — typically a redirect or a confirmation message." },
  { key: "onError", label: "On error", blurb: "Runs if a Before- or After-submit action failed — typically a cleanup step or an alert." },
];
const PHASE_KEYS = new Set(PHASES.map((p) => p.key));

/**
 * Splits the actions in one phase into ordered "waves": wave 0 = no
 * dependency on another action in the same phase (these all start at once);
 * wave N = depends on something in an earlier wave. Same wave ⇒ parallel;
 * different wave ⇒ sequential. Insertion order is preserved within a wave.
 * A dependency cycle (which the config lint flags separately) degrades to
 * wave 0 rather than looping forever.
 */
function computeWaves(phaseKeys: string[], postActions: Record<string, PostActionEntry>): string[][] {
  const inPhase = new Set(phaseKeys);
  const depthCache = new Map<string, number>();
  const visiting = new Set<string>();

  const depth = (key: string): number => {
    if (depthCache.has(key)) return depthCache.get(key)!;
    if (visiting.has(key)) return 0;
    visiting.add(key);
    const deps = (postActions[key]?.dependsOn ?? []).filter((d) => inPhase.has(d) && d !== key);
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depth));
    visiting.delete(key);
    depthCache.set(key, d);
    return d;
  };

  const maxDepth = phaseKeys.reduce((m, k) => Math.max(m, depth(k)), 0);
  const waves: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const key of phaseKeys) waves[depth(key)].push(key);
  return waves;
}

/**
 * The Post Actions editor: one titled section per trigger phase
 * (Before submit / After submit / On success / On error), each showing its
 * actions grouped into sequential "waves" so it's visible at a glance which
 * actions run together and which wait for others. Adding an action inside a
 * section presets its `trigger`; a per-card phase selector moves it between
 * sections. A `script` action's `functionName` and every action's
 * `dependsOn` are pickers over the real available choices, not free text.
 */
function renderPostActionPhases(
  postActions: Record<string, PostActionEntry>,
  onChange: ChangeHandler,
  document: Document,
  scriptActionNames: string[]
): HTMLElement {
  const root = document.createElement("div");
  root.className = "skye-builder__phases";

  // Re-render the whole editor on any STRUCTURAL change (add/remove, phase move, dependsOn toggle,
  // type change) so the wave grouping and the dependsOn checkbox lists stay accurate. Ordinary
  // field edits inside a card just call `onChange` and don't trigger this.
  const rerender = (): void => {
    root.replaceChildren();
    for (const phase of PHASES) root.appendChild(renderPhaseSection(phase));
    const orphanKeys = Object.keys(postActions).filter((k) => !PHASE_KEYS.has(postActions[k]?.trigger ?? ""));
    if (orphanKeys.length > 0) {
      root.appendChild(
        renderPhaseSection(
          { key: "", label: "Not assigned to a phase", blurb: "These actions have no valid `trigger` and will fail validation until one is set below." },
          orphanKeys
        )
      );
    }
  };

  const renderPhaseSection = (phase: { key: string; label: string; blurb: string }, explicitKeys?: string[]): HTMLElement => {
    const section = document.createElement("section");
    section.className = "skye-builder__phase";
    section.dataset.phase = phase.key;

    const h = document.createElement("h4");
    h.textContent = phase.label;
    section.appendChild(h);

    const blurb = document.createElement("p");
    blurb.className = "skye-builder__phase-blurb";
    blurb.textContent = phase.blurb;
    section.appendChild(blurb);

    const phaseKeys = explicitKeys ?? Object.keys(postActions).filter((k) => (postActions[k]?.trigger ?? "") === phase.key);

    if (phaseKeys.length === 0) {
      const none = document.createElement("p");
      none.className = "skye-builder__phase-empty";
      none.textContent = "No actions in this phase.";
      section.appendChild(none);
    } else {
      const waves = computeWaves(phaseKeys, postActions);
      waves.forEach((waveKeys, waveIndex) => {
        if (waveKeys.length === 0) return;
        if (waveIndex > 0) {
          const sep = document.createElement("p");
          sep.className = "skye-builder__wave-sep";
          sep.textContent = "↓ then";
          section.appendChild(sep);
        }
        const wave = document.createElement("div");
        wave.className = "skye-builder__wave";

        const waveLabel = document.createElement("p");
        waveLabel.className = "skye-builder__wave-label";
        waveLabel.textContent =
          waveKeys.length > 1 ? `Step ${waveIndex + 1} — these ${waveKeys.length} actions run at the same time` : `Step ${waveIndex + 1}`;
        wave.appendChild(waveLabel);

        for (const key of waveKeys) wave.appendChild(renderCard(key));
        section.appendChild(wave);
      });
    }

    // "+ Add action" — presets the new entry's trigger to this phase (an orphan section can't add).
    if (phase.key) {
      // Distinct class from the generic `.skye-builder__dict-add` — a card's own body can contain
      // nested dictionary editors (request headers/params, etc.) that use that class, so the
      // phase's "add action" control needs its own hook to be unambiguously selectable.
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
        if (newKey in postActions) {
          errorEl.textContent = "That action key already exists.";
          return;
        }
        postActions[newKey] = { trigger: phase.key };
        keyInput.value = "";
        onChange();
        rerender();
      });
      addRow.append(keyInput, addBtn, errorEl);
      section.appendChild(addRow);
    }

    return section;
  };

  const renderCard = (key: string): HTMLElement => {
    const entry = (postActions[key] ??= {}) as PostActionEntry;

    const card = document.createElement("div");
    card.className = "skye-builder__dict-entry skye-builder__action-card";
    card.dataset.actionKey = key;

    // Heading: key + a "phase mover" + remove.
    const heading = document.createElement("div");
    heading.className = "skye-builder__dict-entry-heading";
    const name = document.createElement("span");
    name.textContent = key;
    heading.appendChild(name);

    const moveLabel = document.createElement("label");
    moveLabel.className = "skye-builder__phase-move";
    moveLabel.append("Phase ");
    const moveSelect = document.createElement("select");
    const knownPhase = PHASE_KEYS.has(entry.trigger ?? "");
    if (!knownPhase) moveSelect.add(new Option("— choose —", ""));
    for (const p of PHASES) moveSelect.add(new Option(p.label, p.key));
    moveSelect.value = knownPhase ? (entry.trigger as string) : "";
    moveSelect.addEventListener("change", () => {
      entry.trigger = moveSelect.value || undefined;
      // Moving phases invalidates any dependsOn that pointed at siblings in the old phase.
      entry.dependsOn = (entry.dependsOn ?? []).filter((d) => (postActions[d]?.trigger ?? "") === entry.trigger);
      if (entry.dependsOn.length === 0) delete entry.dependsOn;
      onChange();
      rerender();
    });
    moveLabel.appendChild(moveSelect);
    heading.appendChild(moveLabel);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      delete postActions[key];
      // Drop this key from any other action's dependsOn.
      for (const other of Object.values(postActions)) {
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

    // Sequencing hint.
    const deps = (entry.dependsOn ?? []).filter((d) => d !== key);
    const seq = document.createElement("p");
    seq.className = "skye-builder__seq";
    if (deps.length > 0) {
      seq.classList.add("skye-builder__seq--after");
      seq.textContent = `Waits for: ${deps.join(", ")}`;
    } else {
      const siblingCount = Object.keys(postActions).filter((k) => k !== key && (postActions[k]?.trigger ?? "") === (entry.trigger ?? "")).length;
      seq.classList.add("skye-builder__seq--parallel");
      seq.textContent = siblingCount > 0 ? "Starts immediately, alongside the other unblocked actions in this phase." : "Starts immediately.";
    }
    card.appendChild(seq);

    // The schema-driven body, rebuilt in place when `type` changes.
    const body = document.createElement("div");
    card.appendChild(body);

    const renderBody = (): void => {
      body.replaceChildren();
      // `trigger` is owned by the section + the phase mover above; `type` and `dependsOn` get smarter
      // controls; everything else is generic.
      const props = getPostActionSchemaProperties(entry.type ?? "").filter((p) => p.key !== "trigger");
      const overrides: PropertyControlOverrides = {
        type: (prop, parent, notify, doc) =>
          renderPropertyControl(prop, parent, () => {
            notify();
            renderBody();
          }, doc),
        dependsOn: renderDependsOnControl(key, postActions, () => {
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

/** `dependsOn` as a checkbox list of the OTHER actions in the same phase, rather than a comma-separated text box. */
function renderDependsOnControl(
  selfKey: string,
  postActions: Record<string, PostActionEntry>,
  notifyStructural: ChangeHandler
): (prop: SchemaProperty, parent: Record<string, unknown>, onChange: ChangeHandler, document: Document) => HTMLElement {
  return (prop, parent, _onChange, document) => {
    const wrap = document.createElement("div");
    wrap.className = "skye-builder__depends";

    const phase = (parent.trigger as string | undefined) ?? "";
    const siblings = Object.keys(postActions).filter((k) => k !== selfKey && (postActions[k]?.trigger ?? "") === phase);
    const description = typeof prop.schema.description === "string" ? (prop.schema.description as string) : undefined;

    if (siblings.length === 0) {
      const none = document.createElement("span");
      none.className = "skye-builder__depends-empty";
      none.textContent = "No other actions in this phase to wait for yet.";
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

/** `functionName` (script actions) as a `<select>` grouped by service, sourced from the app's real registry. */
function renderFunctionNameControl(
  actionNames: string[]
): (prop: SchemaProperty, parent: Record<string, unknown>, onChange: ChangeHandler, document: Document) => HTMLElement {
  return (prop, parent, onChange, document) => {
    const select = document.createElement("select");
    select.add(new Option("— select an action —", ""));

    const byService = new Map<string, string[]>();
    for (const name of actionNames) {
      const service = name.includes(".") ? name.slice(0, name.indexOf(".")) : "other";
      const list = byService.get(service) ?? [];
      list.push(name);
      byService.set(service, list);
    }
    for (const [service, names] of byService) {
      const group = document.createElement("optgroup");
      group.label = service;
      for (const name of names) group.appendChild(new Option(name, name));
      select.appendChild(group);
    }

    const currentValue = parent.functionName as string | undefined;
    if (currentValue && !actionNames.includes(currentValue)) {
      // Don't silently drop a value the current build doesn't register — show it, flagged.
      const group = document.createElement("optgroup");
      group.label = "not registered in this build";
      group.appendChild(new Option(`${currentValue} (unknown)`, currentValue));
      select.appendChild(group);
    }
    select.value = currentValue ?? "";

    select.addEventListener("change", () => {
      parent.functionName = select.value || undefined;
      onChange();
    });

    const description = typeof prop.schema.description === "string" ? (prop.schema.description as string) : undefined;
    return wrapRow("Function name *", description, select, document);
  };
}
