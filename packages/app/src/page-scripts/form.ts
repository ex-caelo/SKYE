import { mergeConfig, interpolate, type FormConfig, type FormConfigOverlay, type TemplateContext } from "@skye/form-config";
import { parseCurrentRoute, buildSwitcherRedirectUrl, buildFormUrl, buildDraftPreviewUrl, buildViewUrl } from "../shared/routing.js";
import { createGraphClient } from "../shared/sharepoint/createGraphClient.js";
import { createGraphFetch } from "../shared/sharepoint/rawGraphFetch.js";
import { renderForm } from "../features/form/render/renderForm.js";
import { fileNameFromUrl, looksLikeImageUrl } from "../features/form/render/fileUploadZone.js";
import { mapSharePointFieldsToValues, selectColumnsForEditPrefill } from "../features/form/submit/mapSharePointFieldsToValues.js";
import { backfillPersonEmails } from "../features/form/submit/backfillPersonEmails.js";
import { populateChoiceOptionsFromColumns } from "../features/form/render/populateChoiceOptions.js";
import { backfillFieldLabels } from "../features/form/render/fieldLabels.js";
import { registerElements } from "../features/form/registerElements.js";
import { submitForm } from "../features/form/submit/submitForm.js";
import { runButtonActions } from "../features/form/submit/runButtonActions.js";
import { checkPersonFieldsResolve } from "../features/form/submit/checkPersonFields.js";
import { scriptActions } from "../integrations/registry.js";
import { canEditFormConfig } from "../features/builder/permissions.js";
import { completeRedirectReturn } from "../shared/auth/redirectReturn.js";
import { customValidators } from "../features/form/customValidatorRegistry.js";
import { showConfirmDialog } from "../shared/ui/confirmDialog.js";
import { showState, fillSlot, el } from "../shared/ui/pageState.js";
import { ensureInvokerCommands } from "../shared/ui/invokers.js";

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
  // This page has no client-side router — every route (a different formId/itemId/mode) is meant
  // to be its own full script execution (see CLAUDE.md's draft/publish section). But the route
  // lives entirely in the URL *hash* (siteId/applicationId/tenantId are the query string, which
  // rarely changes), and a browser does NOT reload/re-run a page's scripts when only the fragment
  // changes — clicking an in-page link to a different formId/itemId (e.g. this file's own
  // "Fill out another response"/"View submitted response" splash links, or a redirect postAction
  // targeting another item) would otherwise silently do nothing. Force a real navigation so a
  // hash-only change behaves like any other route change here.
  window.addEventListener("hashchange", () => window.location.reload());

  // Landing back from an MSAL loginRedirect? Finish it and return to the pre-redirect URL
  // (which still carries siteId/applicationId/tenantId + the formId hash) first.
  if (await completeRedirectReturn()) return;

  await ensureInvokerCommands();
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

  // Tenant precedence: URL → PUBLIC_DEFAULT_TENANT_ID. (A tenant id this browser cached from a
  // previous sign-in was already recovered into route.tenantId, with the address bar backfilled
  // to match, by parseCurrentRoute() above — see tenantResolver.ts's resolveApplicationAndTenantId.)
  // If still none, auth falls back to /common and (for a single-tenant app registration)
  // self-heals via tenant discovery — see lib/auth/tenantResolver.ts.
  const tenantId = route.tenantId ?? import.meta.env.PUBLIC_DEFAULT_TENANT_ID;
  const graph = createGraphClient(route.applicationId, tenantId);
  const graphFetch = createGraphFetch(route.applicationId, tenantId);

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
  document.title = `SKYE: ${merged.title ?? route.formId}`;

  if (nullValueErrors.length > 0) {
    // Overlays are additive-only — a null in one is an authoring error, not a delete. Surface loudly in dev.
    console.error("Config overlay used disallowed null values at:", nullValueErrors);
  }

  // Fill in options for select/radio/checkboxGroup fields bound to a SharePoint Choice column
  // that don't already declare static options — the author only writes bindTo, and the actual
  // allowed values come live from the list's own column schema (see TODO §6/§7).
  const listColumns = await graph.getListColumns(merged.list.siteId ?? route.siteId, merged.list.id);
  populateChoiceOptionsFromColumns(merged.fields, listColumns);

  // Same idea for a lookupTable's own columns: a `select`/`radio`/`checkboxGroup` column bound to
  // a Choice column on the RELATED list needs its options from that list's schema, not this one's.
  // (populateChoiceOptionsFromColumns above only sees the primary list.) Fetched per distinct
  // related list, in parallel, and skipped entirely if every such column already has static options.
  await Promise.all(
    Object.values(merged.fields)
      .filter((f) => f.controlType === "lookupTable" && f.table?.relatedList?.id)
      .map(async (f) => {
        const rl = f.table!.relatedList;
        const needsLiveChoices = Object.values(f.table!.columns).some(
          (c) => ["select", "radio", "checkboxGroup"].includes(c.controlType) && c.source === "sharepoint" && !c.options,
        );
        if (!needsLiveChoices) return;
        try {
          const relatedColumns = await graph.getListColumns(rl.siteId ?? merged.list.siteId ?? route.siteId, rl.id);
          populateChoiceOptionsFromColumns(f.table!.columns as typeof merged.fields, relatedColumns);
        } catch (err) {
          console.warn(`entry-form: couldn't load choice options for lookupTable "${f.label ?? ""}" from related list ${rl.id}.`, err);
        }
      }),
  );

  // Guarantee every input field renders with a meaningful <label>: fill any missing `label` from
  // the bound column's displayName (or a humanised field key). renderField.ts still applies its
  // own humanised fallback, so a field with no bound column is covered too.
  backfillFieldLabels(merged.fields, listColumns);

  // `view` mode forces every field readonly regardless of what the config says — an app-level
  // render flag, not a schema concept (see TODO §3). Excludes controlType "button" (readonly
  // protects a VALUE from being changed, which a button doesn't have — a button's whole point
  // can be a "quick action" a viewer takes without switching to edit mode, e.g. an approver
  // clicking "Approve" while just viewing an item) and any field explicitly marked
  // `alwaysEditable` (a value that exists only to feed a button's own `actions` on click, e.g.
  // a reviewer typing the host's email as part of approving — genuinely needs to be typed INTO
  // while the rest of the record stays view-only, not something view mode should lock).
  if (route.mode === "view") {
    for (const field of Object.values(merged.fields)) {
      if (field.controlType !== "button" && !field.alwaysEditable) field.readonly = true;
    }
  }

  // Edit / view mode: load the existing item and seed the form with its saved values so the
  // user edits real data rather than a blank form (which would also make every required field
  // fail validation on the admin approval flow). A load failure falls through to a blank form
  // rather than dead-ending — the error is logged for diagnosis.
  let initialValues: Record<string, unknown> | undefined;
  let editEtag: string | undefined;
  // The item's raw SharePoint fields (real column names, e.g. Title/StartTime — NOT the form's
  // field keys), kept around so a button field's action chain can offer the exact same
  // `{{item.x}}` templating convention submitForm.ts's postActions already use, not a second,
  // field-key-based one. Undefined in create mode (no item exists yet) or if the load failed.
  let loadedItemFields: Record<string, unknown> | undefined;
  // controlType "file" fields only — see RenderFormOptions.filePreviews. Never overwrites
  // initialValues[key] itself, which stays the real saved URL so an unmodified submit re-sends
  // that instead of a worthless local blob: one, and so submitForm.ts's `instanceof File` check
  // (deciding whether this field needs a fresh upload) is unaffected either way.
  const filePreviews: Record<string, { url: string; name: string }> = {};
  if ((route.mode === "edit" || route.mode === "view") && route.itemId) {
    try {
      const item = await graph.getListItem(merged.list.siteId ?? route.siteId, merged.list.id, route.itemId, selectColumnsForEditPrefill(merged.fields));
      // A peoplePicker's SharePoint Person column can carry a BLANK cached Email (a real, common
      // SharePoint quirk — filled in only once that person has actually visited SharePoint), in
      // which case the field's value falls back to its SharePoint-internal LookupId — meaningless
      // to anything expecting a real Microsoft Graph user identifier (e.g. a button action binding
      // this field into a Teams chat's memberUserIds). Backfill a real email via an extra,
      // best-effort Graph lookup before this value reaches anything downstream. Kept as a local
      // const (not reassigning `initialValues` directly) because TS can't narrow an outer `let`
      // as still-defined across an `await` — using this for the rest of this block's synchronous
      // work keeps every later `initialValues[...]` access below from needing a non-null assertion.
      const seeded = await backfillPersonEmails(merged.fields, mapSharePointFieldsToValues(merged.fields, item.fields), (lookupId) =>
        graph.resolveSiteUserEmail(merged.list.siteId ?? route.siteId, lookupId)
      );
      initialValues = seeded;
      editEtag = item.etag;
      loadedItemFields = item.fields;

      // A file field's saved value is a raw SharePoint webUrl — setting that directly as an <img
      // src> 401s (it needs the site's own browser session, which this app doesn't have) and
      // would still hit CORS even when authenticated (SharePoint doesn't send
      // Access-Control-Allow-Origin for this app's origin). Fetch the actual bytes through Graph
      // instead (an authenticated, CORS-enabled API this app already has a token for) and build a
      // blob URL the browser can render directly — captured into filePreviews, not
      // initialValues. Best-effort per field, inside the try above's scope but with its own catch
      // — one field's image failing to load shouldn't blank the rest of an otherwise successfully
      // loaded form.
      for (const [fieldKey, field] of Object.entries(merged.fields)) {
        if (field.controlType !== "file" || field.source !== "sharepoint" || !field.bindTo) continue;
        const value = seeded[fieldKey];
        if (typeof value !== "string" || !value || !looksLikeImageUrl(value)) continue;
        try {
          const { contentType, bytes } = await graph.getListItemImage(merged.list.siteId ?? route.siteId, merged.list.id, route.itemId, field.bindTo);
          // TS's DOM lib types a Uint8Array's `.buffer` as ArrayBufferLike (which also covers
          // SharedArrayBuffer), narrower than BlobPart's real, broader runtime acceptance of any
          // typed array — the cast reflects a real TS/DOM-lib type gap, not an unsafe runtime one.
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
          filePreviews[fieldKey] = { url, name: fileNameFromUrl(value) };
        } catch (err) {
          console.warn(`entry-form: couldn't load the saved preview image for field "${fieldKey}" — its raw URL will be shown instead (and will likely fail to load).`, err);
        }
      }

      // A lookupTable's own rows live on a DIFFERENT list (its related list), keyed back to this
      // item via `parentReferenceColumn` — they were never part of `item.fields` above, so
      // there's never been anything to seed `initialValues[fieldKey]` with for one. Fetch them
      // now: every related-list item whose parent-reference lookup points at this item, mapped
      // through the same field-keyed shape submitForm.ts's own row writer expects back
      // (LookupTableRow[]). Only "parentReference" linkMode has rows to fetch this way —
      // "lookupColumn" mode's relationship lives on THIS item's own lookup column, already part
      // of `item.fields`/`initialValues` from the read above. Best-effort per field, same as the
      // image-preview loop above.
      for (const [fieldKey, field] of Object.entries(merged.fields)) {
        const table = field.table;
        if (field.controlType !== "lookupTable" || !table || table.linkMode !== "parentReference" || !table.parentReferenceColumn) continue;
        try {
          const relatedSiteId = table.relatedList.siteId ?? route.siteId;
          const lookupIdField = `${table.parentReferenceColumn}LookupId`;
          const page = await graph.searchListItems(relatedSiteId, table.relatedList.id, {
            filter: `fields/${lookupIdField} eq ${route.itemId}`,
            select: selectColumnsForEditPrefill(table.columns),
            top: 200,
          });
          seeded[fieldKey] = page.items.map((relatedItem) => ({
            id: relatedItem.id,
            values: mapSharePointFieldsToValues(table.columns, relatedItem.fields),
          }));
        } catch (err) {
          console.warn(`entry-form: couldn't load existing rows for lookupTable "${fieldKey}" — it will start empty.`, err);
        }
      }
    } catch (err) {
      console.error(`entry-form: couldn't load item "${route.itemId}" for ${route.mode} mode — showing a blank form.`, err);
    }
  }

  // Same {{item.x}} shape submitForm.ts's own postActions already give (real SharePoint column
  // names, id first) — {} in create mode, where there's genuinely no item yet.
  const itemForTemplates: Record<string, unknown> = route.itemId ? { id: route.itemId, ...loadedItemFields } : {};

  // A field default that contains {{...}} placeholders (e.g. "{{currentUser.email}}", or a list that
  // includes "{{fields.host}}") can't be rendered as-is: it needs the viewer's identity and/or other
  // fields' loaded values first. Pulled out here so renderForm never shows the raw placeholder text,
  // then resolved against the rendered form below.
  const templatedDefaults: Record<string, unknown> = {};
  for (const [fieldKey, field] of Object.entries(merged.fields)) {
    if (field.defaultValue !== undefined && JSON.stringify(field.defaultValue).includes("{{")) {
      templatedDefaults[fieldKey] = field.defaultValue;
      delete field.defaultValue;
    }
  }

  const rendered = renderForm(merged, document, { customValidators, initialValues, filePreviews });

  if (Object.keys(templatedDefaults).length > 0) {
    // Best-effort: if the viewer's identity can't be read, the placeholder-only defaults just stay empty.
    const currentUser = await graph.getCurrentUser().catch(() => ({} as { email?: string }));
    const loaded = rendered.getValues();
    const ctx: TemplateContext = { fields: loaded, item: itemForTemplates, results: {}, currentUser: { email: currentUser.email } };
    for (const [fieldKey, template] of Object.entries(templatedDefaults)) {
      // A value already seeded from the saved item (edit/view mode) always wins over a default.
      if (loaded[fieldKey] !== undefined && loaded[fieldKey] !== "" && !(Array.isArray(loaded[fieldKey]) && (loaded[fieldKey] as unknown[]).length === 0)) continue;
      const resolved = interpolate(template, ctx);
      if (resolved === "" || resolved === undefined || (Array.isArray(resolved) && resolved.length === 0)) continue;
      rendered.setFieldValue(fieldKey, resolved);
    }
  }

  // The page ships all its states in form.astro; reveal the form screen and fill its slots.
  const screen = showState(appRoot, "screen-form");

  if (route.draftId) {
    const banner = screen.querySelector<HTMLElement>('[data-slot="draft-banner"]')!;
    banner.textContent = `You're previewing a draft ("${route.draftId}") of this form — this is not the live version.`;
    banner.hidden = false;
  }

  screen.querySelector<HTMLElement>('[data-slot="form-mount"]')!.appendChild(rendered.root);

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

  const statusEl = el<HTMLElement>(screen, "status");

  // Replaces the form with the confirmation splash (screen-submitted in form.astro) once a
  // submission has genuinely written an item — never for a validation/conflict/hard-failure
  // branch, which need the form to stay visible so the user can fix and retry. `message`/`level`
  // are whatever the normal status-message logic below already decided (a postAction's own
  // showMessage, or the generic success/warning fallback) — the splash doesn't invent its own
  // wording, it just gives the existing confirmation a permanent, form-replacing home instead of
  // a status line the user could miss. "Fill out another response" re-enters a draft preview
  // (buildDraftPreviewUrl) when this was one, so testing a draft loops back into the draft rather
  // than silently switching to the live form; "view submitted response" always targets the real
  // saved item on the live config, since that's genuinely where it was written regardless of
  // whether a draft was used to produce it.
  // Captured here (rather than read as `route.*` inside the closure below) because TS's narrowing
  // of `route` past the "unresolved" early-return above doesn't carry into a nested function body.
  const { siteId, applicationId, formId, draftId } = route;

  function showSubmittedSplash(message: string, level: string, itemId: string): void {
    // A real, live bug this fixes: after a CREATE-mode submit, the address bar stayed on
    // `#formId/new` forever — the splash screen is purely a JS state swap, nothing ever
    // navigates. "Fill out another response" also targets `#formId/new`, so clicking it from a
    // page whose hash is ALREADY `#formId/new` is a no-op from the browser's own perspective
    // (the hash genuinely isn't changing, so no navigation — not even a `hashchange` event —
    // ever fires): it looked like the link did nothing, because by that point it truly had
    // nothing left to do. Replacing the URL here to reflect the just-saved item (view mode) —
    // the same URL "View submitted response" below already links to — makes the "Fill out
    // another response" target a genuinely different hash again, and is also just a more
    // accurate reflection of where the user actually is after a successful save.
    history.replaceState(null, "", buildFormUrl(siteId, applicationId, tenantId, formId, "view", itemId));

    const splash = showState(appRoot!, "screen-submitted");
    fillSlot(splash, "submitted-message", message).dataset.level = level;

    // Same "Back" link as the top-of-page nav (see below) — repeated here because showState hides
    // #screen-form (and the nav living inside it) entirely when #screen-submitted takes over, so
    // the original element genuinely disappears rather than just scrolling out of view.
    const backView = merged.backView; // local const — TS doesn't carry outer narrowing into a nested function body
    if (backView) {
      const submittedBackLink = el<HTMLAnchorElement>(splash, "submitted-back-link");
      submittedBackLink.href = buildViewUrl(siteId, applicationId, tenantId, backView);
      submittedBackLink.textContent = "Back";
      submittedBackLink.hidden = false;
    }

    const fillAnotherLink = el<HTMLAnchorElement>(splash, "fill-another-link");
    fillAnotherLink.href = draftId
      ? buildDraftPreviewUrl(siteId, applicationId, tenantId, formId, draftId)
      : buildFormUrl(siteId, applicationId, tenantId, formId, "create");
    fillAnotherLink.textContent = "Fill out another response";
    forceReloadIfAlreadyThere(fillAnotherLink);

    const viewResponseLink = el<HTMLAnchorElement>(splash, "view-response-link");
    viewResponseLink.href = buildFormUrl(siteId, applicationId, tenantId, formId, "view", itemId);
    viewResponseLink.textContent = "View submitted response";
    forceReloadIfAlreadyThere(viewResponseLink);
  }

  /**
   * A plain `<a href>` click to a URL that's byte-identical to the current one isn't a
   * navigation at all from the browser's own perspective — no `hashchange`, nothing. The one
   * place in this app's own `hashchange` -> reload() mechanism (see this file's top) can't help:
   * this real, live bug reported here was the replaceState call above making "Fill out another
   * response" (-> `#formId/new`) and "View submitted response" (-> `#formId/<itemId>/view`)
   * collide depending on which one happens to equal the URL the browser is already sitting on —
   * fixing one by construction breaks the other the same way. Guarding both unconditionally
   * (rather than guessing which one needs it) is the only version of this that's actually robust.
   */
  function forceReloadIfAlreadyThere(link: HTMLAnchorElement): void {
    link.addEventListener("click", (e) => {
      if (link.href === window.location.href) {
        e.preventDefault();
        window.location.reload();
      }
    });
  }

  // Top-of-page nav: up to three links, each independently shown only when it applies.

  // "Back" — only when the config names a Custom View to return to (FormConfig.backView, e.g. a
  // calendar view this form's items were linked in FROM). Absent means no Back link at all —
  // there's no generic "previous page" to fall back to, since a user can land on /form directly
  // (a shared link, a bookmark) with no view in the browser's history at all.
  if (merged.backView) {
    const backLink = el<HTMLAnchorElement>(screen, "back-link");
    backLink.href = buildViewUrl(route.siteId, route.applicationId, tenantId, merged.backView);
    backLink.classList.add('btn', 'primary');
    backLink.textContent = "Back";
    backLink.hidden = false;
  }

  // "Edit Entry" — switches from view mode to edit mode for the SAME item. Only meaningful in
  // view mode: create mode has no saved item yet, and edit mode is already editable.
  if (route.mode === "view" && route.itemId) {
    const editEntryLink = el<HTMLAnchorElement>(screen, "edit-entry-link");
    editEntryLink.href = buildFormUrl(route.siteId, route.applicationId, tenantId, route.formId, "edit", route.itemId);
    editEntryLink.textContent = "Edit Entry";
    editEntryLink.hidden = false;
  }

  // "Edit Form in Builder" — only for someone who can actually edit this site's form configs
  // (see lib/builder/permissions.ts, i.e. a site owner/editor, not every viewer). Shown
  // regardless of mode (create/edit/view) since it's always useful as a shortcut, but never for
  // a draft preview — that's already a builder-adjacent view.
  if (!route.draftId) {
    canEditPromise.then((canEdit) => {
      if (!canEdit) return;
      const editBuilderLink = el<HTMLAnchorElement>(screen, "edit-builder-link");
      const params = new URLSearchParams({ siteId: route.siteId, applicationId: route.applicationId });
      if (tenantId) params.set("tenantId", tenantId);
      editBuilderLink.href = `/builder?${params.toString()}#${route.formId}`;
      editBuilderLink.textContent = "Edit Form in Builder";
      editBuilderLink.hidden = false;
    });
  }

  // controlType "button" fields — each one's own, self-contained action chain
  // (field.actions), independent of form submission and of every other button. Wired here, not
  // renderForm.ts, for the same reason submitButton is: this is the one place that actually
  // knows about the Graph client / callbacks / the postAction engine. Wired unconditionally
  // (including view mode) — see fieldRegistry.ts's own comment on why a button stays clickable
  // in view mode, unlike every other control.
  for (const [fieldKey, { button, statusEl: buttonStatusEl, field: buttonField }] of Object.entries(rendered.buttons)) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      buttonStatusEl.textContent = "";
      buttonStatusEl.removeAttribute("data-level");

      try {
        // Defaults to true (same always-validate-first behavior Submit has) — see FieldConfig.validate.
        if (buttonField.validate !== false && !rendered.validateAll()) {
          buttonStatusEl.textContent = "Please fix the highlighted field(s) below.";
          buttonStatusEl.dataset.level = "error";
          return;
        }

        if (buttonField.confirm) {
          const choice = await showConfirmDialog(document, {
            title: buttonField.confirm.title,
            body: buttonField.confirm.body,
            options: [
              { label: "Cancel", value: "cancel" },
              { label: "Confirm", value: "confirm", primary: true },
            ],
          });
          if (choice !== "confirm") return;
        }

        const { errors } = await runButtonActions(buttonField, rendered.getValues(), itemForTemplates, graphFetch, {
          navigate: (to) => window.location.assign(to),
          showMessage: (message, level) => {
            buttonStatusEl.textContent = message;
            buttonStatusEl.dataset.level = level;
          },
          setFieldValue: rendered.setFieldValue,
          scriptActions,
        });

        // A button's own actions can write directly to the primary item (graphRequest/script —
        // see CLAUDE.md's "Button fields" section: "no restriction on it touching the primary
        // item's own list"), which changes its server-side etag OUTSIDE submitForm's own
        // etag-aware update path. Refresh the cached item/etag afterward so a LATER Submit click
        // doesn't 412 against the stale etag this page loaded with — a real, live bug: an
        // approve-style button whose chain PATCHes Status/etc. then later clicking Submit failed
        // with "Someone else changed this item since you opened it," even though the only
        // "someone else" was this same button's own earlier, successful write. Refreshed
        // unconditionally (not just on full success) — a button's actions run in dependency
        // order, so an EARLIER action's write can have already landed even when the chain's
        // overall result reports an error from a LATER, unrelated action (e.g. the approve
        // button's item PATCH succeeding before a subsequent Teams chat creation step fails).
        if (route.itemId) {
          try {
            const fresh = await graph.getListItem(merged.list.siteId ?? route.siteId, merged.list.id, route.itemId, selectColumnsForEditPrefill(merged.fields));
            editEtag = fresh.etag;
            Object.assign(itemForTemplates, { id: route.itemId, ...fresh.fields });
          } catch {
            // Best-effort — if the refetch itself fails, a later Submit surfaces its own
            // etag/network error rather than this silently swallowing the button's own result.
          }
        }

        if (Object.keys(errors).length > 0) {
          console.error(`entry-form: button "${fieldKey}" action(s) failed.`, errors);
          if (!buttonStatusEl.textContent) {
            buttonStatusEl.textContent = "Something went wrong. Please try again.";
            buttonStatusEl.dataset.level = "error";
          }
        } else if (!buttonStatusEl.textContent) {
          // Only a generic confirmation if none of this button's own actions already said
          // something more specific via a showMessage-type action's own message.
          buttonStatusEl.textContent = "Done.";
          buttonStatusEl.dataset.level = "success";
        }
      } finally {
        button.disabled = false;
      }
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

      // People-picker picks bound to a SharePoint person column can only be written for people
      // who are already members of this site — resolve them now and block with a field warning
      // rather than saving the item with those fields silently dropped.
      const personErrors = await checkPersonFieldsResolve(graph, route.siteId, merged.fields, listColumns, rendered.getValues());
      if (Object.keys(personErrors).length > 0) {
        rendered.setExternalErrors(personErrors);
        statusEl.textContent = "Please fix the highlighted field(s) below.";
        statusEl.dataset.level = "error";
        return;
      }
      rendered.setExternalErrors({});

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
        ifMatchEtag: editEtag,
        graph,
        graphFetch,
        listColumns,
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
      } else {
        if (
          (result.fileUploadErrors && Object.keys(result.fileUploadErrors).length > 0) ||
          (result.fieldErrors && Object.keys(result.fieldErrors).length > 0)
        ) {
          const parts = [
            ...Object.values(result.fileUploadErrors ?? {}),
            ...Object.values(result.fieldErrors ?? {}),
          ];
          statusEl.textContent = `Submitted, but some values need a second look: ${parts.join("; ")}`;
          statusEl.dataset.level = "warning";
        } else if (!statusEl.textContent || statusEl.textContent === "Submitting…") {
          // Only show a generic success message if no postAction's showMessage already set something more specific.
          statusEl.textContent = "Submitted successfully.";
          statusEl.dataset.level = "success";
        }
        // A genuine success always has an item (see submitForm.ts) — replace the form with the confirmation splash.
        showSubmittedSplash(statusEl.textContent, statusEl.dataset.level ?? "success", result.item!.id);
      }
    } finally {
      rendered.submitButton.disabled = false;
    }
  });
}

main().catch((err) => {
  console.error("entry-form failed:", err);
  const appRoot = document.getElementById("skye-app");
  if (!appRoot) return;
  try {
    showState(appRoot, "state-error");
  } catch {
    appRoot.textContent = "Something went wrong loading this form. Check the console for details.";
  }
});
