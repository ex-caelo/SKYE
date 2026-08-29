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
import { renderSiteSwitcher, renderFormPicker } from "../lib/routing/siteSwitcher.js";
import { renderBuilderPreview } from "../lib/builder/builderPreview.js";
import { renderFieldEditor } from "../lib/builder/fieldEditor.js";
import { renderFormSettingsEditor } from "../lib/builder/formSettingsEditor.js";
import { renderConfigDiff } from "../lib/builder/configDiffView.js";
import { canEditFormConfig } from "../lib/builder/permissions.js";
import { showConfirmDialog } from "../lib/ui/confirmDialog.js";
import { renderMessagePanel } from "../lib/ui/messagePanel.js";
import { buildDraftPreviewUrl } from "../lib/routing/router.js";
import { customValidators } from "../validation/customValidators.js";
import type { GraphClient, GraphListColumn } from "../lib/graph/types.js";

/**
 * Entry point for pages/builder.astro — a standalone tool for creating and
 * editing skye_data/forms/[id]/form.config.json files (their [permission]
 * overlays, and their drafts) without hand-writing JSON. Flow: (0) confirm
 * the signed-in user is allowed to edit this site's form configs at all —
 * see lib/builder/permissions.ts — before anything else renders; (1) pick
 * a site; (2) pick an existing form or start a new one; (3) the actual
 * builder — a live preview (click a field to edit it) next to a
 * schema-driven property editor, a view switcher (base/overlays/drafts),
 * and a review-before-save diff. See CLAUDE.md for the design rationale
 * and TODO §17 for status/known gaps.
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
  const appRoot = document.getElementById("skye-app");
  if (!appRoot) throw new Error('entry-builder: missing "#skye-app" mount point in the page.');

  const params = new URLSearchParams(window.location.search);
  const applicationId = params.get("applicationId") ?? import.meta.env.PUBLIC_DEFAULT_APPLICATION_ID;
  if (!applicationId) {
    appRoot.innerHTML = `<p>Couldn't open the builder: no application is configured. Set PUBLIC_DEFAULT_APPLICATION_ID or include ?applicationId= in the URL.</p>`;
    return;
  }
  const tenantId = params.get("tenantId") ?? import.meta.env.PUBLIC_DEFAULT_TENANT_ID ?? undefined;
  const graph = createGraphClient(applicationId, tenantId);

  let siteId = params.get("siteId") ?? undefined;
  const prefillFormId = window.location.hash.replace(/^#/, "") || undefined;

  // --- step 1: pick a site (only if one isn't already known from the URL) ---
  if (!siteId) {
    const sites = await graph.searchSitesWithSkyeData();
    appRoot.innerHTML = "";
    appRoot.appendChild(
      renderSiteSwitcher(
        sites,
        (site) => {
          siteId = site.siteId;
          window.history.replaceState(null, "", `/builder?applicationId=${encodeURIComponent(applicationId)}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ""}&siteId=${encodeURIComponent(siteId)}`);
          void enterSite(appRoot, graph, siteId, applicationId, tenantId, prefillFormId);
        },
        document
      )
    );
    return;
  }

  await enterSite(appRoot, graph, siteId, applicationId, tenantId, prefillFormId);
}

/**
 * The one gate every path into the builder passes through: confirms the
 * signed-in user may edit this site's form configs at all (see
 * lib/builder/permissions.ts) BEFORE showing anything else — a user
 * without access sees a plain permission-denied panel, never the form
 * picker or the builder UI itself, matching the explicit requirement that
 * this is an access gate, not just a late Save-time failure.
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
    appRoot.innerHTML = "";
    appRoot.appendChild(
      renderMessagePanel(
        "error",
        "You don't have edit permission",
        "You don't have permission to edit form configs on this site. Ask a site admin to add you to the site's builderEditors overlay if you believe this is a mistake.",
        document
      )
    );
    return;
  }
  await chooseForm(appRoot, graph, siteId, applicationId, tenantId, prefillFormId);
}

/** Step 2: pick an existing form on this site, or start a new one from a hand-entered list id. */
async function chooseForm(
  appRoot: HTMLElement,
  graph: GraphClient,
  siteId: string,
  applicationId: string,
  tenantId: string | undefined,
  prefillFormId: string | undefined
): Promise<void> {
  const forms = await graph.listSkyeForms(siteId);

  if (prefillFormId && forms.some((f) => f.formId === prefillFormId)) {
    await openBuilder(appRoot, graph, siteId, applicationId, tenantId, prefillFormId, false, undefined);
    return;
  }

  appRoot.innerHTML = "";
  const container = document.createElement("div");
  appRoot.appendChild(container);
  container.appendChild(
    renderFormPicker(forms, (form) => void openBuilder(appRoot, graph, siteId, applicationId, tenantId, form.formId, false, undefined), document)
  );

  const newFormSection = document.createElement("div");
  newFormSection.className = "skye-builder__new-form";
  const heading = document.createElement("h2");
  heading.textContent = "Or start a new form";
  newFormSection.appendChild(heading);

  const formIdInput = document.createElement("input");
  formIdInput.type = "text";
  formIdInput.placeholder = "new form id (e.g. event-signup)";
  const listIdInput = document.createElement("input");
  listIdInput.type = "text";
  listIdInput.placeholder = "target SharePoint list id (GUID)";
  const listSiteIdInput = document.createElement("input");
  listSiteIdInput.type = "text";
  listSiteIdInput.placeholder = "list's siteId, if different from this site (optional)";
  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.textContent = "Create";
  const errorEl = document.createElement("span");
  errorEl.className = "skye-builder__new-form-error";

  createBtn.addEventListener("click", () => {
    const formId = formIdInput.value.trim();
    const listId = listIdInput.value.trim();
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
      errorEl.textContent = "A target list id is required.";
      return;
    }
    const listSiteId = listSiteIdInput.value.trim() || undefined;
    void openBuilder(appRoot, graph, siteId, applicationId, tenantId, formId, true, { listId, listSiteId });
  });

  newFormSection.append(formIdInput, listIdInput, listSiteIdInput, createBtn, errorEl);
  container.appendChild(newFormSection);
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

  appRoot.innerHTML = "";

  // --- top bar: view switcher, drafts, save, status ---
  const topBar = document.createElement("div");
  topBar.className = "skye-builder__topbar";
  appRoot.appendChild(topBar);

  const heading = document.createElement("h1");
  heading.textContent = `Editing "${formId}"`;
  topBar.appendChild(heading);

  const viewSelect = document.createElement("select");
  topBar.appendChild(viewSelect);

  const addViewInput = document.createElement("input");
  addViewInput.type = "text";
  addViewInput.placeholder = "new permission overlay name";
  const addViewBtn = document.createElement("button");
  addViewBtn.type = "button";
  addViewBtn.textContent = "+ Add view";
  topBar.append(addViewInput, addViewBtn);

  const addDraftInput = document.createElement("input");
  addDraftInput.type = "text";
  addDraftInput.placeholder = "new draft name";
  const addDraftBtn = document.createElement("button");
  addDraftBtn.type = "button";
  addDraftBtn.textContent = "+ New draft";
  topBar.append(addDraftInput, addDraftBtn);

  const copyLinkBtn = document.createElement("button");
  copyLinkBtn.type = "button";
  copyLinkBtn.textContent = "Copy preview link";
  copyLinkBtn.style.display = "none"; // only shown while a draft is selected
  topBar.appendChild(copyLinkBtn);

  const publishBtn = document.createElement("button");
  publishBtn.type = "button";
  publishBtn.textContent = "Publish this draft → becomes base";
  publishBtn.style.display = "none"; // only shown while a draft is selected
  topBar.appendChild(publishBtn);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "skye-builder__save";
  saveBtn.textContent = "Save this view";
  topBar.appendChild(saveBtn);

  const statusEl = document.createElement("div");
  statusEl.className = "skye-form__status";
  statusEl.setAttribute("role", "status");
  topBar.appendChild(statusEl);

  const errorList = document.createElement("ul");
  errorList.className = "skye-builder__errors";
  topBar.appendChild(errorList);

  // --- main split: preview | editor ---
  const splitEl = document.createElement("div");
  splitEl.className = "skye-builder__split";
  appRoot.appendChild(splitEl);

  const previewPane = document.createElement("div");
  previewPane.className = "skye-builder__preview-pane";
  const editorPane = document.createElement("div");
  editorPane.className = "skye-builder__editor-pane";
  splitEl.append(previewPane, editorPane);

  // Holds the LIVE preview instance (not just a snapshot of its page) so refreshPreview can ask
  // it, right before tearing it down, which page the author is CURRENTLY on — a page switch
  // happens entirely inside renderForm's own tab-click handler, with no callback out to this
  // script, so a plain "remember the page after each render" variable would only ever reflect
  // where the preview STARTED, not wherever the author has since clicked to. Reading
  // getActivePageKey() live from the outgoing instance is what actually gets this right.
  // Reset to undefined when switching to a different view/draft entirely (see switchTo/the view
  // select's change handler) so the NEW view starts from its own first page rather than
  // whatever page happened to be active in the view being left.
  let currentPreview: ReturnType<typeof renderBuilderPreview> | undefined;

  function refreshViewSelect(): void {
    viewSelect.innerHTML = "";
    for (const key of state.views.keys()) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = key === "base" ? "base (everyone)" : isDraftKey(key) ? `🧪 draft: ${draftIdFromKey(key)}` : key;
      viewSelect.appendChild(opt);
    }
    viewSelect.value = state.selectedView;
    const onDraft = isDraftKey(state.selectedView);
    copyLinkBtn.style.display = onDraft ? "" : "none";
    publishBtn.style.display = onDraft ? "" : "none";
  }

  function refreshPreview(): void {
    previewPane.innerHTML = "";
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
    // Restores whichever page the author is CURRENTLY on in the outgoing preview (see
    // renderForm.ts's initialPageKey) — without this, every keystroke in the editor would
    // silently bounce the preview back to its first page.
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
    editorPane.innerHTML = "";
    const target = state.views.get(state.selectedView)!;

    if (state.selectedFieldKey) {
      const key = state.selectedFieldKey;
      const targetFields = (target.fields ??= {}) as Record<string, unknown>;

      // Overlay editing seeds from the merged (effective) field the first time this key is
      // touched in THIS view, so the author starts from a full, real field (matching how the
      // real overlay fixtures in this repo are authored) rather than an empty object that would
      // fail schema validation for missing `controlType`. Drafts are full configs, same as base,
      // so this only actually applies to a real overlay view.
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
      const addFieldSection = document.createElement("div");
      addFieldSection.className = "skye-builder__add-field";
      const keyInput = document.createElement("input");
      keyInput.type = "text";
      keyInput.placeholder = "new field key";
      const typeSelect = document.createElement("select");
      for (const t of CONTROL_TYPES) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        typeSelect.appendChild(opt);
      }
      const pageKeys = pageKeysForEditor();
      const pageSelect = document.createElement("select");
      for (const p of pageKeys) {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        pageSelect.appendChild(opt);
      }
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "+ Add field";
      const addErrorEl = document.createElement("span");
      addBtn.addEventListener("click", () => {
        const key = keyInput.value.trim();
        addErrorEl.textContent = "";
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
          addErrorEl.textContent = "Key must start with a letter and contain only letters, digits, underscore.";
          return;
        }
        const targetFields = (target.fields ??= {}) as Record<string, unknown>;
        if (key in targetFields) {
          addErrorEl.textContent = "That field key already exists in this view.";
          return;
        }
        targetFields[key] = { controlType: typeSelect.value, page: pageSelect.value || undefined };
        state.selectedFieldKey = key;
        refreshEditor();
        refreshPreview();
      });
      addFieldSection.append(keyInput, typeSelect, pageSelect, addBtn, addErrorEl);
      editorPane.appendChild(addFieldSection);

      editorPane.appendChild(renderFormSettingsEditor(target as unknown as FormConfig, refreshPreview, document));
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
    errorList.innerHTML = "";
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
    errorList.innerHTML = "";
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
    const li = document.createElement("li");
    li.textContent = text;
    errorList.appendChild(li);
  }
  function appendWarning(text: string): void {
    const li = document.createElement("li");
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
  if (appRoot) appRoot.innerHTML = `<p>Something went wrong loading the builder. Check the console for details.</p>`;
});
