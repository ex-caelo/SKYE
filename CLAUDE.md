# CLAUDE.md — working notes for this repo

This file exists so anyone (human or AI) picking up this repo mid-stream
knows the conventions already in force and where things stand. Keep it
updated alongside `SKYE-pre-scaffold-TODO.md` as work progresses.

## Repo layout

```
turbo.json       task pipeline (build/test/typecheck/dev/lint:configs) — see "Commands" below
packages/
  skye-config/   framework-agnostic core logic (schema, merge, validation, actions) — pure TS, unit-tested
  app/           the Astro site — routing, auth, Graph integration, rendering
```

`skye-config` has no dependency on `app`; `app` depends on `skye-config`.
This split exists so the pure logic is testable without a live SharePoint
tenant or a browser — see `packages/skye-config/README.md`.

Task orchestration across the two packages goes through **Turborepo**
(`turbo.json`), not raw `pnpm -r`/`pnpm --filter`. Root `package.json`
scripts (`pnpm build`, `pnpm test`, etc.) are thin wrappers around `turbo
run <task>`. This buys parallel execution and caching (a `pnpm test` with
no relevant changes replays instantly instead of re-running vitest) — see
"Commands" below for specifics. **Turbo's caching requires a git repo**
(it hashes tracked/relevant files via git) — this only matters if you're
ever working in a checkout with no `.git`, which shouldn't normally happen
outside of a sandboxed environment.

## Conventions that apply to all future work in this repo

- **Keep `SKYE-pre-scaffold-TODO.md` current.** Check off items as they're
  implemented, in the same commit/PR. New decisions or follow-ups surfaced
  while implementing go into that file too (§13 for open questions), not
  just chat/commit history.
- **Comment every non-trivial function and logic block.** A concise comment
  stating *what* a block does, not a line-by-line narration. This matters
  more than usual here — one of SKYE's stated goals is ease-of-editing for
  people with little coding experience, and the code should model that
  clarity for anyone who has to touch it later.
- **No code is ever loaded from SharePoint.** Config files (`form.config.json`)
  are data only. `customValidators` and `postAction.functionName` are keys
  into registries hardcoded in `packages/app` source, reviewed and deployed
  through the normal build — never fetched, imported, or `eval`'d from
  SharePoint. An unregistered name is a loud runtime error, not a silent
  no-op or a fallback fetch.
- **Authoring a new `script` postAction ("plugin") is a fixed recipe.**
  Don't add a new schema-level `PostActionType` for a new service/action —
  that's schema churn per addition and doesn't fit the security rule above
  (script functions must live in reviewed `@skye/app` source, not
  `@skye/config`, since most need real network/Graph access). Instead:
  1. Find or create the service's folder under `src/app/src/actions/`
     (e.g. `teams/`, `outlook/`).
  2. Add one file exporting one `ScriptAction` (`(args, ctx) =>
     Promise<unknown>`, from `@skye/config`) — `args[0]` is a single named
     options object, not positional args, since a form author is writing
     JSON properties. Use `ctx.graphFetch`/`ctx.httpFetch` for network
     calls (the shared `actions/graphJson.ts` helper wraps the
     ok-check/JSON-parse boilerplate for Graph calls); throw a clear Error
     for missing required options.
  3. Register it in `src/app/src/actions/registry.ts`, keyed
     `"service.actionName"` — the one place the full list lives.
  4. A form config references it as `{ "type": "script", "functionName":
     "service.actionName", "args": [{ ...options }] }`. Actions compose via
     the existing `dependsOn` + `{{results.actionKey.path}}` chaining
     (see `teams.createChat` → `teams.sendMessage` for the pattern) — no
     new orchestration logic needed for a multi-step service action.
- **Overlays are additive-only.** A `[permission]/form.config.json` overlay
  may add pages/fields/postActions or loosen an existing constraint; it must
  never remove something a lower permission level sees, or make a
  constraint stricter. Enforced by `@skye/config`'s `lintOverlay` +
  `mergeConfig` (a literal `null` in an overlay is an authoring error, not
  a delete). Run `pnpm lint:configs -- <path>` against a local
  `skye_data/forms/` checkout before publishing config changes.
- **Permissions are handled entirely by SharePoint folder ACLs** — there is
  no app-level role-mapping code. `[permission]` subfolders under
  `skye_data/forms/[id]/` should have inheritance broken and ACLs set
  directly in SharePoint; the app just asks Graph which subfolders it can
  read and merges whichever ones come back. See TODO §5 for the still-open
  verification item (confirm Graph omits vs. 403s on inaccessible folders
  in your tenant).
- **SKYE data lives in a `skye_data` folder inside the site's Site Assets
  library** — deliberately not the default `Documents` library (out of
  users' way, permissions manageable separately), but Site Assets is an
  ordinary document library so creating folders/files in it only needs the
  `write` grant (creating a *library* needs `manage`, which many
  `Sites.Selected` grants don't have — that's why the earlier dedicated-
  library attempt 403'd). `RealGraphClient.skyeItemPath(siteId, rel)`
  resolves+caches the Site Assets driveId (`resolveSiteAssetsDrive` →
  `findSiteAssetsListId`): Site Assets is a **hidden system list** on many
  sites (Teams-provisioned ones), excluded from BOTH the `/lists` and
  `/drives` *collection* responses. What works, in order: (1) a **`$filter`**
  — `GET …/lists?$filter=displayName eq 'Site Assets'` surfaces the hidden
  list (confirmed against `msteams_79e519`; `$filter=name eq …` is a 400 —
  `name` isn't filterable); (2) direct `GET …/lists/SiteAssets`; (3) a
  paginated `/lists` scan, then a `/drives` scan. The `$filter` call carries
  `$expand=drive` so the driveId comes back in the same response (no separate
  `/lists/{id}/drive` round-trip on the fast path); the resolved driveId is
  cached per site per session. Builds `/drives/{driveId}/root:/skye_data/…`;
  throws `SkyeNotConfiguredError` if the site has no Site Assets library.
  `listSkyeForms`/`listSkyeViews` treat a 404 on `skye_data/forms|views` as
  "none" (a fresh install may have `skye_data/config` but not those folders).
  `getListItemImage` / `uploadToLibrary` address other drives directly and
  are unaffected.
- **If the site has no Site Assets library, SKYE can't create it** —
  `installSkyeSiteConfig` throws `SkyeInstallError` kind `"siteAssetsMissing"`
  and the switcher shows a "One step in SharePoint first" step
  (`renderCreateSiteAssetsStep`): a link to `…/_layouts/15/CreatePage.aspx`
  (adding+saving any page provisions Site Assets), a "Check again" button
  that re-runs the install, and a ~30s auto-poll that advances on its own
  once the library appears.
- **Provisioning a new site** is self-service from the site switcher's
  site-picker step (`renderAddSitePanel` → `entry-switcher.ts`): paste any
  link to the site (`lib/graph/siteUrl.ts`'s `parsePastedSiteUrl` reduces a
  deep SharePoint page/library URL to its site root, and pulls the group id
  out of a Teams channel deep link — the latter resolved via
  `GET /groups/{id}/sites/root`, which needs a scope beyond `Sites.Selected`
  and 403s gracefully until one's added) → `resolveSiteByUrl` →
  `hasSkyeConfig` → if none,
  confirm and `installSkyeSiteConfig` creates the `SKYE` library
  (`ensureSkyeLibrary`), writes `skye_data/config/skye.config.json`
  (`DEFAULT_SITE_CONFIG` in `viewConfig.ts` — empty allowlists, no `home`)
  plus empty `forms/`/`views/` folders, and returns the library's list id.
  Needs the signed-in user's permission to add a library to the site AND
  SKYE's `Sites.Selected` grant covering it; a 403 becomes
  `SkyeInstallError` (`kind: "forbidden"`) naming both possibilities.
- **After install, the switcher shows a "Manage permissions" step**
  (`renderPermissionsStep`) — SKYE can't set SharePoint ACLs via Graph, so
  it explains Members can currently edit SKYE's files and links out (new
  tab) to the **`skye_data` folder's** classic item-level permissions page:
  `buildFolderPermissionsUrl` → `…/_layouts/15/user.aspx?List={listId}&obj={listId},{itemId},LISTITEM&noredirect=true`
  (GUID dashes `%2D`-encoded, no braces — SharePoint's own "Manage access →
  Advanced" format for an item). `installSkyeSiteConfig` gets both ids from
  the folder's `GET …/root:/skye_data?$select=sharepointIds` →
  `{ listId, listItemId }`. Falls back to `buildLibraryPermissionsUrl`
  (whole library) if only the list id resolved, else no link. "I'm
  finished setting permissions" continues into the site. The actual
  inheritance break / Member demotion is a manual SharePoint step (or a
  future SP-REST automation).
- **Never fetch full SharePoint lists client-side.** Lookups query
  server-side with `$filter`/`$search` + `$top`; always `$select` only the
  fields actually needed; batch related reads via Graph `/$batch` where
  possible; retry 429s honoring `Retry-After`.

## Page markup lives in `.astro`; the entry script only toggles/fills it

Each page ships **every one of its states at once** as sibling
`<section data-state id="…">` elements inside `<main id="skye-app">`,
authored as real semantic HTML in `src/pages/*.astro` (composed from
`src/layouts/BaseLayout.astro` + `src/components/*.astro`). The
`src/scripts/entry-*.ts` for a page decides **which** state is visible and
fills its data-driven regions — it does not build markup with
`document.createElement` / `innerHTML` anymore.

- **`src/lib/ui/pageState.ts`** — `showState(root, id)` reveals one
  `[data-state]` section and `hidden`s its siblings; `fillSlot(scope,
  name, text)` sets a `[data-slot="name"]`'s text; `el(scope, name)` gets
  a `[data-el="name"]` control. A missing hook throws (skeleton/script
  drift is a loud failure, not a silent no-op). `public/styles/form.css`
  and `src/styles/view.css` carry a `[hidden] { display: none !important }`
  guard.
- **Hooks:** `id` for a whole state section, `data-slot` for a text region
  or a mount point the JS appends into (e.g. `[data-slot="form-mount"]`,
  `[data-slot="preview"]`), `data-el` for an interactive control the JS
  wires, `data-tpl` / a bare `<template>` for a repeated row the JS clones
  (site row, picker row, builder error `<li>`). `src/lib/ui/domHooks.ts`
  holds the cross-file ones (confirm dialog, message panel).
- **What is still built in TS** (deliberately — the markup is genuinely
  per-record, not fixed): the rendered form itself (`lib/render/*` from a
  FormConfig), the schema-driven property editor
  (`lib/builder/fieldEditor.ts` / `schemaControls.ts` /
  `formSettingsEditor.ts`), the save-review diff
  (`lib/builder/configDiffView.ts`), the live preview
  (`lib/builder/builderPreview.ts`), and all of `entry-diag.ts` /
  `pages/diag.astro` (an internal tool, left as-is). These append into a
  `[data-slot]` in the page skeleton.
- **Reusable components:** `BaseLayout.astro` (doc shell + `<main id="skye-app">`
  + a `head` slot), `ConfirmDialog.astro` (a native `<dialog>` — backdrop /
  Esc / focus from the platform; `lib/ui/confirmDialog.ts` fills it, opens
  it, resolves with the clicked `<button value>`; feature-detects
  `showModal`/`close` so jsdom < 26 in tests still works via an
  open-attribute + `close`-event emulation), `MessagePanel.astro`
  (`lib/ui/messagePanel.ts`), and the switcher steps `SitePicker` /
  `FormPicker` / `FormOrViewPicker` / `AddSitePanel` / `PermissionsStep` /
  `CreateSiteAssetsStep` (populated by the `populate*` / `wire*` / `fill*`
  helpers in `lib/routing/siteSwitcher.ts`).
- **Semantic HTML / native features:** prefer `<section>`/`<header>`/
  `<aside>`/`<output>`/`<menu>`/`<details>` over `<div>`; `<dialog>` for
  modals. `command` / `commandfor` (Invoker Commands) are used for
  purely-declarative show/hide; `src/lib/ui/invokers.ts`'s
  `ensureInvokerCommands()` (called early by each entry script)
  dynamic-imports the `invokers-polyfill` package **only** on browsers
  without native support.
- **Tests** for the DOM helpers mount the real `.astro` component body via
  `src/__tests__/helpers/astroFixture.ts` (reads the file, strips
  frontmatter — the components are expression-free), so there is no
  hand-copied fixture to drift. `src/__tests__/astroMarkupHooks.test.ts`
  additionally asserts every `id`/`data-slot`/`data-el`/`data-tpl` the TS
  queries is present in the source — a rename on one side without the
  other fails there.

## Custom Views (`src/app/src/lib/views/`, `pages/view.astro`)

Author-written HTML/CSS/JS "views" (calendars, dashboards) in
`skye_data/views/<id>/`, run in a `sandbox="allow-scripts"` iframe with **no
origin and no network**, every capability mediated over a private
`MessageChannel` to a trusted host on SKYE's own origin. **Read-only, always.**
Full spec: `CUSTOM-VIEWS-SPEC.md`. Author-facing reference:
`docs/custom-views-authoring.md`. Status/checklist: TODO §16.

Non-negotiable invariants (do not weaken without explicit sign-off):

- **`sandbox="allow-scripts"` only.** Never add `allow-same-origin`,
  `allow-popups`, `allow-forms`, or `allow-top-navigation*`. Navigation is a
  message (`skye:navigate`), resolved by `navigationPolicy.ts` — never a
  browser capability.
- **The frame's `srcdoc` contains nothing author-written** — only the CSP
  meta, SKYE's own `src/styles/view.css` (`?raw`), and `view-runtime.js`
  (`?raw`). The three view files arrive later over the port and are installed
  via `innerHTML`/`textContent`/`AsyncFunction`.
- **Frame CSP stays `default-src 'none'`** (+ `'unsafe-inline'`/`'unsafe-eval'`
  for the runtime, `img-src data:`). The `/view` page itself carries
  `frame-src 'self'`.
- **The handshake fail-closed check stays**: the host reads
  `frame.contentWindow.document` before handing over the port and refuses
  (`teardown`) if that read *succeeds* instead of throwing.
- **The host is the only code with a Graph token.** No message type accepts a
  raw Graph path, OData string, or URL — `skye:list` takes a structured
  `ViewQuery` that `validateViewQuery.ts` checks against the list's real
  column schema and `compileQueryToOData.ts` turns into `$filter` (the one
  place a view query becomes a string — the OData-injection surface).
- **No write handler exists** in `messageApi.ts`'s dispatch table. A
  write-shaped call gets `unknownType`, not a checked-and-denied 403.
- **`skye_data/config/skye.config.json`'s `views.allowedLists` is a shape
  guardrail, not a permission boundary** — every read still runs as the
  viewing user's delegated token and SharePoint authorizes it per-user.
  Overlays under `skye_data/config/[permission]/` are additive-only (allowlists
  are unioned; `home` is last-wins).

Regression gate: `cd src/app && pnpm test:views:browser` (Playwright, system
Chrome, own script — not in `turbo run test`). Every probe in the
`security-probes` demo view must report BLOCKED.

## Form Config Builder (`/builder`, `src/app/src/lib/builder/`)

A standalone visual editor for creating/editing `form.config.json` (base +
`[permission]` overlays) — pick a site, pick or create a form, then a live
preview on the left (click any field to select it) drives a schema-driven
property editor on the right. The defining design constraint: **the
property editor's fields come directly from `form.config.schema.json`
itself**, via `@skye/config`'s `schemaIntrospection.ts` — nothing about
"what properties does a field have" is hardcoded a second time in the
builder, so a schema change grows the UI automatically. See TODO §17 for
the full build writeup (what got discovered, what got deliberately scoped
out); this section is the durable "how it fits together" reference.

- **`classifySchemaProperty()`** maps any (possibly `$ref`'d) schema node
  to one of a fixed set of shapes a DOM control exists for
  (`enum`/`boolean`/`string`/`integer`/`number`/`stringArray`/
  `objectArray`/`object`/`dictionary`/`oneOfPrimitive`/`condition`/
  `unknown`). The one deliberate non-goal: `condition` (`visibleIf`/`when`)
  is genuinely self-recursive (`all`/`any`/`not` of more conditions) and is
  edited as raw JSON text rather than a visual tree builder — a conscious
  scope cut, not an oversight.
- **postAction is the one def where real properties live outside
  `properties`** — `request`/`to`/`message`/`functionName`/etc. only exist
  inside `allOf[].then.properties`, gated on `type`. `getConditionalProperties()`
  merges those in by discriminator match; the builder's postAction editor
  (`formSettingsEditor.ts`) tears down and rebuilds just one entry's body
  when its `type` changes, to swap in the right payload fields.
- **The Post Actions editor is grouped into one section per `trigger`
  phase** (`beforeSubmit` / `afterSubmit` / `onSuccess` / `onError`), each
  with a one-line "when it runs" blurb. Adding an action inside a section
  presets its `trigger`; a per-card "Phase" `<select>` moves it (and prunes
  any now-cross-phase `dependsOn`). An action with an unrecognised/absent
  `trigger` shows in a red "Not assigned to a phase" section rather than
  vanishing. Within a phase, actions are grouped into **"waves"**
  (`computeWaves` — wave 0 = no in-phase `dependsOn`; wave N depends on an
  earlier wave) so the UI shows "Step 1 — these N run at the same time",
  a "↓ then" separator, "Step 2", …; each card also says "Starts
  immediately…" or "Waits for: X". `dependsOn` is a **checkbox list of the
  other actions in the same phase**, not a comma-separated text box. A
  `script` action's `functionName` is a `<select>` grouped by service
  (`<optgroup>` teams / outlook / engage) sourced from the real
  `scriptActions` registry (`src/actions/registry.ts`), threaded in as
  `renderFormSettingsEditor(..., { scriptActionNames })` from
  `entry-builder.ts` (`Object.keys(scriptActions)`); a value the current
  build doesn't register is still shown, flagged "(unknown)". Structural
  edits (add/remove, phase move, `dependsOn` toggle, `type` change)
  re-render the whole editor so the waves + checkbox lists stay accurate;
  plain field edits don't.
- **An overlay's field/page/postAction entries must be FULL objects, not
  sparse patches** — confirmed from `form.config.overlay.schema.json`
  itself (any field an overlay declares still needs `controlType`, same
  required-ness as the base `field` def) and from how the real overlay
  fixtures in this repo are authored, even though `FormConfigOverlay`'s TS
  type says `Partial<...>`. The builder edits an overlay field with the
  exact same full-FieldConfig editor as a base field, just seeded from a
  copy of the effective merged field the first time that key is touched in
  that overlay.
- **An optional nested object property (`fileStorage`, `calculatedDisplay`,
  `table`, `style`, ...) is never eagerly instantiated as `{}`** just
  because it's on the schema — most have their own required sub-keys, so
  doing that for every field regardless of `controlType` would fail
  validation immediately. `schemaControls.ts`'s `renderPresenceToggledEditor`
  gates creation behind an explicit checkbox instead.
- **Save runs the same ajv validation `pnpm lint:configs` runs** —
  `@skye/config`'s `validateFormConfig`/`validateFormConfigOverlay`
  (`src/validation/validateConfig.ts`) wrap the identical ajv setup the CLI
  script already used (`ajv` is a real `dependencies` entry of
  `@skye/config`, always safe to ship into the browser). An overlay also
  runs the existing `lintOverlay` additive-only check before Save is
  allowed to proceed — a config the builder can save is one `lint:configs`
  would also accept.
- **One new Graph write capability**: `GraphClient.saveSkyeFormConfigFile`
  (PUT to `skye_data/forms/[id]/(<permission>/)form.config.json:/content`,
  same simple-upload addressing `uploadToLibrary` already uses). This was
  a deliberate scope decision (confirmed with the user) — the builder
  writes back to SharePoint directly on Save, it doesn't just export JSON
  for manual upload.
- **New-form creation's target list is picked from a dropdown of the
  site's lists** (`GraphClient.listSiteLists(siteId)` — a paginated
  `GET /sites/{id}/lists`, `$select`ed small, hidden system lists filtered
  out via `list.hidden`, sorted by display name). An earlier pass had the
  author hand-enter the list GUID (a deliberate scope cut); the user
  reversed that — enumerating a site's lists is list *metadata* (a small
  bounded collection), not list *items*, so the "never fetch a full list
  client-side" rule doesn't apply. `entry-builder.ts`'s "Or start a new
  form" section renders a `<select>`; a trailing "Other — enter a list id
  manually…" option reveals the old free-text input for a list on another
  site or one the enumeration missed, and the optional "different siteId"
  field re-enumerates that site's lists into the dropdown when changed.
- **Adding a field starts from the SharePoint column, not the control
  type.** The "+ Add field" sub-form has a **Source** `<select>`
  (`sharepoint` / `virtual`) and, for `sharepoint`, a **Bind to** `<select>`
  of the target list's live columns (`state.listColumns`). Picking a
  column auto-selects the matching `controlType`
  (`lib/builder/columnMapping.ts`'s `controlTypeForColumn` — `text`→text,
  `note`→textarea, `dateTime`→date, `choice`→select, `boolean`→checkbox,
  `personOrGroup`→peoplePicker, `lookup`→lookupPicker, `currency`→currency,
  `number`→number, `hyperlinkOrPicture`→url) and pre-fills a camelCased key
  from the column name (`fieldKeyForColumn`, `_x0020_`-decoded, de-duped).
  The type stays manually overridable. The field written is
  `fieldConfigForColumn(column, page)` → `{ source: "sharepoint", bindTo,
  controlType, label (if displayName differs), required (if the column
  is), page }`. `source: "sharepoint"` with no column bound is refused
  (the schema wants `bindTo`); no live columns at all → the SP-only
  controls hide and it falls back to a plain virtual field.
- **The builder keeps a form submittable against its list's required
  columns.** `columnMapping.ts`'s `missingRequiredColumns(fields, columns)`
  returns the required, non-`readOnly` columns no `source: "sharepoint"`
  field binds to. A **brand-new form** is seeded with a bound field for
  every one of them (in `openBuilder`, right after `getListColumns`). An
  **existing form** (base or draft view only — not an additive overlay)
  shows a "N required SharePoint columns have no field" panel at the top of
  Form settings, with per-column "Add field" and an "Add all" button
  (`renderFormSettingsEditor`'s new `{ listColumns, defaultPageKey,
  requiredColumnCheck, onFieldsChanged }` options) — surfaced, not
  silently mutated, so the author decides. `mapColumn` now also captures
  Graph's `readOnly` so computed/system required columns (Created, …) are
  skipped everywhere here.

**Second pass (per explicit follow-up feedback), summarized here; full
build log in TODO §17:**

- **Access is permission-gated, not just Save-gated.** `/builder` checks
  `lib/builder/permissions.ts`'s `canEditFormConfig` BEFORE rendering the
  site/form picker or the builder itself — a non-editor sees a plain "you
  don't have edit permission" panel, never the builder UI. The same rule
  backs `/form`'s "Edit in Builder" link and the **site switcher's "Create
  New Form Config" button** (`renderFormOrViewPicker`'s optional
  `onCreateNew` → `buildBuilderUrl` → `/builder?siteId=…`). `canEditFormConfig`
  grants access two ways, OR'd:
  1. **`graph.canWriteSkyeData(siteId)`** — the real requirement. Graph has
     no read-only signal for a user's effective folder permission (the
     `permissions` collection needs manage-permissions rights just to read,
     so a contributor gets a false negative), so it's a **functional
     probe**: PUT a `skye-write-check.tmp` marker into `skye_data/` and
     DELETE it — 2xx on the PUT means write access. Every failure (403, no
     Site Assets library, name rejected, network) → `false`; the callers
     are UI affordances where a wrong "yes" just dead-ends at Save. This is
     what makes the builder usable on a freshly-installed site.
  2. site config's `builderEditors: string[]` (names of `[permission]`
     overlay folders under `skye_data/config/` the user can currently
     read) — kept as an explicit-allowlist / backward-compatible path via
     `canEditFormConfigs(configFiles)`.
  `entry-switcher.ts` gates the button on `(await graph.canWriteSkyeData(siteId))
  || canEditFormConfigs(configFiles)` (it already has the config files in
  hand, so it inlines the OR rather than re-fetching through
  `canEditFormConfig`).
- **Reused interactions: first "shared TS DOM-builder", later reworked
  into Astro components** — the original take was that a static-output SPA
  can't benefit from components because the *content* is runtime-decided.
  A later pass (see "Markup lives in `.astro`, JS toggles it" below)
  changed that: the *skeleton* of every screen/dialog/panel is fixed and
  CAN be authored as HTML; only visibility and a few text nodes are
  runtime. So `lib/ui/confirmDialog.ts` and `lib/ui/messagePanel.ts` now
  drive `components/ConfirmDialog.astro` (a native `<dialog>`) and
  `components/MessagePanel.astro` instead of building their own DOM, and
  the switcher's `renderSiteSwitcher`/`renderFormPicker`/… became
  `populateSitePicker`/`populateFormPicker`/… that fill
  `components/SitePicker.astro` etc.
- **Save now shows a diff before it commits.** `@skye/config`'s
  `computeConfigDiff` (pure, `merge/configDiff.ts`) compares the config as
  loaded/last-saved this session against the current in-memory edits,
  returning only what actually changed — per field/page/postAction:
  added/removed/changed, which properties changed, and whether a
  `visibleIf`/`when` was specifically added/removed/changed (covers both
  "made conditionally visible" and "hidden"). `lib/builder/configDiffView.ts`
  renders it grouped by page for fields, per the explicit ask; Save opens
  it in the shared confirm dialog and only writes on "Confirm & Save".
- **Draft/publish workflow**, confirmed scope: a draft is a FULL alternate
  FormConfig (not a partial overlay) stored under
  `skye_data/forms/[id]/_drafts/[draftId]/form.config.json` — deliberately
  a separate GraphClient surface (`listFormDrafts`/`getFormDraft`/
  `saveFormDraft`/`publishFormDraft`), not another `[permission]` overlay
  source, so the live-form-loading path can never accidentally pick one
  up; `getSkyeFormConfigFiles`'s folder scan additionally now skips any
  `_`-prefixed folder outright, as defense in depth. "Publish" reads the
  draft and writes it as the new live base — non-destructive, the draft
  itself is left in place for further edits/re-publish. A shareable
  preview link (`/form?...&draft=<id>#<formId>/new`, `router.ts`'s new
  `buildDraftPreviewUrl`) renders the draft AS the base, with real
  `[permission]` overlays the viewer can see still merged on top as
  normal — so a draft accurately previews what a given permission level
  would actually see. Never listed by `listSkyeForms` or shown in the
  switcher, by construction (nested a level deeper than `listSkyeForms`
  ever looks), not by extra filtering.
- **Draft submission is gated by an explicit dialog, per the user's own
  specified wording**: client-side field validation (a genuinely new
  piece — see below) always runs first and blocks submission on failure;
  once valid, a dialog asks "Run post-submission actions? This is a Form
  Preview. Would you like to save the form submission and run
  post-submission actions (sending emails and messages, running
  integrations, etc.) as if it's a live submission?" with "Don't Run
  Actions" (nothing is written, no postActions run — purely a validation
  check) / "Run Actions" (the exact same `submitForm` pipeline a live
  submission uses). Lets someone iterating on a draft's fields/validation
  test that in isolation without triggering real emails/Teams
  messages/integrations on every click, and opt into the full real thing
  once actually ready.
- **A real, pre-existing gap surfaced while building the validation
  gate above** (since closed everywhere — see "Field-level validation,
  everywhere" below): no form config in this app had EVER run
  field-level validation (`validateField`/`runCustomValidators`, both
  already exported from `@skye/config`) before this. `lib/validation/validateFormValues.ts`
  and `src/validation/customValidators.ts` (currently an EMPTY registry —
  no config in this repo has needed a custom validator yet) were the
  first real callers, deliberately wired in ONLY for the draft-preview
  path at first, per the actual scope of what was asked that turn —
  flagged rather than silently expanded into the live submit path too.
- **Fixed: the live preview was resetting to page 1 on every edit.**
  A page switch happens entirely inside `renderForm.ts`'s own tab-click
  handler, with no callback out to the caller — so `renderForm` now
  tracks and exposes `getActivePageKey()`/accepts an `initialPageKey`
  option, and `/builder` reads the OUTGOING preview instance's live
  `getActivePageKey()` right before tearing it down on every rebuild
  (reading a snapshot captured once right after construction was the
  actual bug — it never reflected a LATER tab click).
- **Found while manually verifying the draft workflow end-to-end**: the
  mock's in-memory stores only ever lived for one page's JS execution —
  this app has no client-side router between pages, so `/builder` and
  `/form` are genuinely separate script executions with no shared memory,
  meaning a draft saved in `/builder` was invisible to `/form`'s draft
  preview even in the SAME browser tab. `mockGraphClient.ts`'s
  form-config and draft stores are now also mirrored to `sessionStorage`
  (falls back to plain in-memory if unavailable — dev/testing convenience
  only, never a source of truth) so they survive a real navigation within
  one tab, matching a real Graph backend's actual persistence. This does
  NOT make the mock simulate cross-user/cross-session sharing (a
  `sessionStorage`-backed mock fundamentally can't — a tester opening a
  shared preview link in a fresh browser session won't see a draft only
  ever saved in someone else's tab); that's an inherent, honest limitation
  of a client-side-only mock, not something worth chasing further here.

**Third pass: field-level validation, everywhere.** The pre-existing gap
flagged in the second pass — no form in this app ran field-level
validation before submission outside the new draft-preview path — is now
closed for every surface that renders a form at all, not just the ones
that submit. All of it lives in ONE place, `lib/render/renderForm.ts`
itself, so `/form` (live create/edit), `/form?draft=...` (draft preview),
and `/builder`'s own live preview all get it automatically just by going
through `renderForm`/`renderBuilderPreview` — there was never a need to
wire each caller separately.

- **`renderForm` now owns validation directly**, not just rendering:
  `RenderFormOptions` gained `customValidators` (the app's real registry,
  threaded through from `entry-form.ts`/`entry-builder.ts`), and
  `RenderedForm` gained `validateAll(): boolean` — runs
  `validateFormValues` (native constraints + custom validators, already
  existing) over the whole form, marks every field "touched", updates
  every field's inline error, and returns overall validity. Every submit
  handler (`entry-form.ts`, both the live and draft-preview paths) calls
  this FIRST and refuses to proceed while it's false — the actual gap
  closure.
- **"Something like `:user-invalid`", implemented as asked, but not
  purely via the native pseudo-class**: an error is computed continuously
  but only ever DISPLAYED once that field has been touched (blurred) or a
  submit was attempted for the whole form — exactly `:user-invalid`'s own
  "don't flash red on a pristine field" idea. The reason it's not
  *purely* the native pseudo-class: several of this app's controls
  (`skye-people-picker`, `skye-lookup-picker`, `skye-lookup-table`,
  `skye-richtext`, `skye-calculated-display`) are custom elements with no
  native Constraint Validation participation at all, so `:invalid`/
  `:user-invalid` can never match them regardless of what CSS says. The
  fix is a hybrid: renderForm.ts tracks its own `touchedFields` (a
  root-level delegated `focusout` listener, using `closest("[data-field-key]")`
  so it works whether a control is a real form element or a custom
  element/shadow-DOM host) and drives a `.skye-field--invalid` class +
  `aria-invalid` on EVERY control type uniformly — that's the actual
  source of truth for the visible styling. On top of that, for any
  control that DOES support it (`typeof control.setCustomValidity ===
  "function"` — real `<input>`/`<select>`/`<textarea>`), the same
  message is also pushed through `setCustomValidity()`, so the real
  `:user-invalid`/`:invalid` pseudo-classes engage too (`form.css` styles
  both selectors identically, so they can never visually disagree) —
  free native/assistive-tech behavior layered on top of, not instead of,
  the class that actually guarantees consistency everywhere.
- **Accessibility, not just visuals**: `renderField.ts` now always gives
  each field's message element an `id` and associates it via
  `aria-describedby` on the control (kept permanently associated, even
  while the message is empty — simpler than toggling the attribute every
  validation pass, and an empty live region is harmless); `aria-invalid`
  is set explicitly on every control type, native or custom, not just
  wherever the browser happens to infer it.
- **`lib/validation/validateFormValues.ts` is unchanged in its own
  contract** (skip content-only controls, readonly fields, fields
  currently hidden by their own `visibleIf`) — `renderForm.ts` is just a
  new, more central caller of it, alongside the existing draft-preview
  call site (which now gets its validation from `rendered.validateAll()`
  too, replacing its own standalone call to the same function).
- Manually verified in a real browser (not just jsdom): a pristine
  required field shows nothing on load; focusing then blurring it without
  typing reveals its error with the red outline/label styling; typing a
  valid value clears it live; submitting with other required fields still
  empty reveals ALL of them at once via `validateAll()`. Screenshot-level
  confirmation, not just a status-string check. 6 new tests in
  `renderForm.test.ts` (touched-reveal, live-clear-on-correction,
  `validateAll`, and a registered custom validator actually firing).

**Fourth pass: custom elements are now REAL form-associated custom
elements, not just faked via a fallback class.** Explicit follow-up:
`skye-people-picker`/`skye-lookup-picker`/`skye-lookup-table`/
`skye-richtext` (every custom element that's an actual editable form
field — `skye-calculated-display` deliberately excluded, see below)
should properly participate in the platform's Constraint Validation API,
not just get a look-alike CSS class.

- **`registerElements.ts`'s `SkyeValueElement` base class now calls
  `attachInternals()`** (`static formAssociated = true`, per the Custom
  Elements / Form-Associated Custom Elements spec) and implements
  `setCustomValidity(message)`/`checkValidity()`/`reportValidity()`/
  `validity`/`validationMessage`/`willValidate`, all delegating to the
  real `ElementInternals` object — the EXACT same method names/contract a
  native `<input>` already has. This is what makes `renderForm.ts`'s
  existing `typeof control.setCustomValidity === "function"` check (added
  in the third pass, unchanged since) now ALSO true for every custom
  element — no separate code path was needed there at all; the
  integration point already existed, it just had nothing real to call
  before this.
- **Deliberately excludes `skye-calculated-display`'s validation
  semantics being meaningful** (it still inherits `formAssociated` from
  the shared base class, harmlessly — it's just never marked invalid,
  since it's read-only/derived and already excluded from
  `validateFormValues.ts`'s own skip list — "never user-edited or read
  back for validation the normal way", per fieldRegistry.ts's existing
  comment).
- **Deliberately NOT wired: `ElementInternals.setFormValue()`** — the
  OTHER half of form-association, for participating in a real `<form>`'s
  FormData on native submission. This app never wraps a form in an actual
  `<form>` element (root is a plain `<div class="skye-form">`) and
  submits entirely through its own JS pipeline (`submitForm.ts` reads
  `.value` directly), so there's no native submission event
  `setFormValue` would ever feed. Only the validation half of
  form-association is relevant here, and it's the half that was asked
  for and implemented.
- **A real, environment-specific gap found and worked around, not
  papered over**: jsdom (this repo's test environment) implements
  `attachInternals()` itself but NOT the Constraint Validation portion of
  the object it returns — `setValidity`/`checkValidity`/`validity`/
  `validationMessage`/`willValidate` are all `undefined` there, confirmed
  directly against jsdom 25 before writing any of this. Every one of
  `SkyeValueElement`'s new methods feature-detects before touching
  `_internals`, so the code behaves identically whether or not the
  environment actually supports it — a real browser gets full
  participation, jsdom gets graceful no-ops instead of a thrown
  `TypeError`. Confirmed by running the full test suite (still 285+
  passing) before AND after.
- **Manually verified against real Chrome** (not just jsdom, given the
  above): a `skye-richtext` element's `checkValidity()`/`validity.valid`/
  `:invalid` CSS pseudo-class all correctly flip to invalid the instant
  `setCustomValidity("...")` is called, and correctly flip back once
  cleared — genuine native Constraint Validation, confirmed working for a
  real custom element, not assumed. **One honest nuance found in that
  same check, not swept aside**: `:user-invalid` specifically did NOT
  engage from a scripted `focus()` + `blur()` on the custom element,
  unlike `:invalid` which engaged immediately — Chrome's heuristic for
  "has the user interacted with this form-associated custom element" for
  `:user-invalid` purposes appears stricter than for a native `<input>`
  and wasn't satisfied by this test. This is exactly why this app's OWN
  `.skye-field--invalid` class (driven directly by `renderForm.ts`'s own
  `touchedFields` tracking, not a browser heuristic) remains the
  guaranteed, deterministic layer controlling the actual visible styling
  — the native `:user-invalid`/`:invalid` pseudo-classes are a real,
  working, additional layer now (useful for anything else that reads
  native validity state, e.g. some assistive tech and any future native
  form-submission path), not a replacement for it.
- 2 new tests in `registerElements.test.ts` (every SKYE custom element is
  form-associated; every one exposes the full Constraint Validation
  method/property surface without throwing). **369 tests passing across
  both packages** (up from 367 — 82 in `@skye/config`, 287 in
  `@skye/app`), both type-check clean, Astro production build verified.

## Auth: tenant resolution (`src/app/src/lib/auth/tenantResolver.ts`)

A single-tenant Azure app registration rejects the `/common` authority
(`AADSTS50194`), and that failure is **not cleanly recoverable** — the
popup dead-ends on an AAD error page MSAL can't read back, so it just
surfaces as `user_cancelled`. So SKYE never speculatively tries `/common`
for a single-tenant app; it establishes the tenant id first.

Resolution order in `acquireToken`:
1. `?tenantId=` in the URL, or `PUBLIC_DEFAULT_TENANT_ID`;
2. a tenant id a previous successful sign-in on this browser cached in
   `localStorage`;
3. **otherwise, ask.** `acquireToken` shows a small modal for the user's
   work email and resolves it to a tenant GUID via Entra's public,
   unauthenticated OIDC discovery document
   (`https://login.microsoftonline.com/<domain>/v2.0/.well-known/openid-configuration`
   — the `issuer` carries the GUID), caches it, and rewrites the address
   bar to `?tenantId=<guid>` (`history.replaceState`, no navigation) so
   it's a one-time step.

After **any** successful sign-in, `rememberTenantFromResult` caches +
backfills the real tenant id from the MSAL `AuthenticationResult`. If a
provided/cached tenant is itself rejected (`AADSTS50194`/`90002`/`500011`/
`90072`), the cache is cleared and the prompt runs.

A genuinely **multi-tenant** deployment sets `PUBLIC_AUTH_ALLOW_COMMON=1`
to try `/common` first instead of prompting. `PUBLIC_DEFAULT_TENANT_ID`
remains the zero-prompt option for a single-org deployment. Tenant GUIDs
aren't secret (every token/URL/discovery doc carries one), so
`localStorage` is fine. `acquireTokenPopupOnly` (diag only) is exempt — it
manages the tenant explicitly. See `src/app/.env.example`.

## Real-tenant Graph permissions (IU) — what's available for actions/postActions

Tested against the actual IU tenant (app registration `d7c6a2e3-...`, `Sites.Selected`
permission model) via `pages/diag.astro`/`scripts/entry-diag.ts` — see that page's own
docstring to re-run this or test a new scope. Each row below is one delegated scope,
acquired alone via `acquireTokenPopupOnly`, so a failure is specific to that one scope,
not a combined-request artifact.

**✅ Confirmed working** (token acquires cleanly — safe to build a real action against today):

| Scope | Unlocks |
|---|---|
| `Sites.Selected` | Everything list/library-related already built (per-site grant required — see TODO §4/§13) |
| `User.ReadBasic.All` | `searchPeople`, the peoplePicker control |
| `Chat.Create`, `ChatMessage.Send` | `teams.createChat`/`teams.sendMessage` (already built) |
| `Mail.Send` | `outlook.sendEmail` (already built) |
| `ChannelMessage.Send`, `Team.ReadBasic.All`, `Channel.ReadBasic.All` | **Not yet built**: posting into a Team **channel** (distinct from the existing chat-only `teams.sendMessage`) — all three needed pieces (send + resolve team/channel) are available now |
| `TeamsActivity.Send` | **Not yet built**: a lightweight Teams activity-feed notification, cheaper than a full chat message |
| `Presence.Read`, `Presence.ReadWrite`, `Presence.Read.All` | **Not yet built**: presence-aware logic (e.g. only notify if online) |
| `Files.ReadWrite`, `Files.ReadWrite.AppFolder` | **Not yet built**: file actions beyond the existing `library`-mode upload (move/copy/organize) |
| `Chat.ReadBasic`, `ChatMessage.Read` | **Not yet built**: reading recent chat messages |
| `Notifications.ReadWrite.CreatedByApp`, `UserActivity.ReadWrite.CreatedByApp`, `UserNotification.ReadWrite.CreatedByApp` | **Not yet built**: various app-scoped notification/activity mechanisms |
| `Bookings.*` (`BookingsAppointment.ReadWrite.All`, `Bookings.Manage.All`, `Bookings.Read.All`, `Bookings.ReadWrite.All`) | **Not yet built**: a full Microsoft Bookings integration — no concrete use case yet, flagging as available |

**❌ Confirmed blocked** (an actual server-side `access_denied` response, not just a closed prompt):

- `Calendars.ReadWrite.Shared` — needs admin consent that IU hasn't granted. This blocks
  the calendar-writing half of both `teams.scheduleMeeting` and `outlook.createCalendarEvent`
  (both already built and registered, but will fail at runtime until this changes).
  **Removed from `GRAPH_SCOPES`** (`authProvider.ts`) as of this pass — MSAL requests the whole
  scope set in one token call, so leaving an ungranted scope in the list broke sign-in entirely.
  `GRAPH_SCOPES` is now `Sites.Selected` / `User.ReadBasic.All` / `Chat.Create` / `ChatMessage.Send`
  / `Mail.Send` (all confirmed working). Calendar/meeting actions must use the `redirect` deep-link
  workaround (`outlook.buildCalendarEventDeepLink`). If IU grants a calendar scope later, add
  exactly that one back and re-test the combined sign-in.

**⚠️ Uncertain — showed `user_cancelled`, not `access_denied`** (a *client-side* MSAL
signal that the popup closed before finishing, which can mean either "the same
admin-approval block, dismissed quickly" or just an interrupted prompt — not the same
strength of evidence as the confirmed-blocked scope above): `Calendars.Read.Shared`,
`Calendars.ReadBasic`, `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `Tasks.ReadWrite`,
`Tasks.ReadWrite.Shared`, `People.Read`. Treat as "not currently usable" for planning
purposes, same as the confirmed-blocked one — but if a concrete action ever needs one of
these specifically, re-test it in isolation on `/diag` and wait for the full prompt to
render before deciding, rather than trusting this batch result as final. (`People.Read`
isn't actually blocking anything today — `User.ReadBasic.All`, which IS confirmed working,
already covers the real `searchPeople` use case.)

**Workaround for anything calendar/meeting/task-related: a URL deep link, not a Graph call.**
No new code needed — the existing `redirect` postAction type already supports templated
URLs (`{{fields.x}}`/`{{results.x}}`), so a config author can link out to a prefilled compose
screen instead of writing the event/task via Graph:
- Outlook Web calendar compose: `https://outlook.office.com/calendar/0/deeplink/compose?subject=...&startdt=...&enddt=...`
- Teams "schedule a meeting" compose: `https://teams.microsoft.com/l/meeting/new?subject=...`
- Microsoft To Do: `https://to-do.office.com/tasks/inbox` (no reliable prefill query params as of this writing — worth rechecking before relying on one)

The user completes the actual write themselves in their own Outlook/Teams/To Do, so it
needs no additional Graph scope at all — a real, ready-to-use fallback for the
confirmed/uncertain-blocked scopes above until (if ever) IU grants them.

**Implemented**: `outlook.buildCalendarEventDeepLink` + `outlook.verifyCalendarEventByIcs`
(`src/app/src/actions/outlook/`) — build the deep link (embeds a unique marker in the event
body), redirect the user there, and later confirm they actually saved it by checking an
author-configured ICS proxy for that marker. A form config wires the two together like this
(the actual navigation uses the existing `redirect` type, not a third custom action):

```json
"postActions": {
  "buildEventLink": {
    "trigger": "afterSubmit",
    "type": "script",
    "functionName": "outlook.buildCalendarEventDeepLink",
    "args": [{ "subject": "{{fields.eventTitle}}", "startDateTime": "{{fields.startTime}}", "endDateTime": "{{fields.endTime}}" }]
  },
  "goToOutlook": {
    "trigger": "onSuccess",
    "type": "redirect",
    "dependsOn": ["buildEventLink"],
    "to": "{{results.buildEventLink.url}}"
  }
}
```

`verifyCalendarEventByIcs` (`icsProxyUrl`, `verificationId`) would run later — a different
form/trigger, since `redirect` unloads the page — using
`{{results.buildEventLink.verificationId}}` if it's still in scope, or a value the config
persisted itself (e.g. via `setField`) if not. **SKYE does not implement the ICS proxy
itself** — `icsProxyUrl` must point at server-side infrastructure that already exists
elsewhere (see the CORS finding below for why a proxy is needed at all).

## Campus Labs Engage actions (`src/app/src/actions/engage/`) — the first non-Graph service

`engage.createEvent`, `engage.updateEvent`, `engage.cancelEvent`, `engage.rsvpToEvent`,
`engage.updateRsvp`, `engage.recordAttendance`, `engage.updateAttendance`,
`engage.deleteAttendance` — Campus Labs Engage is an entirely separate third-party API
(campus involvement platform), not Microsoft Graph, with its own simple `X-Engage-Api-Key`
header auth. Both `apiKey` and `baseUrl` are config-supplied on every call, never
hardcoded — `baseUrl` because requests sometimes go through a school-specific whitelabeled
domain instead of the default `https://engage-api.campuslabs.com/api`, and `apiKey` is
OPTIONAL for the same underlying reason: some whitelabeled deployments route through a
middleman/proxy that injects the real key itself server-side, so SKYE never needs one in
that case — when omitted, the header is left off the request entirely rather than sent
empty. Deliberately scoped to just the Events area (create/RSVP/attendance, now with full
update/cancel/delete) out of Engage's much larger real API (~60+ endpoints across Finance,
Memberships, News, Room Reservations, etc.) — confirmed with the user rather than guessing
at that much speculative code; see TODO for the full scoping rationale and what was
deliberately left out. **When pulling exact request/response shapes from a large external
OpenAPI spec, fetch and parse the raw JSON directly rather than relying on a summarized
reading of it** — a summarized pass here got `createEvent`'s `address` field wrong (claimed
it was a plain string; it's actually a structured object), caught only once the raw schema
was pulled directly. The same raw-spec pull mattered again for the update actions: Engage's
`PATCH` endpoints expect an **RFC 6902 JSON Patch body**
(`[{ op: "replace", path: "/name", value: ... }, ...]`), not a plain partial object — see
`engage/client.ts`'s `buildReplacePatch(changes)` helper, which builds that array from an
ordinary "what's changing" object so form authors never write raw patch syntax. Two real
business rules came straight from Engage's own docs: `engage.updateEvent` always requires
`submittedById`, even when nothing else about "who changed this" is relevant, and an event's
cancellation state can only be changed via the dedicated `engage.cancelEvent` (`POST
.../cancel`) — never through `updateEvent`'s general PATCH. Two actions were deliberately
**not** added because the underlying endpoints don't exist: no `engage.deleteEvent` (Events
only support `GET`/`PATCH` + the separate cancel action, no DELETE) and no
`engage.deleteRsvp` (RSVPs only support `GET`/`POST`/`PATCH` — withdraw one via
`engage.updateRsvp({ ..., response: "No" })` instead). Attendance genuinely does support a
real DELETE, so `engage.deleteAttendance` is a plain one-to-one wrapper.

```jsonc
// Example: reschedule an event, then cancel a different one, via chained postActions.
{
  "type": "script", "functionName": "engage.updateEvent",
  "args": [{
    "eventId": 4821,
    "submittedById": { "campusEmail": "{{fields.organizerEmail}}" },
    "startsOn": "{{fields.newStart}}", "endsOn": "{{fields.newEnd}}"
  }]
}
// Cancelling one instead:
{ "type": "script", "functionName": "engage.cancelEvent",
  "args": [{ "eventId": 4821, "comments": "Rescheduled due to weather" }] }
```

**Confirmed directly (not just inferred): no currently-granted scope reaches calendar data
at all.** `GET /me/events` with a token carrying only `User.ReadBasic.All` (deliberately no
`Calendars.*`) returned a clean `403 ErrorAccessDenied` — Graph's `Calendars.*`-only
permission model holds exactly as documented, no incidental leak through another scope.

**A published-ICS calendar URL's embedded identifier is NOT a usable Graph user lookup.**
Tested against a real IU shared-calendar link
(`.../owa/calendar/f4d4003a2c8f4d76a186ce29f6eab54c@iu.edu/.../calendar.ics`) —
`GET /users/f4d4003a2c8f4d76a186ce29f6eab54c@iu.edu/...` returns `404 ErrorInvalidUser`, not
`403`. That `@iu.edu`-suffixed string is 32 hex characters — the same shape as a GUID with
the dashes stripped — almost certainly the mailbox's internal GUID dressed up to look like
an email address by OWA's "publish calendar" feature, not a real UPN. **If a future action
ever needs to reach a specific shared calendar via Graph** (once/if a `Calendars.*` scope is
granted), get that mailbox owner's actual UPN/email directly — don't reuse the identifier
embedded in their published-ICS/HTML calendar link, it won't resolve.

## Current implementation status

See `SKYE-pre-scaffold-TODO.md` for the authoritative, itemized checklist.
Summary as of the last update:

- ✅ Schema edits (§1): `fileStorage`, structured `calculatedDisplay`
  expression, corrected `customValidators`/`script` descriptions, plus a
  new `form.config.overlay.schema.json` for validating overlay files
  (found necessary during implementation — the base schema's top-level
  `required` doesn't fit overlay files, which are partial by design).
- ✅ `packages/skye-config` (§1 schema consumption, §2 security mechanism,
  §6 merge/lint, §8 validation, §9 actions/dependency graph, §12 tests):
  scaffolded, 40 tests passing, `tsc` clean, `lint:configs` CLI working.
- ✅ `packages/app` render/routing/mock-graph layer (§2 `applyAttributes`
  security choke point, §3 routing, §4 auth scaffolding, §5 config-file
  loading, §6 `PUBLIC_MOCK_GRAPH` fixtures, §7 field registry/layout engine):
  scaffolded and tested.
- ✅ `packages/app` submit/postAction pipeline (§9): `submitForm.ts`
  orchestrates beforeSubmit → primary item write → `parentReference`
  lookupTable row writes → afterSubmit → onSuccess/onError, wired to
  `renderForm`'s submit button in `entry-form.ts`. A deliberate
  failure-handling policy is documented in `submitForm.ts`'s own docstring.
- ✅ `packages/app` real Web Components, `calculatedDisplay` reactivity,
  etag-conflict UX, lookupTable row deletion, site switcher, file uploads:
  `skye-people-picker`/`skye-lookup-picker` are real debounced
  search-as-you-type controls (event-based, so the elements stay
  Graph-agnostic); `skye-lookup-table` has real add/remove-row editing,
  where removing an EXISTING row marks it `deleted: true` and hides it
  (so the delete actually reaches SharePoint via the new
  `GraphClient.deleteListItem`) while a never-saved row is just dropped;
  `skye-richtext` has a working toolbar (still `execCommand` internally,
  not swapped for a real editor library — deliberately deprioritized over
  jsdom-compatibility risk). `renderForm.ts` recomputes `calculatedDisplay`
  fields reactively. `EtagConflictError` lets `submitForm.ts` report
  `conflict: true` distinctly. The site switcher
  (`GraphClient.searchSitesWithSkyeData`) uses Graph's `/search/query`
  (entityType `driveItem`, `queryString: "skye_data"`), then trusts a hit
  outright ONLY when its `webUrl` ends `/SiteAssets/skye_data` — every other
  `skye_data` hit (stale index entry, old `Documents` copy, no `webUrl`) is
  put through `hasSkyeConfig(siteId)` and dropped if false, so a site with no
  `skye_data` in Site Assets never appears. All candidates resolve + verify
  in parallel (`Promise.allSettled`), not sequentially. File uploads: `library` mode is fully
  implemented (Graph's simple-upload endpoint, writes `webUrl` back to the
  bound column); `attachment` mode is deliberately NOT implemented — Graph
  v1.0 has no solid endpoint for SharePoint list item attachments, and
  guessing at one felt worse than an honest, clear error pointing at
  `library` mode instead. `skye-richtext` was deliberately simplified (per
  explicit instruction) to a minimal HTML/CSS-only placeholder — a plain
  contenteditable plus a purely visual, non-interactive toolbar bar, no
  `execCommand`, no formatting logic — replacing an earlier toolbar
  implementation from a prior pass. **139 tests passing across both
  packages**, both type-check clean, Astro production build verified.
- ✅ Split the single-page app into separate `.astro` pages (`form`,
  `switcher`, `404`, `index`) for code segmentation, staying 100%
  client-side (no SSR — `formId`/`itemId` are live/unbounded, incompatible
  with Astro's static dynamic-route params). `formId`/`itemId`/`siteId`/
  `applicationId` still live entirely in the hash/query, parsed at
  runtime, exactly as before. Navigating between `/form` and `/switcher`
  is a real page load; see TODO §3 for the full writeup including the
  infinite-redirect guard and confirmed per-page bundle sizes. `/switcher`
  itself is a two-step chooser (site, then form on that site) when a visit
  arrives with no `formId` at all — `GraphClient.listSkyeForms` plus a new
  `renderFormPicker`; see TODO §3's second new entry.
- ✅ Monorepo tooling: adopted **Turborepo** for task orchestration
  (`turbo.json` defines `build`/`test`/`typecheck`/`dev`/`lint:configs`
  pipelines; root `package.json` scripts wrap `turbo run <task>`).
  Verified: parallel execution across both packages, caching confirmed
  working for `build`/`test`/`typecheck` (repeat runs replay in
  milliseconds, "FULL TURBO"), and argument-forwarding for `lint:configs
  -- <path>`. Also initialized a git repo at the root — **required** for
  Turbo's caching, since it hashes files via git. Found and fixed a real
  pnpm 11 gotcha along the way: see "A note on pnpm install" below —
  `onlyBuiltDependencies` in `pnpm-workspace.yaml` alone does NOT suppress
  the ignored-builds error the way earlier notes here assumed; `pnpm
  approve-builds --all` is the actual fix.
- ✅ Campus Labs Engage actions rounded out to full CRUD for Events,
  Attendance, and RSVPs: `engage.updateEvent`, `engage.cancelEvent`,
  `engage.updateRsvp`, `engage.updateAttendance`, `engage.deleteAttendance`
  added alongside the existing create/RSVP/attendance actions (8 Engage
  actions total, 15 across all services). See the "Campus Labs Engage
  actions" section above for the JSON Patch (RFC 6902) discovery, the
  `submittedById`-always-required and cancel-is-not-PATCH business rules,
  and the two deliberately-omitted actions (`deleteEvent`, `deleteRsvp`)
  whose endpoints don't exist. **263 tests passing across both packages**
  (up from 139 at the last count in this file), both type-check clean,
  Astro production build verified.
- ✅ `/builder` — the schema-driven form-config editor (site → form →
  live-preview-plus-property-editor → Save). See "Form Config Builder"
  above for the design writeup and TODO §17 for the full build log. New
  pieces: `@skye/config`'s `schemaIntrospection.ts` (schema → UI-shape
  classification) and `validateConfig.ts` (browser-safe ajv wrapper reusing
  `lint:configs`'s own schemas); `@skye/app`'s `GraphClient.saveSkyeFormConfigFile`
  write capability (+ `MockGraphClient` support); `lib/builder/`'s
  `schemaControls.ts`/`fieldEditor.ts`/`formSettingsEditor.ts`/
  `builderPreview.ts`; `pages/builder.astro` + `scripts/entry-builder.ts`.
  Manually verified end-to-end against the mock via a one-off Playwright
  script (site → pick a form → click a field → edit it → live preview
  updates → Save succeeds; separately, a brand-new form → Save correctly
  blocks with a clear ajv error until a required field is filled in) — not
  yet exercised against a real tenant, same standing caveat as the rest of
  this project's Graph-writing code. **315 tests passing across both
  packages** (up from 263 at the last count in this file — 72 in
  `@skye/config`, 243 in `@skye/app`), both type-check clean, Astro
  production build verified.
- ✅ `/builder` follow-up pass, per explicit feedback on the first one: a
  site-wide `builderEditors` permission gate (+ a matching "Edit in
  Builder" link on `/form`); a page-preservation fix for the live preview
  (was silently resetting to page 1 on every edit — a real bug, not a
  cosmetic one); a review-before-save diff (`@skye/config`'s
  `computeConfigDiff` + `lib/builder/configDiffView.ts`); a full draft/
  publish workflow (`_drafts/` subtree, four new GraphClient methods, a
  shareable preview link, a draft-preview submit gate with client-side
  validation + an explicit "run post-submission actions?" dialog); and two
  new shared UI primitives (`lib/ui/confirmDialog.ts`,
  `lib/ui/messagePanel.ts`) — at the time as plain TS DOM-builders; a later
  pass (see "Page markup lives in `.astro`" above) reworked both to drive
  `components/ConfirmDialog.astro` / `components/MessagePanel.astro`. Also surfaced and fixed a real
  mock-only bug found during manual E2E verification (in-memory mock
  state didn't survive a real page navigation between `/builder` and
  `/form`, since this app has no client-side router between pages — now
  mirrored to `sessionStorage`) and flagged a genuine pre-existing gap
  (no form in this app has ever run field-level validation before
  submission outside the new draft-preview path — closed in the next
  pass below).
  **361 tests passing across both packages** (up from 315 — 82 in
  `@skye/config`, 279 in `@skye/app`), both type-check clean, Astro
  production build verified, plus a full manual Playwright walkthrough of
  every new flow against the mock (see TODO §17 for exactly what was
  exercised).
- ✅ Field-level validation, closed for every form-rendering surface at
  once (live `/form`, draft preview, `/builder`'s own live preview) —
  per explicit follow-up asking specifically for this and for a
  `:user-invalid`-style reveal (only shown once a field is touched or a
  submit is attempted, not on a pristine load). Lives entirely in
  `lib/render/renderForm.ts` (`RenderedForm.validateAll()`, a
  `touchedFields` set driven by a delegated `focusout` listener, a
  `.skye-field--invalid`/`aria-invalid` class applied uniformly across
  native AND custom-element controls, plus a real `setCustomValidity()`
  call on whichever controls support it so the actual native
  `:invalid`/`:user-invalid` pseudo-classes engage too) — every caller
  gets it for free just by rendering a form at all, no per-surface wiring
  needed. See "Form Config Builder" above for the full design writeup.
  **367 tests passing across both packages** (up from 361 — 82 in
  `@skye/config`, 285 in `@skye/app`), both type-check clean, Astro
  production build verified, plus a real-browser (not just jsdom)
  Playwright + screenshot confirmation of the touched-reveal/live-clear/
  submit-reveals-all behavior.
- ✅ Every SKYE custom element (`skye-people-picker`/`skye-lookup-picker`/
  `skye-lookup-table`/`skye-richtext`) is now a genuine form-associated
  custom element (`attachInternals()`, real `setCustomValidity`/
  `checkValidity`/`validity`/`validationMessage`), per explicit follow-up
  that these should properly participate in Constraint Validation, not
  just get a look-alike class. Verified against real Chrome — `:invalid`
  and `checkValidity()` genuinely reflect SKYE's own validation now, with
  one honest nuance found and documented (`:user-invalid` specifically
  didn't engage from a scripted blur, unlike `:invalid` — this app's own
  `.skye-field--invalid` class stays the deterministic layer). jsdom
  doesn't implement the Constraint Validation half of `ElementInternals`
  at all (confirmed directly) — every new method feature-detects before
  use, so tests get graceful no-ops instead of thrown errors. See "Form
  Config Builder" above for the full writeup. **369 tests passing across
  both packages** (up from 367 — 82 in `@skye/config`, 287 in
  `@skye/app`), both type-check clean, Astro production build verified.
- ✅ Page markup moved out of TypeScript into the `.astro` files. Every
  user-facing page (`index`/`404`/`view`/`form`/`switcher`/`builder`) now
  ships all its states as `hidden` semantic sections composed from
  `src/layouts/BaseLayout.astro` + `src/components/*.astro`; the
  `entry-*.ts` scripts call `showState`/`fillSlot`/`el` (`lib/ui/pageState.ts`)
  and clone `<template>`s instead of `createElement`/`innerHTML`. New:
  `ConfirmDialog.astro` (native `<dialog>`), `MessagePanel.astro`, the six
  switcher-step components, `lib/ui/invokers.ts` (`invokers-polyfill`,
  conditionally imported, for `command`/`commandfor`). The
  siteSwitcher/confirmDialog/messagePanel helpers changed shape
  (`populate*`/`wire*`/`fill*`/`show*`), their 5 test files restructured to
  mount the real `.astro` bodies, `astroMarkupHooks.test.ts` added as a
  drift guard. Genuinely data-driven builders (renderForm, the
  schema-driven field/settings editors, the save diff, diag) deliberately
  left in TS. **442 tests passing across both packages** (82 in
  `@skye/config`, 360 in `@skye/app`), both type-check clean, Astro build
  verified, Custom Views browser gate still green, and a real-Chrome smoke
  pass of every page. See "Page markup lives in `.astro`" above.
- ✅ Builder Post Actions editor reworked: one section per `trigger` phase
  (Before/After submit, On success, On error), sequential "waves" with
  "Step N / ↓ then" so parallel-vs-sequential is visible at a glance,
  `dependsOn` as a checkbox list of same-phase actions, and a `script`
  action's `functionName` as a service-grouped `<select>` pulled from the
  real `scriptActions` registry (all teams.* / outlook.* / engage.*
  actions this build ships). `renderFormSettingsEditor` gained a
  `{ scriptActionNames }` option, threaded from `entry-builder.ts`. **448
  tests** (82 `@skye/config` + 366 `@skye/app`), type-check clean, build
  verified, real-Chrome smoke of the phase editor + functionName dropdown.
  See "Form Config Builder" above.
- ✅ Builder field creation is column-first, and required columns are kept
  covered. `lib/builder/columnMapping.ts` (new): `controlTypeForColumn` /
  `fieldConfigForColumn` / `fieldKeyForColumn` / `missingRequiredColumns`.
  The "+ Add field" sub-form gained **Source** + **Bind to** `<select>`s —
  picking a column auto-selects the `controlType` and pre-fills the key. A
  brand-new form is seeded with a bound field per required column; an
  existing base/draft shows a "missing required columns" panel with
  per-column "Add field" / "Add all" (`renderFormSettingsEditor` options
  `{ listColumns, defaultPageKey, requiredColumnCheck, onFieldsChanged }`).
  `mapColumn` now captures Graph's `readOnly` so system required columns
  are skipped. **461 tests** (82 `@skye/config` + 379 `@skye/app`;
  `columnMapping.test.ts` new, `formSettingsEditor.test.ts` +5), type-check
  clean, build verified, real-Chrome smoke (column→type auto-select;
  new-form seed; delete a required field → panel appears → "Add field"
  restores it). See "Form Config Builder" above.
- ⬜ **Not yet started:** choosing and integrating a real editor library for
  `skye-richtext` (Tiptap suggested — the current element is intentionally
  minimal, not a partial attempt), `attachment`-mode file uploads (needs a
  second MSAL scope for the SharePoint REST API audience — a bigger change
  than one more Graph call), an ARIA pass on the now-functional components.
- ⚠️ **Known gaps, not yet resolved (see TODO's "Newly discovered gaps"):**
  the MSAL popup→redirect fallback now recovers the ROUTE across the
  round-trip (`lib/auth/redirectReturn.ts` — stash the pre-redirect URL,
  finish the token exchange on the landing page, bounce back), but a
  half-filled form's field values are still lost; `searchSitesWithSkyeData`'s
  exact response shape assumptions are untested against a live tenant;
  `.env.example` + `src/env.d.ts` now document the `PUBLIC_*` vars; auth
  overall is structurally
  complete but untested against a live tenant.

## Commands

Everything below runs through Turborepo (`turbo.json`); root `package.json`
scripts are wrappers around `turbo run <task>`. Turbo runs independent
tasks in parallel and caches results (a repeat `pnpm test`/`pnpm build`
with no relevant changes replays in milliseconds — look for `>>> FULL
TURBO` in the output).

```bash
pnpm install                          # install all workspace deps
pnpm build                            # turbo run build  — builds both packages, cached
pnpm test                             # turbo run test   — runs every package's test suite (369 tests total), in parallel
pnpm test:config                      # turbo run test --filter=@skye/config — just @skye/config's 40 tests
pnpm typecheck                        # turbo run typecheck — tsc --noEmit across both packages
pnpm lint:configs -- <path>           # turbo run lint:configs -- <path> — validate + additive-lint a local skye_data/forms/ checkout
pnpm dev                              # turbo run dev — starts packages/app's dev server (persistent, not cached)

# Custom Views browser regression gate (Playwright + system Chrome; not part
# of `turbo run test` — needs a browser + a preview server):
cd src/app && pnpm test:views:browser

# Reach for pnpm --filter directly only when you want just one package
# without going through turbo, e.g.:
pnpm --filter @skye/app test

# from src/app (actual path — the workspace glob is src/*, not packages/*),
# for PUBLIC_MOCK_GRAPH-specific runs:
PUBLIC_MOCK_GRAPH=1 pnpm dev
PUBLIC_MOCK_GRAPH=1 pnpm build
```

### A note on `pnpm install` and esbuild/sharp

The first `pnpm install` in a fresh clone may stop with:

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@..., sharp@...
```

This is pnpm's default of not running dependency postinstall scripts
without explicit approval. **The actual fix** (found this session — an
earlier version of this note incorrectly pointed at
`onlyBuiltDependencies` in `pnpm-workspace.yaml`, which alone does NOT
suppress this on pnpm 11; a `pnpm run <script>` still fails via its
internal "deps status check" even with that setting present) is:

```bash
pnpm approve-builds --all
```

This is non-interactive and safe to run in CI/scripts. It records the
approval as `allowBuilds` in `pnpm-workspace.yaml` (pnpm rewrites the file
itself — don't hand-edit that key), which is what actually persists across
future `pnpm install`/`pnpm run` calls. Run it once after cloning, before
`turbo run` or any `pnpm run <script>` command.
