# CLAUDE.md — working notes for this repo

This file exists so anyone (human or AI) picking up this repo mid-stream
knows the conventions already in force and where things stand. Keep it
updated alongside `docs/build-log.md` as work progresses. For the one-page
overview of how the repo fits together, see `ARCHITECTURE.md`.

## Repo layout

```
ARCHITECTURE.md  one-page overview — read first
turbo.json       task pipeline (build/test/typecheck/dev/lint:configs) — see "Commands" below
packages/
  form-config/   @skye/form-config — the model: schema, types, merge/lint, condition &
                 expression eval, validation, post-action engine. Pure TS, no DOM/Graph, unit-tested.
  app/           @skye/app — the Astro site.
                 browser-tests/  the Playwright Custom Views security gate (test:views:browser)
                 src/:
                   pages/         one .astro per route
                   page-scripts/  one client bootstrap script per page (form.astro -> page-scripts/form.ts)
                   components/    reusable .astro components   layouts/  BaseLayout.astro
                   features/      form/  builder/  custom-views/  switcher/
                   shared/        auth/  sharepoint/  ui/  routing.ts  site-config.ts
                   integrations/  teams.* / outlook.* / engage.* actions
docs/            build-log.md (running record), handoff.md, custom-views-spec.md, custom-views-authoring.md
```

`form-config` has no dependency on `app`; `app` depends on `form-config`
via the `@skye/form-config` workspace alias. This split exists so the pure
logic is testable without a live SharePoint tenant or a browser — see
`packages/form-config/README.md`. **Astro treats any `pages/*.ts` as a
route**, which is why the per-page client bootstrap scripts live in
`src/page-scripts/`, not `src/pages/`. Reusable `.astro` components live in
`src/components/` (never nested in a feature); `src/layouts/` holds the
shared `BaseLayout.astro`.

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

- **Keep `docs/build-log.md` current.** Check off items as they're
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
  `@skye/form-config`, since most need real network/Graph access). Instead:
  1. Find or create the service's folder under `src/integrations/`
     (e.g. `teams/`, `outlook/`).
  2. Add one file exporting one `ScriptAction` (`(args, ctx) =>
     Promise<unknown>`, from `@skye/form-config`) — `args[0]` is a single named
     options object, not positional args, since a form author is writing
     JSON properties. Use `ctx.graphFetch`/`ctx.httpFetch` for network
     calls (the shared `actions/graphJson.ts` helper wraps the
     ok-check/JSON-parse boilerplate for Graph calls); throw a clear Error
     for missing required options.
  3. Register it in `src/integrations/registry.ts`, keyed
     `"service.actionName"` — the one place the full list lives.
  4. A form config references it as `{ "type": "script", "functionName":
     "service.actionName", "args": [{ ...options }] }`. Actions compose via
     the existing `dependsOn` + `{{results.actionKey.path}}` chaining
     (see `teams.createChat` → `teams.sendMessage` for the pattern) — no
     new orchestration logic needed for a multi-step service action.
- **Overlays are additive-only.** A `[permission]/form.config.json` overlay
  may add pages/fields/postActions or loosen an existing constraint; it must
  never remove something a lower permission level sees, or make a
  constraint stricter. Enforced by `@skye/form-config`'s `lintOverlay` +
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
  site-picker step (`renderAddSitePanel` → `page-scripts/switcher.ts`): paste any
  link to the site (`shared/sharepoint/siteUrl.ts`'s `parsePastedSiteUrl` reduces a
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
`src/page-scripts/*.ts` for a page decides **which** state is visible and
fills its data-driven regions — it does not build markup with
`document.createElement` / `innerHTML` anymore.

- **`src/shared/ui/pageState.ts`** — `showState(root, id)` reveals one
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
  (site row, picker row, builder error `<li>`). `src/shared/ui/domHooks.ts`
  holds the cross-file ones (confirm dialog, message panel).
- **What is still built in TS** (deliberately — the markup is genuinely
  per-record, not fixed): the rendered form itself (`features/form/render/*` from a
  FormConfig), the schema-driven property editor
  (`features/builder/fieldEditor.ts` / `schemaControls.ts` /
  `formSettingsEditor.ts`), the save-review diff
  (`features/builder/configDiffView.ts`), the live preview
  (`features/builder/builderPreview.ts`), and all of `page-scripts/diag.ts` /
  `pages/diag.astro` (an internal tool, left as-is). These append into a
  `[data-slot]` in the page skeleton.
- **Reusable components:** `BaseLayout.astro` (doc shell + `<main id="skye-app">`
  + a `head` slot), `ConfirmDialog.astro` (a native `<dialog>` — backdrop /
  Esc / focus from the platform; `shared/ui/confirmDialog.ts` fills it, opens
  it, resolves with the clicked `<button value>`; feature-detects
  `showModal`/`close` so jsdom < 26 in tests still works via an
  open-attribute + `close`-event emulation), `MessagePanel.astro`
  (`shared/ui/messagePanel.ts`), and the switcher steps `SitePicker` /
  `FormPicker` / `FormOrViewPicker` / `AddSitePanel` / `PermissionsStep` /
  `CreateSiteAssetsStep` (populated by the `populate*` / `wire*` / `fill*`
  helpers in `features/switcher/siteSwitcher.ts`).
- **Semantic HTML / native features:** prefer `<section>`/`<header>`/
  `<aside>`/`<output>`/`<menu>`/`<details>` over `<div>`; `<dialog>` for
  modals. `command` / `commandfor` (Invoker Commands) are used for
  purely-declarative show/hide; `src/shared/ui/invokers.ts`'s
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

## Custom Views (`src/features/custom-views/`, `pages/view.astro`)

Author-written HTML/CSS/JS "views" (calendars, dashboards) in
`skye_data/views/<id>/`, run in a `sandbox="allow-scripts"` iframe with **no
origin and no network**, every capability mediated over a private
`MessageChannel` to a trusted host on SKYE's own origin. **Read-only, always.**
Full spec: `docs/custom-views-spec.md`. Author-facing reference:
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

## Form Config Builder (`/builder`, `src/features/builder/`)

A standalone visual editor for creating/editing `form.config.json` (base +
`[permission]` overlays) — pick a site, pick or create a form, then a live
preview on the left (click any field to select it) drives a schema-driven
property editor on the right. The defining design constraint: **the
property editor's fields come directly from `form.config.schema.json`
itself**, via `@skye/form-config`'s `schemaIntrospection.ts` — nothing about
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
  `page-scripts/builder.ts` (`Object.keys(scriptActions)`); a value the current
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
  `@skye/form-config`'s `validateFormConfig`/`validateFormConfigOverlay`
  (`src/validation/validateConfig.ts`) wrap the identical ajv setup the CLI
  script already used (`ajv` is a real `dependencies` entry of
  `@skye/form-config`, always safe to ship into the browser). An overlay also
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
  client-side" rule doesn't apply. `page-scripts/builder.ts`'s "Or start a new
  form" section renders a `<select>`; a trailing "Other — enter a list id
  manually…" option reveals the old free-text input for a list on another
  site or one the enumeration missed, and the optional "different siteId"
  field re-enumerates that site's lists into the dropdown when changed.
- **Adding a field starts from the SharePoint column, not the control
  type.** The "+ Add field" sub-form has a **Source** `<select>`
  (`sharepoint` / `virtual`) and, for `sharepoint`, a **Bind to** `<select>`
  of the target list's live columns (`state.listColumns`). Picking a
  column auto-selects the matching `controlType`
  (`features/builder/columnMapping.ts`'s `controlTypeForColumn` — `text`→text,
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
  field binds to. A **brand-new form** is seeded with a bound, `order`-ed
  field for every one of them (`columnMapping.requiredColumnFields`, in
  `openBuilder` right after `getListColumns`) AND defaults to
  `layout: { gridTemplateColumns: 1 }` (`columnMapping.SINGLE_COLUMN_LAYOUT`)
  — a single CSS Grid column, no `gridTemplateAreas`, so the fields
  auto-stack one per row by `order` and it stays correct as the author
  adds/removes/reorders fields. (This surfaced a latent `renderForm.ts`
  bug: `renderField` always set `grid-area:<fieldKey>`, and an
  `grid-area` naming an area/line that doesn't exist collapses **every**
  such field onto one cell — so any page without a `gridTemplateAreas`
  covering all its fields overlapped, not just builder-seeded ones.
  `renderForm` now clears `grid-area` on any field the page's
  `gridTemplateAreas` doesn't name, letting it auto-place.) An **existing
  form** (base or draft view
  only — not an additive overlay) shows a "N required SharePoint columns
  have no field" panel at the top of Form settings, with per-column "Add
  field" (each landing after the last field by `order`) and an "Add all"
  button (`renderFormSettingsEditor`'s new `{ listColumns, defaultPageKey,
  requiredColumnCheck, onFieldsChanged }` options) — surfaced, not
  silently mutated, so the author decides. `mapColumn` now also captures
  Graph's `readOnly` so computed/system required columns (Created, …) are
  skipped everywhere here.

**Second pass (per explicit follow-up feedback), summarized here; full
build log in TODO §17:**

- **Access is permission-gated, not just Save-gated.** `/builder` checks
  `features/builder/permissions.ts`'s `canEditFormConfig` BEFORE rendering the
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
  `page-scripts/switcher.ts` gates the button on `(await graph.canWriteSkyeData(siteId))
  || canEditFormConfigs(configFiles)` (it already has the config files in
  hand, so it inlines the OR rather than re-fetching through
  `canEditFormConfig`).
- **Reused interactions: first "shared TS DOM-builder", later reworked
  into Astro components** — the original take was that a static-output SPA
  can't benefit from components because the *content* is runtime-decided.
  A later pass (see "Markup lives in `.astro`, JS toggles it" below)
  changed that: the *skeleton* of every screen/dialog/panel is fixed and
  CAN be authored as HTML; only visibility and a few text nodes are
  runtime. So `shared/ui/confirmDialog.ts` and `shared/ui/messagePanel.ts` now
  drive `components/ConfirmDialog.astro` (a native `<dialog>`) and
  `components/MessagePanel.astro` instead of building their own DOM, and
  the switcher's `renderSiteSwitcher`/`renderFormPicker`/… became
  `populateSitePicker`/`populateFormPicker`/… that fill
  `components/SitePicker.astro` etc.
- **Save now shows a diff before it commits.** `@skye/form-config`'s
  `computeConfigDiff` (pure, `merge/configDiff.ts`) compares the config as
  loaded/last-saved this session against the current in-memory edits,
  returning only what actually changed — per field/page/postAction:
  added/removed/changed, which properties changed, and whether a
  `visibleIf`/`when` was specifically added/removed/changed (covers both
  "made conditionally visible" and "hidden"). `features/builder/configDiffView.ts`
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
  already exported from `@skye/form-config`) before this. `features/form/validateFormValues.ts`
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
that submit. All of it lives in ONE place, `features/form/render/renderForm.ts`
itself, so `/form` (live create/edit), `/form?draft=...` (draft preview),
and `/builder`'s own live preview all get it automatically just by going
through `renderForm`/`renderBuilderPreview` — there was never a need to
wire each caller separately.

- **`renderForm` now owns validation directly**, not just rendering:
  `RenderFormOptions` gained `customValidators` (the app's real registry,
  threaded through from `page-scripts/form.ts`/`page-scripts/builder.ts`), and
  `RenderedForm` gained `validateAll(): boolean` — runs
  `validateFormValues` (native constraints + custom validators, already
  existing) over the whole form, marks every field "touched", updates
  every field's inline error, and returns overall validity. Every submit
  handler (`page-scripts/form.ts`, both the live and draft-preview paths) calls
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
- **Every rendered field is labelled and identifiable.** `renderField.ts`
  unconditionally sets `id` = the field key and `name` = `field.bindTo ||
  fieldKey` on the control, and emits an associated `<label for>` — or a
  `<legend>` for the `<fieldset>`-based group controls (`radio` /
  `checkboxGroup`), where `<label for>` doesn't associate; a group's inner
  inputs also get the shared `name`. The label text is `field.label`,
  falling back to `humanizeFieldKey` (`features/form/render/fieldLabels.ts` —
  `favouriteCampus` / `Favourite_x0020_Campus` → "Favourite Campus"), so a
  config that omits `label` still renders an accessible field rather than a
  bare, id-less input. `page-scripts/form.ts` additionally runs
  `backfillFieldLabels(merged.fields, listColumns)` (right after
  `populateChoiceOptionsFromColumns`) so a missing `label` first tries the
  bound column's `displayName` before the humanised fallback. Display-only
  / data-only controls (`heading` / `paragraph` / `divider` / `hidden`)
  are deliberately excluded — they get no `<label>` (and `hidden` gets
  `id`/`name` but no label). `columnMapping.fieldConfigForColumn` now
  always writes an explicit `label` (the column `displayName`) into a
  builder-created field.
- **`features/form/validateFormValues.ts` is unchanged in its own
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
  both packages** (up from 367 — 82 in `@skye/form-config`, 287 in
  `@skye/app`), both type-check clean, Astro production build verified.

## Auth: tenant resolution (`src/shared/auth/tenantResolver.ts`)

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
manages the tenant explicitly. See `packages/app/.env.example`.

## Real-tenant Graph permissions (IU) — what's available for actions/postActions

Tested against the actual IU tenant (app registration `d7c6a2e3-...`, `Sites.Selected`
permission model) via `pages/diag.astro`/`page-scripts/diag.ts` — see that page's own
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
(`src/integrations/outlook/`) — build the deep link (embeds a unique marker in the event
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

## Campus Labs Engage actions (`src/integrations/engage/`) — the first non-Graph service

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

The authoritative, dated record is `docs/build-log.md` (§1–§20+, newest
at the bottom). In brief, as of the last restructure:

- **Working end-to-end against the mock and jsdom/Playwright:** form
  render + validation + submit + post-actions; the `/switcher`,
  `/builder` (schema-driven, with draft/publish and a save-review diff),
  `/view` Custom Views sandbox (browser security gate green), and
  `/diag`; MSAL auth incl. single-tenant self-heal and redirect-flow
  route recovery; site provisioning into Site Assets. ~479 tests
  (`@skye/form-config` + `@skye/app`), type-check clean, Astro build of
  all pages, `test:views:browser` green.
- **Not yet done:** a real rich-text editor for `skye-richtext`,
  `attachment`-mode file uploads (needs a second MSAL scope), an ARIA
  pass on the functional components.
- **Untested against a live tenant:** everything Graph-writing —
  `searchSitesWithSkyeData`'s response-shape assumptions, the
  provisioning flow, `canWriteSkyeData`'s write probe, and auth overall
  (structurally complete, never run against real Entra/SharePoint). A
  half-filled form's values are still lost across an MSAL redirect
  round-trip (only the route is recovered).

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
pnpm test:config                      # turbo run test --filter=@skye/form-config — just @skye/form-config's 40 tests
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
