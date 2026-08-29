import { mergeConfig, type FormConfig, type FormConfigOverlay } from "@skye/config";
import { parseCurrentRoute, buildSwitcherRedirectUrl } from "../lib/routing/router.js";
import { createGraphClient } from "../lib/graph/createGraphClient.js";
import { createGraphFetch } from "../lib/graph/rawGraphFetch.js";
import { renderForm } from "../lib/render/renderForm.js";
import { populateChoiceOptionsFromColumns } from "../lib/render/populateChoiceOptions.js";
import { registerElements } from "../elements/registerElements.js";
import { submitForm } from "../lib/submit/submitForm.js";
import { scriptActions } from "../actions/registry.js";
import { canEditFormConfig } from "../lib/builder/permissions.js";
import { customValidators } from "../validation/customValidators.js";
import { showConfirmDialog } from "../lib/ui/confirmDialog.js";

/**
 * Entry point loaded by pages/form.astro. Reads the URL, resolves the
 * Graph client (mock or real per PUBLIC_MOCK_GRAPH), loads + merges the form
 * config, renders it, wires the search-picker events (people/lookup) to
 * the Graph client, and wires the submit button through to submitForm.ts.
 *
 * Every submit attempt — live create/edit AND a draft preview alike —
 * calls `rendered.validateAll()` (renderForm.ts) first and refuses to
 * proceed while any field is invalid; that one shared validation layer
 * (native constraints + this app's registered customValidators, see
 * ../validation/customValidators.ts) is what used to only run for the
 * draft-preview path — see CLAUDE.md's "Form Config Builder" section and
 * TODO §17 for why that gap existed and how it closed. Each field shows
 * its own inline error, revealed only once that field has been
 * interacted with (or once a submit was attempted) — the same "don't
 * flash red on a pristine field" idea as CSS's own `:user-invalid`,
 * applied uniformly across native inputs AND this app's custom elements
 * (which have no native Constraint Validation participation of their
 * own to hook into).
 *
 * Two behaviors layered on top of the normal flow, both from TODO §17:
 *  - `?draft=<id>` (see router.ts's FormRoute.draftId) renders a
 *    `/builder` draft in place of the live base config (real permission
 *    overlays the viewer can see are still merged on top as normal) — for
 *    sharing a beta/testing link without touching the live form. Once
 *    validation passes, submitting a draft preview is ADDITIONALLY gated
 *    behind an explicit "run post-submission actions?" confirm — a live
 *    submission has no such extra gate, since validation passing is
 *    already the only thing standing between it and a real write.
 *  - An "Edit in Builder" link is shown when the signed-in user has
 *    permission to edit this site's form configs (lib/builder/permissions.ts).
 */
async function main() {
  registerElements();

  const appRoot = document.getElementById("skye-app");
  if (!appRoot) throw new Error('entry-form: missing "#skye-app" mount point in the page.');

  const route = parseCurrentRoute();

  if (route.page === "unresolved") {
    // Missing siteId and/or formId — bounce to /switcher rather than a dead end. entry-switcher.ts
    // owns everything about resolving/showing the switcher (including the PUBLIC_DEFAULT_APPLICATION_ID
    // fallback and picking a site vs. a form) — this page just hands off whatever it already knows.
    window.location.assign(buildSwitcherRedirectUrl(route.siteId, route.applicationId, route.tenantId, window.location.hash));
    return;
  }

  const graph = createGraphClient(route.applicationId, route.tenantId);
  const graphFetch = createGraphFetch(route.applicationId, route.tenantId);

  // Kicked off in parallel with the config load below, not awaited until after the form itself
  // renders — this is purely a "should the Edit link show up" check and shouldn't add latency to
  // the thing visitors actually came here for.
  const canEditPromise = canEditFormConfig(graph, route.siteId);

  let base: FormConfig;
  let overlays: FormConfigOverlay[];
  if (route.draftId) {
    base = (await graph.getFormDraft(route.siteId, route.formId, route.draftId)) as FormConfig;
    const configFiles = await graph.getSkyeFormConfigFiles(route.siteId, route.formId);
    overlays = configFiles.filter((f) => f.source !== "base").map((f) => f.config as FormConfigOverlay);
  } else {
    const configFiles = await graph.getSkyeFormConfigFiles(route.siteId, route.formId);
    const baseFile = configFiles.find((f) => f.source === "base")?.config as FormConfig | undefined;
    if (!baseFile) throw new Error(`No base config found for form "${route.formId}".`);
    base = baseFile;
    overlays = configFiles.filter((f) => f.source !== "base").map((f) => f.config as FormConfigOverlay);
  }

  const { config: merged, nullValueErrors } = mergeConfig(base, ...overlays);

  if (nullValueErrors.length > 0) {
    // Overlays are additive-only — a null in one is an authoring error, not a delete. Surface loudly in dev.
    console.error("Config overlay used disallowed null values at:", nullValueErrors);
  }

  // Fill in options for select/radio/checkboxGroup fields bound to a SharePoint Choice column
  // that don't already declare static options — the author only writes bindTo, and the actual
  // allowed values come live from the list's own column schema (see TODO §6/§7).
  const listColumns = await graph.getListColumns(merged.list.siteId ?? route.siteId, merged.list.id);
  populateChoiceOptionsFromColumns(merged.fields, listColumns);

  // `view` mode forces every field readonly regardless of what the config says — an app-level
  // render flag, not a schema concept (see TODO §3).
  if (route.mode === "view") {
    for (const field of Object.values(merged.fields)) field.readonly = true;
  }

  const rendered = renderForm(merged, document, { customValidators });
  appRoot.innerHTML = "";

  if (route.draftId) {
    const banner = document.createElement("div");
    banner.className = "skye-form__draft-banner";
    banner.textContent = `You're previewing a draft ("${route.draftId}") of this form — this is not the live version.`;
    appRoot.appendChild(banner);
  }

  appRoot.appendChild(rendered.root);

  // --- search-picker wiring: peoplePicker/lookupPicker dispatch these events (see elements/registerElements.ts); ---
  // --- this is the one place in the app that actually knows about the Graph client, keeping the elements themselves Graph-agnostic. ---
  rendered.root.addEventListener("skye-people-search", async (e) => {
    const { query } = (e as CustomEvent<{ query: string }>).detail;
    const results = await graph.searchPeople(query);
    (e.target as unknown as { setResults: (r: unknown[]) => void }).setResults(results);
  });

  rendered.root.addEventListener("skye-lookup-search", async (e) => {
    const { query, relatedList } = (e as CustomEvent<{ query: string; relatedList?: { id: string; siteId?: string; displayField: string } }>).detail;
    if (!relatedList) return; // field wasn't configured with a relatedList — nothing to search
    const results = await graph.searchLookupItems(relatedList.siteId ?? route.siteId, relatedList.id, relatedList.displayField, query);
    (e.target as unknown as { setResults: (r: unknown[]) => void }).setResults(results);
  });

  const statusEl = document.createElement("div");
  statusEl.className = "skye-form__status";
  statusEl.setAttribute("role", "status");
  rendered.root.appendChild(statusEl);

  // "Edit in Builder" — only for someone who can actually edit this site's form configs (see
  // lib/builder/permissions.ts). Shown regardless of mode (create/edit/view) since it's always
  // useful as a shortcut, but never for a draft preview — that's already a builder-adjacent view.
  if (!route.draftId) {
    canEditPromise.then((canEdit) => {
      if (!canEdit) return;
      const editLink = document.createElement("a");
      editLink.className = "skye-form__edit-link";
      const params = new URLSearchParams({ siteId: route.siteId, applicationId: route.applicationId });
      if (route.tenantId) params.set("tenantId", route.tenantId);
      editLink.href = `/builder?${params.toString()}#${route.formId}`;
      editLink.textContent = "Edit in Builder";
      rendered.root.insertBefore(editLink, rendered.root.firstChild);
    });
  }

  // view mode has nothing meaningful to submit — hide the button rather than wiring it up.
  if (route.mode === "view") {
    rendered.submitButton.style.display = "none";
    return;
  }

  rendered.submitButton.addEventListener("click", async () => {
    rendered.submitButton.disabled = true;
    statusEl.textContent = "Submitting…";
    statusEl.removeAttribute("data-level");

    try {
      // Every submit attempt validates first, live or draft alike — see this file's own docstring.
      // Field-level errors are shown inline on the fields themselves (renderForm.ts), so this
      // status message is just a pointer, not a duplicate summary.
      if (!rendered.validateAll()) {
        statusEl.textContent = "Please fix the highlighted field(s) below.";
        statusEl.dataset.level = "error";
        return;
      }

      // Draft preview: a real submission only happens if the tester explicitly opts in, on top
      // of validation already having passed above — see this file's own docstring.
      if (route.draftId) {
        const choice = await showConfirmDialog(document, {
          title: "Run post-submission actions?",
          body: "This is a Form Preview. Would you like to save the form submission and run post-submission actions (sending emails and messages, running integrations, etc.) as if it's a live submission?",
          options: [
            { label: "Don't Run Actions", value: "skip" },
            { label: "Run Actions", value: "run", primary: true },
          ],
        });

        if (choice !== "run") {
          statusEl.textContent = "Looks good — validation passed. Nothing was saved and no post-submission actions ran.";
          statusEl.dataset.level = "success";
          return;
        }
      }

      const result = await submitForm({
        config: merged,
        values: rendered.getValues(),
        siteId: route.siteId,
        mode: route.mode === "edit" ? "edit" : "create",
        itemId: route.itemId,
        graph,
        graphFetch,
        callbacks: {
          navigate: (to) => window.location.assign(to),
          showMessage: (message, level) => {
            statusEl.textContent = message;
            statusEl.dataset.level = level;
          },
          setFieldValue: rendered.setFieldValue,
          scriptActions,
        },
      });

      if (result.conflict) {
        // Distinct from a generic failure — see submitForm.ts's EtagConflictError handling.
        statusEl.textContent = "Someone else changed this item since you opened it. Please reload the page and try again.";
        statusEl.dataset.level = "error";
      } else if (!result.success) {
        statusEl.textContent = "Something went wrong submitting this form. Please try again.";
        statusEl.dataset.level = "error";
      } else if (result.fileUploadErrors && Object.keys(result.fileUploadErrors).length > 0) {
        statusEl.textContent = `Submitted, but one or more files didn't upload: ${Object.values(result.fileUploadErrors).join("; ")}`;
        statusEl.dataset.level = "warning";
      } else if (!statusEl.textContent || statusEl.textContent === "Submitting…") {
        // Only show a generic success message if no postAction's showMessage already set something more specific.
        statusEl.textContent = "Submitted successfully.";
        statusEl.dataset.level = "success";
      }
    } finally {
      rendered.submitButton.disabled = false;
    }
  });
}

main().catch((err) => {
  console.error("entry-form failed:", err);
  const appRoot = document.getElementById("skye-app");
  if (appRoot) appRoot.innerHTML = `<p>Something went wrong loading this form. Check the console for details.</p>`;
});
