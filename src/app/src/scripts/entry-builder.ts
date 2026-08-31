import type { FormConfig, FormConfigOverlay } from "@skye/config";
import {
  mergeConfig,
  lintOverlay,
  validateFormConfig,
  validateFormConfigOverlay,
  formatSchemaErrors,
  computeConfigDiff,
  classifySchemaProperty,
  getFieldSchemaProperties,
} from "@skye/config";
import { createGraphClient } from "../lib/graph/createGraphClient.js";
import { populateSitePicker, populateFormPicker } from "../lib/routing/siteSwitcher.js";
import { renderBuilderPreview } from "../lib/builder/builderPreview.js";
import { renderFieldEditor } from "../lib/builder/fieldEditor.js";
import { renderFormSettingsEditor } from "../lib/builder/formSettingsEditor.js";
import { renderConfigDiff } from "../lib/builder/configDiffView.js";
import { canEditFormConfig } from "../lib/builder/permissions.js";
import { controlTypeForColumn, fieldConfigForColumn, fieldKeyForColumn } from "../lib/builder/columnMapping.js";
import { scriptActions } from "../actions/registry.js";
import { showConfirmDialog } from "../lib/ui/confirmDialog.js";
import { showMessagePanel } from "../lib/ui/messagePanel.js";
import { showState, el, fillSlot } from "../lib/ui/pageState.js";
import { ensureInvokerCommands } from "../lib/ui/invokers.js";
import { buildDraftPreviewUrl } from "../lib/routing/router.js";
import { customValidators } from "../validation/customValidators.js";
import type { GraphClient, GraphListColumn, SkyeListSummary } from "../lib/graph/types.js";

/**
 * Entry point for pages/builder.astro — a standalone tool for creating and
 * editing skye_data/forms/[id]/form.config.json files (their [permission]
 * overlays, and their drafts) without hand-writing JSON. Flow: (0) confirm
 * the signed-in user is allowed to edit this site's form configs at all —
 * see lib/builder/permissions.ts — before anything else renders; (1) pick
 * a site; (2) pick an existing form or start a new one; (3) the actual
 * builder — a live preview (click a field to edit it) next to a
 * schema-driven property editor, a view switcher (base/overlays/drafts),
 * and a review-before-save diff. The screen markup lives in builder.astro;
 * this script reveals one screen at a time and fills its data-driven
 * parts. See CLAUDE.md for the design rationale and TODO §17 for status.
 */

const CONTROL_TYPES = (() => {
  const controlTypeProp = getFieldSchemaProperties().find((p) => p.key === "controlType")!;
  const kind = classifySchemaProperty(controlTypeProp.schema);
  return kind.kind === "enum" ? (kind.values as string[]) : [];
})();

/** A safe path segment — form ids, permission-overlay names, and draft ids are all interpolated straight into a Graph drive path, so this mirrors view.astro's own viewId validation (see router.ts's parseViewRoute). */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Internal-only key prefix distinguishing a draft entry from a base/overlay one inside the same `views` map — see openBuilder's docstring for why they share one map. */
const DRAFT_PREFIX = "draft:";
const isDraftKey = (key: string): boolean => key.startsWith(DRAFT_PREFIX);
const draftIdFromKey = (key: string): string => key.slice(DRAFT_PREFIX.length);

/** Sentinel <option> value for "the target list isn't in this dropdown — let me type its id". */
const MANUAL_LIST_OPTION = "__manual__";

/** The real list of `script` postAction names this build ships (teams.*, outlook.*, engage.*), for the settings editor's functionName dropdown. */
const SCRIPT_ACTION_NAMES = Object.keys(scriptActions).sort();

interface BuilderState {
  siteId: string;
  formId: string;
  /**
   * Every editable version of this form's config, in one map so the rest
   * of the builder (preview, field/settings editors, diff, save) can treat
   * "which thing am I editing" as a single selection: `"base"` -> the live
   * base FormConfig; any other non-draft key -> a live `[permission]`
   * overlay (FormConfigOverlay); a key starting with `DRAFT_PREFIX` -> a
   * draft, which is structurally a FULL FormConfig like base (not a
   * partial), just stored under `skye_data/forms/[id]/_drafts/` instead of
   * the live tree — see isDraftKey/draftIdFromKey.
   */
  views: Map<string, Record<string, unknown>>;
  /** Deep-cloned snapshot of each view's config as of the last load/save — the "before" side of the review-before-save diff. Updated after every successful save so the next diff is against the new baseline, not the original load. */
  originalSnapshots: Map<string, Record<string, unknown>>;
  selectedView: string;
  selectedFieldKey: string | undefined;
  listColumns: GraphListColumn[];
}

function setStatus(el: HTMLElement, message: string, level?: "info" | "success" | "warning" | "error"): void {
  el.textContent = message;
  if (level) el.dataset.level = level;
  else el.removeAttribute("data-level");
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** The merged, effective config for whichever view is currently selected — what the preview renders and what determines available pages/fields. Base and drafts are shown alone (each is a full FormConfig); a real overlay is shown as base + that one overlay, not every overlay at once, so the preview matches exactly what that permission level would actually see. */
function currentMergedConfig(state: BuilderState): FormConfig {
  if (state.selectedView === "base" || isDraftKey(state.selectedView)) {
    return state.views.get(state.selectedView) as unknown as FormConfig;
  }
  const base = state.views.get("base") as unknown as FormConfig;
  const overlay = state.views.get(state.selectedView) as unknown as FormConfigOverlay;
  return mergeConfig(base, overlay).config;
}

async function main() {
  await ensureInvokerCommands();

  const appRoot = document.getElementById("skye-app");
  if (!appRoot) throw new Error('entry-builder: missing "#skye-app" mount point in the page.');

  const params = new URLSearchParams(window.location.search);
  const applicationId = params.get("applicationId") ?? import.meta.env.PUBLIC_DEFAULT_APPLICATION_ID;
  if (!applicationId) {
    showState(appRoot, "state-config-missing");
    return;
  }
  const tenantId = params.get("tenantId") ?? import.meta.env.PUBLIC_DEFAULT_TENANT_ID ?? undefined;
  const graph = createGraphClient(applicationId, tenantId);

  let siteId = params.get("siteId") ?? undefined;
  const prefillFormId = window.location.hash.replace(/^#/, "") || undefined;

  // --- step 1: pick a site (only if one isn't already known from the URL) ---
  if (!siteId) {
    const sites = await graph.searchSitesWithSkyeData();
    populateSitePicker(showState(appRoot, "step-site-picker"), sites, (site) => {
      siteId = site.siteId;
      window.history.replaceState(
        null,
        "",
        `/builder?applicationId=${encodeURIComponent(applicationId)}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ""}&siteId=${encodeURIComponent(siteId)}`
      );
      void enterSite(appRoot, graph, siteId, applicationId, tenantId, prefillFormId);
    });
    return;
  }

  await enterSite(appRoot, graph, siteId, applicationId, tenantId, prefillFormId);
}

/**
 * The one gate every path into the builder passes through: confirms the
 * signed-in user may edit this site's form configs at all (see
 * lib/builder/permissions.ts) BEFORE showing anything else — a user
 * without access sees the shared message panel, never the form picker or
 * the builder UI itself.
 */
async function enterSite(
  appRoot: HTMLElement,
  graph: GraphClient,
  siteId: string,
  applicationId: string,
  tenantId: string | undefined,
  prefillFormId: string | undefined
): Promise<void> {
  const canEdit = await canEditFormConfig(graph, siteId);
  if (!canEdit) {
    showMessagePanel(
      appRoot,
      "error",
      "You don't have edit permission",
      "You don't have permission to edit form configs on this site. Ask a site admin to add you to the site's builderEditors overlay if you believe this is a mistake."
    );
    return;
  }
  await chooseForm(appRoot, graph, siteId, applicationId, tenantId, prefillFormId);
}

/** Step 2: pick an existing form on this site, or start a new one against a list chosen from this site's lists. */
async function chooseForm(
  appRoot: HTMLElement,
  graph: GraphClient,
  siteId: string,
  applicationId: string,
  tenantId: string | undefined,
  prefillFormId: string | undefined
): Promise<void> {
  // Forms (to list existing) and this site's lists (to populate the new-form list picker) — in parallel.
  const [forms, initialLists] = await Promise.all([
    graph.listSkyeForms(siteId),
    graph.listSiteLists(siteId).catch(() => [] as Awaited<ReturnType<GraphClient["listSiteLists"]>>),
  ]);

  if (prefillFormId && forms.some((f) => f.formId === prefillFormId)) {
    await openBuilder(appRoot, graph, siteId, applicationId, tenantId, prefillFormId, false, undefined);
    return;
  }

  const section = showState(appRoot, "step-form-picker");
  populateFormPicker(section, forms, (form) => void openBuilder(appRoot, graph, siteId, applicationId, tenantId, form.formId, false, undefined));

  // --- "Or start a new form" — markup is slotted into the form-picker screen (builder.astro) ---
  const newFormForm = el<HTMLFormElement>(section, "new-form-form");
  const formIdInput = el<HTMLInputElement>(section, "new-form-id");
  const listSelect = el<HTMLSelectElement>(section, "new-form-list");
  const listIdInput = el<HTMLInputElement>(section, "new-form-manual-id");
  const listSiteIdInput = el<HTMLInputElement>(section, "new-form-site-id");
  const errorEl = el<HTMLElement>(section, "new-form-error");

  // (Re)fill the dropdown from a set of lists — used on first render and whenever the "different
  // site" field changes, so the options always reflect the site the list actually lives on.
  const fillListOptions = (lists: SkyeListSummary[], note?: string): void => {
    listSelect.replaceChildren();
    const placeholder = new Option(lists.length ? "— select a list —" : "— no lists found —", "");
    placeholder.disabled = true;
    placeholder.selected = true;
    listSelect.add(placeholder);
    for (const l of lists) {
      const opt = new Option(l.displayName, l.id);
      if (l.webUrl) opt.title = l.webUrl;
      listSelect.add(opt);
    }
    listSelect.add(new Option("Other — enter a list id manually…", MANUAL_LIST_OPTION));
    listIdInput.hidden = true;
    errorEl.textContent = note ?? "";
  };

  listSelect.addEventListener("change", () => {
    errorEl.textContent = "";
    listIdInput.hidden = listSelect.value !== MANUAL_LIST_OPTION;
    if (!listIdInput.hidden) listIdInput.focus();
  });

  // Typing a different siteId re-enumerates that site's lists into the dropdown.
  let listsSiteId = siteId;
  listSiteIdInput.addEventListener("change", () => {
    const forSite = listSiteIdInput.value.trim() || siteId;
    if (forSite === listsSiteId) return;
    listsSiteId = forSite;
    errorEl.textContent = "Loading that site's lists…";
    void graph
      .listSiteLists(forSite)
      .then((lists) => fillListOptions(lists, lists.length ? undefined : "That site returned no lists (or SKYE can't read them) — use the manual option."))
      .catch(() => fillListOptions([], "Couldn't load lists for that site — use the manual option to enter a list id."));
  });

  newFormForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const formId = formIdInput.value.trim();
    const listId = (listSelect.value === MANUAL_LIST_OPTION ? listIdInput.value.trim() : listSelect.value).trim();
    errorEl.textContent = "";
    if (!SAFE_ID_PATTERN.test(formId)) {
      errorEl.textContent = "Form id must be letters, digits, underscore, or hyphen only.";
      return;
    }
    if (forms.some((f) => f.formId === formId)) {
      errorEl.textContent = "A form with that id already exists on this site.";
      return;
    }
    if (!listId) {
      errorEl.textContent = listSelect.value === MANUAL_LIST_OPTION ? "Enter the target list's id." : "Select a target list.";
      return;
    }
    const listSiteId = listSiteIdInput.value.trim() || undefined;
    void openBuilder(appRoot, graph, siteId, applicationId, tenantId, formId, true, { listId, listSiteId });
  });

  fillListOptions(initialLists);
}

/** Step 3: the actual builder UI, once a form (existing or brand new) is resolved. */
async function openBuilder(
  appRoot: HTMLElement,
  graph: GraphClient,
  siteId: string,
  applicationId: string,
  tenantId: string | undefined,
  formId: string,
  isNew: boolean,
  newFormSeed: { listId: string; listSiteId: string | undefined } | undefined
): Promise<void> {
  const state: BuilderState = {
    siteId,
    formId,
    views: new Map(),
    originalSnapshots: new Map(),
    selectedView: "base",
    selectedFieldKey: undefined,
    listColumns: [],
  };

  if (isNew && newFormSeed) {
    // A minimal but schema-valid skeleton: pages/fields both need >=1 entry to pass schema
    // validation, so we seed one empty starter page immediately — Save will still (correctly)
    // refuse until at least one field exists, with a clear ajv error explaining why.
    state.views.set("base", {
      id: formId,
      title: formId,
      list: { id: newFormSeed.listId, siteId: newFormSeed.listSiteId },
      pages: { main: { title: "Main", order: 1 } },
      fields: {},
    });
  } else {
    const files = await graph.getSkyeFormConfigFiles(siteId, formId);
    for (const file of files) state.views.set(file.source, file.config as Record<string, unknown>);
    if (!state.views.has("base")) throw new Error(`entry-builder: no base config found for form "${formId}".`);
  }

  const drafts = await graph.listFormDrafts(siteId, formId);
  for (const draft of drafts) {
    state.views.set(`${DRAFT_PREFIX}${draft.draftId}`, (await graph.getFormDraft(siteId, formId, draft.draftId)) as Record<string, unknown>);
  }

  for (const [key, config] of state.views) state.originalSnapshots.set(key, deepClone(config));

  const baseList = (state.views.get("base") as unknown as FormConfig).list;
  try {
    state.listColumns = await graph.getListColumns(baseList.siteId ?? siteId, baseList.id);
  } catch (err) {
    console.warn("entry-builder: couldn't load live list columns (bindTo will fall back to free text):", err);
  }

  // Brand-new form: seed a bound, required field for every required list column so it can actually
  // submit from the start. (An existing form gets a "missing required columns" prompt instead —
  // see renderFormSettingsEditor — rather than a silent mutation of what's already saved.)
  if (isNew) {
    const base = state.views.get("base") as unknown as FormConfig;
    const fields = (base.fields ??= {}) as Record<string, unknown>;
    const firstPage = Object.keys(base.pages ?? {})[0];
    const taken = new Set(Object.keys(fields));
    for (const column of state.listColumns.filter((c) => c.required && !c.readOnly)) {
      const key = fieldKeyForColumn(column, taken);
      taken.add(key);
      fields[key] = fieldConfigForColumn(column, firstPage);
    }
  }

  // --- reveal the builder screen and grab its pre-rendered controls (builder.astro) ---
  const screen = showState(appRoot, "screen-builder");
  fillSlot(screen, "form-id", `Editing "${formId}"`);

  const viewSelect = el<HTMLSelectElement>(screen, "view-select");
  const addViewInput = el<HTMLInputElement>(screen, "add-view-input");
  const addViewBtn = el<HTMLButtonElement>(screen, "add-view-btn");
  const addDraftInput = el<HTMLInputElement>(screen, "add-draft-input");
  const addDraftBtn = el<HTMLButtonElement>(screen, "add-draft-btn");
  const copyLinkBtn = el<HTMLButtonElement>(screen, "copy-link-btn");
  const publishBtn = el<HTMLButtonElement>(screen, "publish-btn");
  const saveBtn = el<HTMLButtonElement>(screen, "save-btn");
  const statusEl = el<HTMLElement>(screen, "status");
  const errorList = screen.querySelector<HTMLElement>('[data-slot="errors"]')!;
  const errorRowTpl = screen.querySelector<HTMLTemplateElement>('[data-tpl="error-row"]')!;
  const addFieldTpl = screen.querySelector<HTMLTemplateElement>('[data-tpl="add-field"]')!;
  const previewPane = screen.querySelector<HTMLElement>('[data-slot="preview"]')!;
  const editorPane = screen.querySelector<HTMLElement>('[data-slot="editor"]')!;

  // Holds the LIVE preview instance (not just a snapshot of its page) so refreshPreview can ask
  // it, right before tearing it down, which page the author is CURRENTLY on — a page switch
  // happens entirely inside renderForm's own tab-click handler, with no callback out to this
  // script. Reset to undefined when switching to a different view/draft entirely.
  let currentPreview: ReturnType<typeof renderBuilderPreview> | undefined;

  function refreshViewSelect(): void {
    viewSelect.replaceChildren();
    for (const key of state.views.keys()) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = key === "base" ? "base (everyone)" : isDraftKey(key) ? `🧪 draft: ${draftIdFromKey(key)}` : key;
      viewSelect.appendChild(opt);
    }
    viewSelect.value = state.selectedView;
    const onDraft = isDraftKey(state.selectedView);
    copyLinkBtn.hidden = !onDraft;
    publishBtn.hidden = !onDraft;
  }

  function refreshPreview(): void {
    previewPane.replaceChildren();
    let merged: FormConfig;
    try {
      merged = currentMergedConfig(state);
    } catch (err) {
      previewPane.textContent = `Couldn't render a preview: ${(err as Error).message}`;
      return;
    }
    if (Object.keys(merged.pages ?? {}).length === 0) {
      const hint = document.createElement("p");
      hint.textContent = "This view has no pages yet — add one on the right to start placing fields.";
      previewPane.appendChild(hint);
    }
    const pageToRestore = currentPreview?.getActivePageKey();
    const preview = renderBuilderPreview(merged, document, graph, siteId, selectField, pageToRestore, customValidators);
    currentPreview = preview;
    previewPane.appendChild(preview.root);
  }

  function pageKeysForEditor(): string[] {
    try {
      return Object.keys(currentMergedConfig(state).pages ?? {});
    } catch {
      return [];
    }
  }

  function refreshEditor(): void {
    editorPane.replaceChildren();
    const target = state.views.get(state.selectedView)!;

    if (state.selectedFieldKey) {
      const key = state.selectedFieldKey;
      const targetFields = (target.fields ??= {}) as Record<string, unknown>;

      // Overlay editing seeds from the merged (effective) field the first time this key is
      // touched in THIS view, so the author starts from a full, real field rather than an empty
      // object that would fail schema validation for missing `controlType`.
      if (!(key in targetFields)) {
        const merged = currentMergedConfig(state);
        targetFields[key] = merged.fields[key] ? deepClone(merged.fields[key]) : { controlType: "text" };
      }

      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.textContent = "← Back to form settings";
      backBtn.addEventListener("click", () => {
        state.selectedFieldKey = undefined;
        refreshEditor();
      });
      editorPane.appendChild(backBtn);

      const fieldHeading = document.createElement("h3");
      fieldHeading.textContent = `Field: ${key}`;
      editorPane.appendChild(fieldHeading);

      if (state.selectedView !== "base" && !isDraftKey(state.selectedView)) {
        const note = document.createElement("p");
        note.className = "skye-builder__overlay-note";
        note.textContent = `Editing the "${state.selectedView}" overlay — this is a full override of the field for this permission level. Unrelated views are unaffected.`;
        editorPane.appendChild(note);
      }

      editorPane.appendChild(
        renderFieldEditor(targetFields[key] as never, refreshPreview, document, {
          listColumns: state.listColumns,
          pageKeys: pageKeysForEditor(),
        })
      );

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.textContent = state.selectedView === "base" || isDraftKey(state.selectedView) ? "Delete field" : "Remove this view's override (revert to base)";
      deleteBtn.addEventListener("click", () => {
        delete targetFields[key];
        state.selectedFieldKey = undefined;
        refreshEditor();
        refreshPreview();
      });
      editorPane.appendChild(deleteBtn);
    } else {
      // "Add a field" — static sub-form cloned from the screen's <template data-tpl="add-field">.
      const addFieldSection = addFieldTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
      const sourceSelect = addFieldSection.querySelector<HTMLSelectElement>('[data-el="source"]')!;
      const bindRow = addFieldSection.querySelector<HTMLElement>('[data-el="bind-row"]')!;
      const bindToSelect = addFieldSection.querySelector<HTMLSelectElement>('[data-el="bindTo"]')!;
      const keyInput = addFieldSection.querySelector<HTMLInputElement>('[data-el="key"]')!;
      const typeSelect = addFieldSection.querySelector<HTMLSelectElement>('[data-el="type"]')!;
      const pageSelect = addFieldSection.querySelector<HTMLSelectElement>('[data-el="page"]')!;
      const addBtn = addFieldSection.querySelector<HTMLButtonElement>('[data-el="add"]')!;
      const addErrorEl = addFieldSection.querySelector<HTMLElement>('[data-el="error"]')!;

      for (const t of CONTROL_TYPES) typeSelect.add(new Option(t, t));
      for (const p of pageKeysForEditor()) pageSelect.add(new Option(p, p));

      const columns = state.listColumns;
      const canBind = columns.length > 0;
      bindToSelect.add(new Option("— pick a column —", ""));
      for (const c of columns) bindToSelect.add(new Option(c.displayName === c.name ? c.name : `${c.displayName} (${c.name})`, c.name));
      if (!canBind) {
        // No live column schema loaded — binding isn't possible; drop to Virtual and hide the SP-only controls.
        sourceSelect.value = "virtual";
        (sourceSelect.closest("label") as HTMLElement | null)?.toggleAttribute("hidden", true);
      }

      const syncSourceUI = (): void => {
        bindRow.hidden = sourceSelect.value !== "sharepoint" || !canBind;
      };
      syncSourceUI();
      sourceSelect.addEventListener("change", syncSourceUI);

      // Picking a column auto-selects the matching controlType and, if the key box is still empty, a key.
      bindToSelect.addEventListener("change", () => {
        const column = columns.find((c) => c.name === bindToSelect.value);
        if (!column) return;
        typeSelect.value = controlTypeForColumn(column);
        if (!keyInput.value.trim()) {
          keyInput.value = fieldKeyForColumn(column, new Set(Object.keys((target.fields ?? {}) as Record<string, unknown>)));
        }
      });

      addBtn.addEventListener("click", () => {
        addErrorEl.textContent = "";
        const key = keyInput.value.trim();
        const bindingToColumn = sourceSelect.value === "sharepoint" && canBind;
        const column = bindingToColumn ? columns.find((c) => c.name === bindToSelect.value) : undefined;

        if (bindingToColumn && !column) {
          addErrorEl.textContent = "Pick a SharePoint column to bind to, or switch Source to Virtual.";
          return;
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
          addErrorEl.textContent = "Key must start with a letter and contain only letters, digits, underscore.";
          return;
        }
        const targetFields = (target.fields ??= {}) as Record<string, unknown>;
        if (key in targetFields) {
          addErrorEl.textContent = "That field key already exists in this view.";
          return;
        }

        const page = pageSelect.value || undefined;
        if (column) {
          const field = fieldConfigForColumn(column, page);
          field.controlType = typeSelect.value; // honour a manual override of the auto-picked type
          targetFields[key] = field;
        } else {
          targetFields[key] = { controlType: typeSelect.value, source: "virtual", page };
        }
        state.selectedFieldKey = key;
        refreshEditor();
        refreshPreview();
      });
      editorPane.appendChild(addFieldSection);

      editorPane.appendChild(
        renderFormSettingsEditor(target as unknown as FormConfig, refreshPreview, document, {
          scriptActionNames: SCRIPT_ACTION_NAMES,
          listColumns: state.listColumns,
          defaultPageKey: pageKeysForEditor()[0],
          requiredColumnCheck: state.selectedView === "base" || isDraftKey(state.selectedView),
          onFieldsChanged: () => {
            refreshEditor();
            refreshPreview();
          },
        })
      );
    }
  }

  function selectField(key: string): void {
    state.selectedFieldKey = key;
    refreshEditor();
  }

  viewSelect.addEventListener("change", () => {
    state.selectedView = viewSelect.value;
    state.selectedFieldKey = undefined;
    currentPreview = undefined; // switching views/drafts entirely — start from that view's own first page, not the old one's
    setStatus(statusEl, "");
    errorList.replaceChildren();
    refreshViewSelect();
    refreshEditor();
    refreshPreview();
  });

  addViewBtn.addEventListener("click", () => {
    const name = addViewInput.value.trim();
    if (!SAFE_ID_PATTERN.test(name)) {
      setStatus(statusEl, "Overlay name must be letters, digits, underscore, or hyphen only.", "error");
      return;
    }
    if (state.views.has(name)) {
      setStatus(statusEl, "A view with that name already exists.", "error");
      return;
    }
    state.views.set(name, {});
    state.originalSnapshots.set(name, {});
    addViewInput.value = "";
    switchTo(name);
  });

  addDraftBtn.addEventListener("click", () => {
    const name = addDraftInput.value.trim();
    const key = `${DRAFT_PREFIX}${name}`;
    if (!SAFE_ID_PATTERN.test(name)) {
      setStatus(statusEl, "Draft name must be letters, digits, underscore, or hyphen only.", "error");
      return;
    }
    if (state.views.has(key)) {
      setStatus(statusEl, "A draft with that name already exists.", "error");
      return;
    }
    // Seeded from the current live base — a draft is almost always "start from what's live, then
    // change some things", not a blank slate.
    const seeded = deepClone(state.views.get("base")!);
    state.views.set(key, seeded);
    state.originalSnapshots.set(key, {}); // diffed against {} — everything in the seed shows as "added" the first time, which is accurate: nothing has been SAVED as this draft yet
    addDraftInput.value = "";
    switchTo(key);
  });

  copyLinkBtn.addEventListener("click", async () => {
    const draftId = draftIdFromKey(state.selectedView);
    const url = new URL(buildDraftPreviewUrl(siteId, applicationId, tenantId, formId, draftId), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setStatus(statusEl, `Preview link copied: ${url}`, "success");
    } catch {
      setStatus(statusEl, `Preview link (copy manually, clipboard access unavailable): ${url}`, "info");
    }
  });

  publishBtn.addEventListener("click", async () => {
    const draftId = draftIdFromKey(state.selectedView);
    const confirmed = await showConfirmDialog(document, {
      title: "Publish this draft?",
      body: `This replaces the live "base" config for "${formId}" with the current contents of the "${draftId}" draft. The draft itself is left in place afterward — you can keep editing or re-publish it later.`,
      options: [
        { label: "Cancel", value: "cancel" },
        { label: "Publish", value: "publish", primary: true },
      ],
    });
    if (confirmed !== "publish") return;

    saveBtn.disabled = true;
    setStatus(statusEl, "Publishing…");
    try {
      await graph.publishFormDraft(siteId, formId, draftId);
      const draftConfig = state.views.get(state.selectedView)!;
      state.views.set("base", deepClone(draftConfig));
      state.originalSnapshots.set("base", deepClone(draftConfig));
      setStatus(statusEl, `Published "${draftId}" as the live base.`, "success");
    } catch (err) {
      setStatus(statusEl, `Publish failed: ${(err as Error).message}`, "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  saveBtn.addEventListener("click", () => void handleSave());

  async function handleSave(): Promise<void> {
    errorList.replaceChildren();
    const target = state.views.get(state.selectedView)!;
    const isBaseOrDraft = state.selectedView === "base" || isDraftKey(state.selectedView);

    if (isBaseOrDraft) {
      const result = validateFormConfig(target);
      if (!result.valid) {
        setStatus(statusEl, "This view has schema errors — fix them before saving.", "error");
        for (const line of formatSchemaErrors(result.errors)) appendError(line);
        return;
      }
    } else {
      const result = validateFormConfigOverlay(target);
      if (!result.valid) {
        setStatus(statusEl, "This overlay has schema errors — fix them before saving.", "error");
        for (const line of formatSchemaErrors(result.errors)) appendError(line);
        return;
      }
      const base = state.views.get("base") as unknown as FormConfig;
      const lintIssues = lintOverlay(base, target as FormConfigOverlay);
      const errors = lintIssues.filter((i) => i.severity === "error");
      if (errors.length > 0) {
        setStatus(statusEl, "This overlay isn't additive-only — fix these before saving.", "error");
        for (const issue of errors) appendError(`[${issue.path}] ${issue.message}`);
        return;
      }
      for (const issue of lintIssues.filter((i) => i.severity === "warning")) {
        appendWarning(`[${issue.path}] ${issue.message}`);
      }
    }

    const before = state.originalSnapshots.get(state.selectedView) ?? {};
    const diff = computeConfigDiff(before, target);
    if (diff.isEmpty) {
      setStatus(statusEl, "No changes to save.", "info");
      return;
    }

    const diffEl = renderConfigDiff(diff, document);
    const confirmed = await showConfirmDialog(document, {
      title: `Review changes to "${state.selectedView}"`,
      body: diffEl,
      options: [
        { label: "Cancel", value: "cancel" },
        { label: "Confirm & Save", value: "save", primary: true },
      ],
    });
    if (confirmed !== "save") return;

    saveBtn.disabled = true;
    setStatus(statusEl, "Saving…");
    try {
      if (isDraftKey(state.selectedView)) {
        await graph.saveFormDraft(siteId, formId, draftIdFromKey(state.selectedView), target);
      } else {
        await graph.saveSkyeFormConfigFile(siteId, formId, state.selectedView, target);
      }
      state.originalSnapshots.set(state.selectedView, deepClone(target));
      setStatus(statusEl, `Saved "${state.selectedView}".`, "success");
    } catch (err) {
      setStatus(statusEl, `Save failed: ${(err as Error).message}`, "error");
    } finally {
      saveBtn.disabled = false;
    }
  }

  function appendError(text: string): void {
    const li = errorRowTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
    li.textContent = text;
    errorList.appendChild(li);
  }
  function appendWarning(text: string): void {
    const li = errorRowTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
    li.className = "skye-builder__warning";
    li.textContent = text;
    errorList.appendChild(li);
  }

  function switchTo(key: string): void {
    state.selectedView = key;
    state.selectedFieldKey = undefined;
    currentPreview = undefined;
    refreshViewSelect();
    refreshEditor();
    refreshPreview();
  }

  refreshViewSelect();
  refreshEditor();
  refreshPreview();
}

main().catch((err) => {
  console.error("entry-builder failed:", err);
  const appRoot = document.getElementById("skye-app");
  if (!appRoot) return;
  try {
    showState(appRoot, "state-error");
  } catch {
    appRoot.textContent = "Something went wrong loading the builder. Check the console for details.";
  }
});
