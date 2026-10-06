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
  **A `script` action doesn't have to touch a network at all** —
  `src/integrations/util/formatDateYMD.ts` ("util.formatDateYMD",
  `src/integrations/util/`) is the first purely-computational one,
  built because the templating engine (`{{namespace.path}}`) has no
  date-formatting/transform syntax of its own — a config needing a date
  reformatted (e.g. a Teams chat topic prefixed `"YYYY.MM.DD "`) has to
  compute it via an actual action, chained in with `dependsOn` +
  `{{results.x.ymd}}` same as any other. Same recipe as a
  Graph/Teams/Engage action, just with no `ctx.graphFetch`/
  `ctx.httpFetch` call inside it at all — the four-step recipe above
  still applies unchanged, "network access" was never actually a
  requirement of it.
  **`graphJson.ts`'s thrown error includes the response BODY, not just
  the status line** (`Graph request to "<path>" failed: <status>
  <statusText> — <body, truncated to 300 chars>`) — a real, live
  diagnosability gap found and fixed chasing an unexplained `/chats`
  400 (`engage/client.ts`'s `engageFetch` already did this correctly;
  `graphJson.ts` was the one helper that didn't, reporting nothing but
  a bare status code for every Graph-backed `script` action's failure).
  Graph's actual `error.code`/`error.message` lives in the body — never
  assume a bare status line is the full story when debugging one of
  these actions; read the console's full error text first.
  **That fix immediately surfaced a real bug it had been hiding**:
  `teams.createChat`'s `/chats` 400 turned out to be Graph's own
  `"Duplicate chat members is specified in the request body."` — a
  config combining several people-picker fields into one
  `memberUserIds` list (the Luddy approve button's
  `["{{fields.host}}", "{{fields.cohosts}}", "{{fields.reviewer}}"]`,
  where the reviewer field's own helpText says "pick yourself") can
  easily produce the same person twice. `createChat.ts` now
  deduplicates `memberUserIds` case-insensitively before building the
  request (keeping the first occurrence), and computes the
  `"oneOnOne"` vs `"group"` `chatType` auto-detection from the
  deduplicated count, not the raw one. Overlap between a form's
  people-picker fields is an expected, legitimate case this action
  needs to handle — not a config-authoring mistake to avoid.
  **Fixing THAT immediately surfaced a THIRD, deeper bug in the same
  chain**: the very next retry got past the dedup fix and hit a new,
  much less obvious failure — a `403` with Graph's own `"OperationFailed
  ... One or more members cannot be added to the thread roster,"`
  naming no specific id. Root cause: `{{fields.host}}` (still used in
  `memberUserIds` at that point) falls back to its SharePoint
  `personOrGroup` column's own numeric `LookupId` whenever that
  column's cached `Email` is blank — a real, common SharePoint quirk
  this file already documents elsewhere (see "People-picker values"
  above) — and a SharePoint LookupId is a COMPLETELY DIFFERENT id space
  from a Microsoft Graph user id: valid for writing a SharePoint
  `<col>LookupId`, meaningless to Graph's `/users/{id}` lookup. The
  Luddy admin config already had a field built exactly to avoid this —
  `hostEmail`, a manually-entered field whose own helpText says "the
  people picker on Metrics stores a directory ID, not an email
  address," already used for Engage's `submittedById` — but
  `memberUserIds` had never actually been switched to use it. **Fixed
  two ways**: (1) `teams.createChat` now validates every `memberUserIds`
  entry looks like a real Graph identifier (contains `@`, or matches a
  GUID) BEFORE sending, throwing a specific, actionable error naming
  the bad value if not — turning a future instance of this exact
  mistake, in ANY config, into a loud and diagnosable failure instead
  of Graph's opaque roster-rejection 403; (2) the Luddy admin config's
  3 `memberUserIds` lists (both approve branches + the deny-branch
  chat) now read `{{fields.hostEmail}}` instead of `{{fields.host}}`,
  matching what the form's own README already claimed the design was.
  **General lesson for any future config binding a people-picker field
  into something that needs a Graph user identifier (Teams chat
  members, `sendMail` recipients, etc.)**: don't trust a SharePoint
  `personOrGroup` field's own value for this — its Email can be blank
  and its id-shaped fallback is SharePoint-internal, not Graph-
  compatible. Bind to a field guaranteed to carry a real email/UPN
  instead (a manually-entered email field, like `hostEmail` here).
  **Superseded for `cohosts` by a systemic fix, since the
  "add a manual workaround field" pattern doesn't scale to a
  multi-value field**: the VERY NEXT retry hit the exact same failure
  mode again, this time on a cohost (`"1012"`) — `hostEmail` only
  covers the single `host` field, and there's no equivalent manual
  field a multi-value `cohosts` picker could be swapped for. Asked the
  user how to close this gap for good; they chose resolving a real
  email via an extra Graph lookup over either a new manual field or
  dropping cohosts from the chat. **`GraphClient.resolveSiteUserEmail(
  siteId, lookupId)`** (new — `graphClient.ts`, mirrors
  `resolveSiteUserId`'s own existing User Information List lookup, just
  inverted: given the numeric id, fetches that list item directly and
  pulls a usable email out of `EMail` first, then `UserName` if
  email-shaped, then `Name`'s claims-login format
  (`i:0#.f|membership|<upn>`) — the same three fields
  `resolveSiteUserId`'s own matching logic already treats as reliable,
  so trusting them here is consistent, not a new assumption). New
  **`features/form/submit/backfillPersonEmails.ts`** (pure except for
  an injected `resolveEmail` callback, matching
  `mapSharePointFieldsToValues.ts`'s own no-Graph-access contract) walks
  every peoplePicker field's seeded value and, for any entry with a
  blank/missing `Email`, resolves and fills one in — called from
  `page-scripts/form.ts` right after `mapSharePointFieldsToValues`, so
  by the time ANY downstream code (`personIdentifier`, a button's
  `{{fields.x}}` templating, `teams.createChat`'s own validation) sees
  the value, it already has a real Graph-compatible email whenever one
  exists. Mocked in `MockGraphClient` as the inverse of its own existing
  `resolveSiteUserId` fixture-derived numbering. This is now the primary
  fix for the whole class of bug; `hostEmail` stays in the Luddy config
  (unaffected, not reverted) since it's also still needed for Engage's
  `submittedById` and remains a reasonable belt-and-braces override for
  the one field it covers.
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
  **Real bug, found and fixed against a live tenant**: `findSiteAssetsListId`
  (the 3-tier fallback above) had been committed with its actual body
  commented out and stubbed to `return null`, plus leftover debug
  `console.log`s in `resolveSiteAssetsDrive` — a leftover from an earlier
  live-debugging pass against this exact code that was never restored. On
  a tenant/site where the fast-path `$filter` query doesn't surface the
  Site Assets list, this made `resolveSiteAssetsDrive` unconditionally
  return `null`, so `skyeItemPath` threw `SkyeNotConfiguredError` even
  when `skye_data/config/skye.config.json` genuinely existed and was
  reachable — a misleading "SKYE isn't set up here" error on a site that
  actually was set up. Invisible to the test suite because `mockGraphClient.ts`
  doesn't implement (or need) this Graph-specific list-resolution dance at
  all, so it could only ever surface against a real tenant — exactly the
  gap this file's "Untested against a live tenant" note already flagged.
  Fixed by restoring the real fallback body and removing the debug logs;
  no behavior change from what this section already documented as the
  intended 3-tier resolution.
  **A second, deeper layer of the same bug class, found when the first
  fix alone didn't resolve a live repro**: `siteAssetsDriveId`'s session
  cache wrapped `resolveSiteAssetsDrive(siteId)` in a blanket
  `.catch(() => null)` — so even with the fallback tiers genuinely
  restored, a REAL Graph error hit while resolving the drive (403
  Forbidden because this app's per-site `Sites.Selected` grant doesn't
  cover that site, a network failure, a 500 — anything that isn't the
  400/404 "this particular list truly doesn't exist" shape the tiers
  already special-case) got silently collapsed into `null` too, which
  `skyeItemPath` then reported as the exact same misleading
  `SkyeNotConfiguredError`. `hasSkyeConfig` right below it already had
  the correct pattern for this ("a 403 here is a real access problem,
  not 'no config' — let it surface") — `siteAssetsDriveId` just didn't
  follow it. Fixed by dropping that blanket catch so a real error
  propagates all the way to the console (`form.ts`'s `main().catch`
  already logs the full error object) instead of being reported as "not
  set up"; `installSkyeSiteConfig`'s own direct call site
  (`siteAssetsDriveId` isn't only reached via `skyeItemPath`) now wraps
  the call itself and converts a 403 into its existing
  `SkyeInstallError("forbidden", …)` path, matching how every other
  error in that function is already handled — `hasSkyeConfig` needed no
  change, since it already let a driveId-resolution error propagate
  the same way. **If you hit `SkyeNotConfiguredError` again after this
  fix, check the browser console for the real underlying error it now
  surfaces** — most likely a 403 meaning this app's `Sites.Selected`
  grant hasn't been extended to cover that specific site yet (a
  per-site grant, not tenant-wide — see "Real-tenant Graph permissions"
  below), not a genuinely-missing Site Assets library.
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

## Date/time values: Graph always returns UTC; a `date`/`datetime-local` control always needs local time

**A real live-tenant bug, found from a user report**: `/form` showed the
wrong time for an existing item's `dateTime` field — an event entered as
18:00 (America/Indiana/Indianapolis, EDT/UTC-4) displayed back as 22:00
in edit/view mode, while the Custom Views calendar showed the correct
18:00 for the exact same stored item. Root cause:
`mapSharePointFieldsToValues.ts`'s `trimDateForControl` (the function
that seeds an edit/view-mode form's `date`/`datetime-local` inputs from a
loaded item's raw Graph `fields`) just regex-sliced the UTC digits
straight out of Graph's ISO string (`"2026-10-01T22:00:00Z"` →
`"2026-10-01T22:00"`) and dropped them into the control unconverted — a
`datetime-local` control always interprets whatever string it's given as
the viewer's OWN local wall-clock time, so the raw UTC hour showed up as
if it were already local. The Custom Views calendar
(`skye_data/views/*/view.html`) never had this bug, because it always
parses with `new Date(f.StartTime)` and reads back local components for
display — exactly the fix applied here too: `trimDateForControl` now
does `new Date(value)` and builds the control's string from that `Date`
object's LOCAL getters (`getFullYear`/`getMonth`/`getDate`/`getHours`/
`getMinutes`), which is the real UTC→local conversion, not a string
slice. 1 test in `mapSharePointFieldsToValues.test.ts` pins `TZ =
"America/Indiana/Indianapolis"` for the exact live repro (22:00 UTC must
show as 18:00, not 22:00) — scoped with `afterEach` restoring the
original `process.env.TZ` immediately, since `vitest.config.ts`'s `pool:
"threads"` (see "Toolchain versions") shares one process across test
files, so an unrestored env mutation here could otherwise leak into
unrelated files.

**The write side (`encodeSharePointFields.ts`) was NOT touched, and
appears to already be correct** — it passes a `datetime-local` input's
raw local-time string straight through to Graph with no explicit
timezone conversion of its own, and yet the stored value round-trips
correctly (confirmed: the calendar view, reading the same stored UTC
value, already showed the right local time). This is Graph/SharePoint's
own server-side behavior: a `dateTime` column written without an
explicit offset is evidently interpreted using the SharePoint site's
regional-settings timezone, not assumed-UTC, and converted to UTC for
storage from there — not something this app's code does explicitly. This
is implicit, Graph-side behavior this app currently just relies on
rather than controls; if a site's regional timezone setting is ever
unset/wrong, or just doesn't match viewers' actual local timezone, write
could silently drift the same way read used to — flagged here as a
known, unverified assumption rather than something being "fixed" without
evidence it's actually broken.

## People-picker values: an untouched edit-mode chip must still resolve, not just a freshly-picked one

**A real live-tenant bug, found from a user report with a screenshot**:
editing an EXISTING item and submitting WITHOUT touching its Host/Cohosts
people-picker field failed with "`<name>` is not a member of this site"
— for a host who plainly, actually was a member — with the Cohosts field
showing an even more obviously-broken `"[object Object] is not a member
of this site"`. Re-picking the exact same person from the search dropdown
and submitting again worked. Two independent, compounding bugs, both
rooted in the same gap: SKYE's own `skye-people-picker`'s `.value`
getter returns whatever raw shape it was last SET to — a user re-picking
a person calls `commit()`, which writes a clean `string[]` of resolvable
keys (email, or a numeric LookupId `graph.resolveSiteUserId`'s own fast
path already special-cases — see that method's own comment), but an
UNTOUCHED edit-mode field's `.value` is still exactly whatever raw Graph
shape `mapSharePointFieldsToValues` originally seeded it with, since
nothing ever called `commit()` on it.

- **Bug 1 — `checkPersonFieldsResolve.ts` (the pre-submit "is this still
  a site member" gate) and `encodeSharePointFields.ts`'s `personOrGroup`
  write branch both did a naive `.map(String)`** on whatever
  `values[fieldKey]` held, instead of extracting a resolvable identifier
  from it. A raw SharePoint person object stringifies to literally
  `"[object Object]"` (Cohosts, a multi-value column — Graph always
  returns these as an array of full `{LookupId, LookupValue, Email}`
  objects), which obviously can't resolve. **Fix**: a new shared
  `features/form/submit/personIdentifier.ts` — `personIdentifier(entry)`
  extracts email, then numeric `LookupId`, then a generic `id`, mirroring
  the SAME priority `registerElements.ts`'s `normalisePeopleValue`
  already used for chip rendering (the two had drifted: one did this
  correctly for DISPLAY, the other did it naively for RESOLUTION) — now
  reused by all three call sites (`checkPersonFieldsResolve.ts`,
  `encodeSharePointFields.ts`, and `normalisePeopleValue` itself), so
  they can't drift apart again. Along the way, fixed a second, subtler
  bug this surfaced: the priority chain used `??`, which does NOT skip a
  PRESENT-but-blank string — and `graphClient.ts`'s own
  `doResolveSiteUserId` comment already documents that `EMail` is "often
  blank (it's only filled once the user has actually visited
  SharePoint)" on this exact tenant. `personIdentifier` now explicitly
  skips an empty-string candidate and falls through to the next one
  (e.g. `LookupId`) instead of returning `""`.
- **Bug 2 — `mapSharePointFieldsToValues.ts`'s own doc comment had been
  WRONG about what Graph actually returns** for a SINGLE-value
  `personOrGroup` column: it assumed Graph always gives the full
  `{LookupId, LookupValue}` object once the column is in `$select` (true
  for a MULTI-value column), but a real tenant response instead gave
  just the bare display-name STRING under `Host` (`"Cloteaux, Lison"`) —
  with NO `LookupId`/`Email` anywhere on it, even though
  `selectColumnsForEditPrefill` already separately selects
  `HostLookupId` alongside it. No amount of fixing Bug 1 alone could
  recover from this — the resolvable id was never attached to `values`
  in the first place. **Fix**: `mapSharePointFieldsToValues` now rebuilds
  a bare-string single-value person into `{LookupId, LookupValue: <the
  string>}` using that separately-selected `<bindTo>LookupId` companion,
  the same shape the multi-value case already naturally has — so Bug 1's
  fix has something resolvable to extract from either shape.
- **4 new tests** reproduce the exact live repro values (`"Cloteaux,
  Lison"` / `"Weyandt, Carley Jane"`, an empty-string `Email`) across
  `checkPersonFields.test.ts`, `encodeSharePointFields.test.ts` (×1 each,
  the untouched-value resolves-correctly case), and
  `mapSharePointFieldsToValues.test.ts` (×2 — the bare-string rebuild,
  and the "no LookupId companion at all -> left alone" edge case). Both
  test files' `GraphClient` stubs were also fixed to mirror the real
  client's own numeric-identifier fast path (previously only modeled a
  known-email map, which doesn't reflect how an edit-mode LookupId
  actually resolves).

**None of the above was actually the full fix — the real root cause
was one layer deeper, in `renderForm.ts` itself, found only after a
LATER live retry still failed** (a button's `{{fields.host}}` action
templating threw `TypeError: id.toLowerCase is not a function` on an
untouched field, even after every fix above). `renderForm.ts`'s
`getValues()` doesn't read live `.value` off each control at all — it
returns a snapshot of an internal `values` cache, refreshed only on an
explicit `skye-change` event (the user interacting with that field) or
`setFieldValue`. The edit-mode seeding loop set this cache directly
from the RAW seed (`values[fieldKey] = value`) and separately pushed
that same raw value onto the control via `writeControlValue` — so the
control's own internal state became correctly normalised (and its
`.value` getter, per the fix above, would report it correctly if read
directly), but the CACHE kept the raw shape forever, completely
bypassing every normalisation fix above, until the user happened to
re-pick the same person and trigger a `skye-change` event. This is
exactly why the ORIGINAL report was "if you re-enter the names again it
works" — every fix up to this point addressed real bugs in HOW a value
gets normalised once read, but missed that `getValues()` — what
`checkPersonFieldsResolve`/the submit encoder/a button's own
`{{fields.x}}` templating ALL actually call — reads the cache, not the
control. **Fix**: the seeding loop now calls `writeControlValue` first,
then — for a CUSTOM element specifically (`tagName.includes("-")`,
matching `writeControlValue`'s own existing distinction) — reads the
control's value BACK via `readControlValue` and stores THAT in the
cache, instead of the raw seed. Deliberately scoped to custom elements
only: blindly doing this for a plain native `<input>` would silently
turn a cached Number/Currency column's JS number into a string
(`.value` on a native input is always a string) — a real regression
risk caught before it shipped. `file` fields are unaffected (unchanged,
pre-existing special case — see `RenderFormOptions.filePreviews`'s own
doc comment). 2 new tests in `renderForm.test.ts`. **Lesson for next
time a "stale until re-interacted" bug shows up**: check whether a
value is read from a live control getter or from `renderForm.ts`'s own
`values` cache first — the cache, not the control, is what most real
callers actually see.

## `/form`'s top-of-page nav: Back / Edit Entry / Edit Form in Builder

Three independent `<a>` links in `pages/form.astro`'s `<nav data-slot="form-nav">`, each shown
only when it applies — no single "nav bar" concept to toggle as a whole, just three conditions
wired separately in `page-scripts/form.ts`:

- **`data-el="back-link"`** ("← Back") — shown only when the merged `FormConfig` sets
  `backView: "<a skye_data/views/ id>"`, a new top-level schema property (both
  `form.config.schema.json` and the overlay schema — overlay behaves like `title`: a plain scalar,
  last-wins). Links to `buildViewUrl(...)`. Omitted (not just hidden) when a form has no
  `backView` set — there's no generic "previous page" to fall back to, since `/form` can be
  reached directly (a shared link, a bookmark) with nothing meaningful in browser history.
- **`data-el="edit-entry-link"`** ("Edit Entry") — shown only in `route.mode === "view"`, linking
  to the same item in edit mode (`buildFormUrl(..., "edit", route.itemId)`). Not permission-gated
  at the app level, same reasoning as everywhere else in this repo: SharePoint's own ACLs decide
  whether the edit actually succeeds, this is just a navigation shortcut.
- **`data-el="edit-builder-link"`** ("Edit Form in Builder") — the pre-existing "Edit in Builder"
  link (renamed from `data-el="edit-link"` for consistency with the two new ones above, both
  `.astro`/`.ts`/`astroMarkupHooks.test.ts` updated together), unchanged logic: only for a
  signed-in user `canEditFormConfig` says can actually edit this site's form configs (a real site
  owner/editor check, not everyone), and never shown for a draft preview.

**Builder support for `backView` follows this repo's established "surface real selectable data,
don't make an author hand-type an id" rule** (same reasoning as the list/script-action pickers
elsewhere in the builder): `formSettingsEditor.ts`'s new `renderBackViewControl(views)` renders a
`<select>` of the site's REAL Custom Views (`graph.listSkyeViews(siteId)`, fetched once into
`BuilderState.skyeViews` alongside `listColumns`, threaded through `renderFormSettingsEditor`'s
existing `options` pattern — the exact same shape `scriptActionNames`/`listColumns` already use)
instead of a free-text box for a view id nobody should need to memorize. Falls back to the
generic free-text control when the site has no Custom Views yet (an empty dropdown would be
worse than a text box); a current `backView` value the listing doesn't contain (a deleted view,
or one on another site) is shown flagged `"<id> (not found)"` rather than silently dropped, same
pattern as an unregistered `functionName`. No extra wiring needed beyond that one override —
`backView` is a plain top-level schema property, so `getFormTopLevelProperties()` already surfaces
it in the settings editor automatically.

**A real, live bug: the post-submit splash screen's "Fill out another
response" link could silently do nothing.** After a CREATE-mode submit,
the address bar stays on `#formId/new` forever — the splash screen
(`showSubmittedSplash`) is purely a JS state swap; nothing ever
navigates. "Fill out another response" ALSO targets `#formId/new` —
so clicking it from a page whose hash is ALREADY `#formId/new` isn't a
navigation at all from the browser's own perspective: the hash genuinely
isn't changing, so not even a `hashchange` event fires, and this file's
own `hashchange` -> `reload()` mechanism (see the top of this file) never
gets a chance to run. It looked like the link did nothing because by that
point it truly had nothing left to do. **Fix, two parts**:
1. `showSubmittedSplash` now calls `history.replaceState(...)` to point
   the address bar at the just-saved item in view mode (the same URL
   "View submitted response" already links to) — more accurate anyway
   (the user really is now looking at a saved item, not "still on the
   create screen"), and makes "Fill out another response"'s target a
   genuinely different hash again.
2. That alone only moves the bug onto "View submitted response" (now
   THAT link can coincide with the just-replaced URL) — so a new
   `forceReloadIfAlreadyThere(link)` helper is attached to BOTH splash
   links unconditionally: on click, if `link.href === window.location.href`
   (the one case a plain `<a>` click can never produce a real navigation),
   it `preventDefault()`s and calls `window.location.reload()` directly,
   bypassing the `hashchange` mechanism entirely since it's already known
   not to fire. Scoped to just these two links — none of the three nav
   links above can ever coincide with the current URL (`/view`/`/builder`
   are different pages entirely; "Edit Entry"'s hash never matches
   view mode's own), so they don't need the same guard.

**"Back" also shows on the post-submit splash screen, not just the live
form.** `showState` hides `#screen-form` (and the top-of-page nav living
inside it, including "Back") completely when `#screen-submitted` takes
over — the original `back-link` element doesn't just scroll out of view,
it's genuinely gone from the visible DOM. A second `data-el=
"submitted-back-link"` lives inside `#screen-submitted`'s own
`.skye-form__submitted-actions` (alongside "Fill out another response"/
"View submitted response", same `.skye-form__submitted-action` styling
class, so it's visually consistent for free) and `showSubmittedSplash`
wires it with the identical `buildViewUrl(..., merged.backView)` href the
main nav's own back-link uses. One real gotcha hit building this: TS
doesn't carry an outer `const`'s property-narrowing (`if (merged.backView)`)
into a NESTED function body at all — `showSubmittedSplash` needed its own
local `const backView = merged.backView;` before the `if`, same reason
`route.siteId`/`route.applicationId` are read through the function's
OWN already-destructured `siteId`/`applicationId` locals (see that
function's own top-of-file comment) rather than `route.*` directly —
using `route.*` inside this specific nested function silently fails the
EXACT same way, a mistake made and caught by `tsc` while building this.

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
  via `innerHTML`/`textContent`/`AsyncFunction`. `view.css`/`view.js` are both
  optional now (`RealGraphClient.getSkyeViewFiles`) — an author can write a
  single `view.html` with its own `<style>`/`<script>` instead of three
  files. This doesn't weaken the invariant above: a `<script>` element
  `innerHTML` inserts is permanently inert per the DOM spec regardless (true
  on any web page, not a SKYE rule), so `view-runtime.js`'s `mount()` just
  pulls that already-dead text back out and runs it through the exact same
  `AsyncFunction` call a separate `view.js` already used — no new execution
  path, just a second source for the one that existed. A `<style>` element
  `innerHTML` inserts already takes effect on its own (unlike `<script>`),
  so that half needed no code change at all.
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

## Button fields (`controlType: "button"`) — a field with its own action chain

A form field can be a real `<button>` that runs its own, self-contained
flow of actions on click — the same postAction engine/action-type
vocabulary (`httpRequest`/`graphRequest`/`redirect`/`showMessage`/
`setField`/`script`, `dependsOn` waves, `{{fields.x}}`/`{{item.x}}`/
`{{results.x}}` templating) the form-root `postActions` dict already
uses for submit-lifecycle phases, just scoped to one field instead of a
form-wide trigger. Not a variant of Submit — no SharePoint primary-item
write happens automatically; an action that needs to write somewhere
(`graphRequest`/`script`) does it itself, exactly like a postAction
already can, with no restriction on it touching the primary item's own
list (a "quick approve" button that PATCHes `Status` directly, separate
from a full Submit, is an intended, supported use).

- **`field.actions: Record<string, PostAction>`** — required when
  `controlType` is `"button"` (`source: "virtual"` is required too, same
  as `heading`/`paragraph`/`divider`). Every entry is authored with
  `trigger: "onClick"` — a real, schema-valid `PostActionTrigger` value
  (not a form-submit phase), and the one thing
  `src/features/form/submit/runButtonActions.ts` (in `@skye/app`) filters
  by when it calls the exact same `runTriggerPhase()` engine function
  `submitForm.ts` uses. `dependsOn` is scoped to this one
  field's own `actions` dict only — a button's actions never depend on,
  or get depended on by, the form-root `postActions` or another button's
  actions.
- **`field.validate?: boolean`** (default `true`) — whether clicking
  requires `rendered.validateAll()` to pass first, same check Submit
  already runs, before this button's actions run. Set `false` for a
  button whose actions don't depend on the rest of the form being valid
  yet (e.g. a "test this webhook" button).
- **`field.confirm?: { title: string; body: string }`** — optional
  "are you sure?" gate before the actions run, reusing the same
  `showConfirmDialog` component the draft-preview submit gate already
  uses. Omitted means the actions run immediately on click.
- **Wired in `page-scripts/form.ts`, not `renderForm.ts`** — same split
  as `submitButton` (`renderForm.ts`'s own doc comment: "entry-form.ts
  attaches its own click handler; renderForm doesn't know about
  Graph/postActions"). `renderForm()` returns `buttons: Record<fieldKey,
  {button, statusEl, field}>`; `form.ts` wires each one's click →
  validate (if `field.validate !== false`) → confirm (if `field.confirm`)
  → `runButtonActions()`, with `showMessage` routed to that button's own
  `statusEl` (an `<output>` beside the button — `renderField.ts`'s
  `buttonStatusEl`) so multiple buttons on one form never stomp on each
  other's status text.
- **`{{item.x}}` uses the same shape submitForm.ts's postActions already
  give** — real SharePoint column names (`item.Title`, not
  `item.eventTitle`), id first, built once in `form.ts` from the loaded
  edit-mode item's raw `fields` (not the field-key-mapped
  `initialValues`) — `{}` in create mode, where there's genuinely no item
  yet, matching `beforeSubmit`'s own item context.
- **Stays clickable in view mode, unlike every other control.** `view`
  mode force-sets every OTHER field's `readonly` (an app-level render
  flag, not a schema concept — see this file's own TODO §3 note), but
  `controlType: "button"` is deliberately excluded from that loop:
  `readonly` protects a *value* from being changed, which a button
  doesn't have, and a button's whole point can be a "quick action" a
  viewer takes without switching to edit mode (an approver clicking
  "Approve" while just viewing an item). `fieldRegistry.ts`'s `button`
  entry doesn't read `field.readonly` at all for this reason.
- **Builder support**: `getFieldSchemaProperties()` already includes
  `actions`/`validate`/`confirm` for every field's editor, the same way
  `table`/`fileStorage`/`calculatedDisplay` already do for THEIR
  controlTypes (plain top-level `field` properties, not gated behind an
  `allOf` discriminator) — `"button"` is picked up automatically by the
  `+ Add field` controlType dropdown too, since that list is derived
  straight from the schema's `controlType` enum
  (`page-scripts/builder.ts`'s `CONTROL_TYPES`). `features/builder/fieldEditor.ts`
  overrides `actions` specifically for `controlType: "button"` (falls
  through to the generic presence-toggled dictionary editor for every
  other controlType, same as an unused `fileStorage`/`table` already
  does) with `features/builder/buttonActionsEditor.ts` — a parallel,
  simplified version of `formSettingsEditor.ts`'s wave-grouped Post
  Actions editor, reusing its exported `computeWaves`/
  `renderFunctionNameControl` directly, minus the 4-way trigger-phase
  grouping (a button has exactly one implicit "phase": its own click, so
  every entry in its `actions` dict is already scoped to it by
  construction — no phase to choose or move between, and `trigger` is
  fixed, never shown as an editable control). The live preview
  (`builderPreview.ts`) needs no special handling at all: it never wires
  button click behavior (only the real `form.ts` does), and its existing
  root-level delegated click listener (every rendered control has
  `data-field-key`) already treats a button click as "select this field
  for editing," the same as clicking any other field — exactly the right
  behavior, for free.
- **Templating gained array-spreading**, motivated by a real button
  config (Luddy LLC's Approve Event, below) needing to pass a
  multi-value `peoplePicker` field into a Teams `memberUserIds: string[]`
  array. Every `peoplePicker` field's value is `string[]` — even a
  single-person one is a 1-element array — so `{{fields.cohosts}}` as a
  plain array element used to `String()`-coerce into one broken
  comma-joined entry (`"a@iu.edu,b@iu.edu"`), not two real ones.
  `@skye/form-config`'s `interpolate()` (`post-actions/templating.ts`)
  now special-cases an array element that is EXACTLY one whole
  `{{namespace.path}}` placeholder (nothing else around it): if it
  resolves to an array, that array is SPREAD into the parent array's
  positions instead of stringified. Scoped narrowly — only inside
  `interpolate`'s array-mapping case, not a general "placeholder
  preserves type" change to scalar values elsewhere (e.g. `request.body`
  string properties are unaffected, still always coerce to a JSON
  string) — so this doesn't change behavior for the many existing
  postActions that reference a scalar field. A placeholder embedded in a
  larger string (`"Cohosts: {{fields.cohosts}}"`) still stringifies the
  old way, since spreading only makes sense for a value occupying its
  own array slot.
- **A design trap found (and fixed) building the Luddy LLC approve
  button, worth remembering for any future branching action chain**:
  `runIfDependencySkipped: true` can't tell "this dependency was
  genuinely skipped because a sibling branch ran instead" apart from
  "this dependency's own ancestor failed" — both show up as `"skipped"`
  by the time a cascade reaches a downstream action several steps later.
  A mutually-exclusive pair (e.g. create-vs-update, gated by opposite
  `when` conditions) that shares ONE downstream chain via
  `runIfDependencySkipped: true` will happily run that downstream chain
  even when the ACTIVE branch genuinely failed, not just when the
  INACTIVE branch was cleanly skipped — caught by a test that
  specifically failed the active branch and asserted nothing downstream
  ran. The fix: don't share the downstream chain at all — give each
  branch its OWN fully independent set of downstream actions (more
  actions in the config, but each one's `dependsOn` has no override
  flag, so it only ever runs if every action in ITS OWN branch
  genuinely ran, cascading correctly through skip AND failure alike).
- **`field.alwaysEditable?: boolean`** (default `false`) — keeps this
  ONE field editable even when the whole form is in view mode, which
  otherwise force-readonlys every field except `controlType: "button"`
  (`page-scripts/form.ts`'s own loop, right above where it excludes
  buttons). Real bug found testing the Luddy approve button live: its
  `hostEmail`/`reviewer` fields exist ONLY to feed the button's own
  `actions` on click (the host's email for `submittedById`, the
  reviewer's id for the Teams chat's `memberUserIds`) — never persisted
  themselves — so an approver needs to type/pick them while otherwise
  just VIEWING the record, exactly the situation `controlType: "button"`
  was already excluded from view-mode readonly for. Without this flag,
  the view-mode loop force-readonlys these two plain
  `text`/`peoplePicker` fields right alongside every genuinely
  view-protected field, silently blocking the approve flow before the
  button's own click handler ever runs (`renderField.ts`/`fieldRegistry.ts`
  don't distinguish "protects a saved value" from "feeds a button's own
  action chain" for a non-button control — this flag is that
  distinction, made explicit per-field rather than inferred). Set on
  both fields in `skye_data/forms/luddy-llc-event-proposal/admin/form.config.json`.
- **A custom element's `.value` must ALWAYS return something every
  caller can safely use, not whatever raw shape it was last SET to.**
  Two more real bugs found testing the Luddy approve button live, both
  rooted in the exact same gap: `skye-people-picker`'s `.value` getter
  used to just return `this._value` (inherited from the base
  `SkyeValueElement`) — the raw value it was last assigned, which for an
  UNTOUCHED edit-mode field is still the raw SharePoint shape
  `mapSharePointFieldsToValues` seeded it with (an object or array of
  objects), not the clean `string[]` of resolvable keys a picker
  normally produces once a person is actually re-picked. A button's own
  `{{fields.x}}` action templating (`runButtonActions.ts` reads
  `rendered.getValues()` directly, with NO normalisation layer of its
  own — unlike `submitForm`'s pipeline, which now runs everything
  through `personIdentifier`, see "People-picker values" above) is
  exactly such a caller: the approve button's `teams.createChat` action
  template-stringified an untouched Host/Cohosts value straight into a
  Graph `user@odata.bind` URL as literal `"[object Object]"`, which
  Graph correctly rejected with `400 Bad Request`. **Fix**:
  `SkyePeoplePicker` now overrides BOTH `get value()` (always returns
  `this.picked.map(p => p.key)`, never the raw `_value`) and `set
  value()` (a subclass defining only `get value()` silently shadows the
  base class's `set value()` too — JS accessor pairs are one property
  descriptor; assigning `.value = x` would then throw in strict mode,
  which ES modules always are — so both had to be overridden together).
  Finding this led to a SECOND bug in the same class: `render()` had its
  own "re-sync `picked` from an externally-set `_value`" heuristic that
  compared `picked`'s keys against `_value` TREATED as an array of
  strings — which silently failed to resync for a non-array single-value
  seed (e.g. Host's raw object, not wrapped in an array) landing on an
  already-empty `picked`: `arraysShallowEqual([], [])` came back "equal"
  even though the value was never actually normalised, so `.value` kept
  returning `[]`. Fixed by having the new `set value()` override
  recompute `picked` directly and unconditionally (`this.picked =
  normalisePeopleValue(v)`) instead of relying on that heuristic at all
  — removed the now-dead `arraysShallowEqual` helper entirely rather
  than leaving an unused, previously-wrong function around.
- **A button action that writes the primary item changes its etag
  OUTSIDE `submitForm`'s own etag-aware path — a later Submit click must
  pick that up, or it 412s against a now-stale etag.** A third real bug
  found in the same live test: after the approve button's
  `saveApprovalFieldsFromCreate` action (a `graphRequest` PATCH straight
  to the item's `/fields`, with no `If-Match` of its own — see "Button
  fields" above: "no restriction on it touching the primary item's own
  list") succeeded, clicking the regular Submit button afterward failed
  with `EtagConflictError` ("Someone else changed this item since you
  opened it") — even though the only "someone else" was this same
  button's own earlier write; `editEtag`/`itemForTemplates` were only
  ever set once, at initial page load. **Fix, in `page-scripts/form.ts`'s
  button-click handler**: after `runButtonActions` resolves, if
  `route.itemId` is set, re-fetch the item (same `selectColumnsForEditPrefill`
  select as the initial load) and refresh both `editEtag` and
  `itemForTemplates` in place — deliberately UNCONDITIONAL (not gated on
  the button's overall result being error-free), since a button's
  actions run in `dependsOn` order and an EARLIER action's write (the
  item PATCH) can have already landed before a LATER, unrelated action
  in the same chain fails (exactly what happened here: the PATCH
  succeeded, then `openApprovalChatFromCreate`'s Teams-chat creation
  failed on the `[object Object]` bug above, which is what the user
  actually saw first). Generic, not Luddy-specific — any future button
  whose actions write the primary item gets this for free. Best-effort:
  a failure refetching is swallowed, so a later Submit surfaces its own
  etag/network error rather than this silently eating the button's
  actual result.

## `_server/` — the BeInvolved (Campus Labs Engage) proxy Worker

A **standalone Cloudflare Worker**, not part of this repo's pnpm
workspace (`pnpm-workspace.yaml`'s `packages: - "packages/*"` glob
doesn't match it) and **gitignored at the repo root** (same treatment as
`skye_data`) — it has its own release lifecycle, independent of the
Astro app, and would otherwise carry environment-specific values best
kept out of this repo's git history. Its own `README.md` is the source
of truth for setup/deploy/trust-model details; this entry is a pointer
so a future session knows it exists and why, even though its source
isn't in git.

**What it's for**: SKYE's browser-side `engage.*` script actions
(`packages/app/src/integrations/engage/`) currently call the real
Engage API directly, with `apiKey` as an OPTIONAL config-supplied field
(see "Campus Labs Engage actions" above) — this Worker is the
"whitelabeled deployments route through a middleman/proxy that injects
the real key itself server-side" case that comment already anticipated,
now actually built. It's a **transparent, drop-in proxy**: it exposes
the exact same 8 real Engage paths those 8 actions already call
(`createEvent`/`updateEvent`/`cancelEvent`/`rsvpToEvent`/`updateRsvp`/
`recordAttendance`/`updateAttendance`/`deleteAttendance`), gated, with
the real `X-Engage-Api-Key` injected server-side — pointing a config's
`baseUrl` at this Worker instead of the real Engage host needs zero
other client-side changes, since the client actions already build those
exact paths. Deliberately NOT a generic "forward any Engage path"
proxy — an unmatched path 404s before ever reaching Engage, so a gate
bug only ever exposes these 8 reviewed operations.

**Gate**: every request must carry an `X-Skye-Organization-Id` header,
checked against a deployment-configured allowlist — **client-declared,
not independently verified** against a live Engage lookup (a deliberate
choice, confirmed before writing any code: the only intended callers
are SKYE's own reviewed script actions, not arbitrary user input, so
this is an access-control boundary for "which deployment/org may use
this proxy at all," not a defense against an already-trusted caller
lying about which event it's touching — see the Worker's own README for
what upgrading to a verified lookup would involve if that trust model
ever needs tightening). Event CREATION gets a second, independent check
on top of the header, since that's the one route whose real Engage body
carries its own `submittedByOrganizationId`/`organizationIds`.

**Client-side wiring is done**: every `engage.*` action's options
interface (`packages/app/src/integrations/engage/*.ts`) now accepts an
`organizationId?: number`, threaded through to `engageFetch`
(`client.ts`), which sends it as `X-Skye-Organization-Id` only when
supplied — omitted entirely (not sent as empty/undefined) when calling
the real Engage API directly with a real `apiKey` instead of through
this proxy, so existing direct-call configs are unaffected.

**Deployed** at
`https://skye-beinvolved-proxy.agua-melaza-0h.workers.dev` (same
Cloudflare account as the reference implementation this replaces).
`skye_data/forms/luddy-llc-event-proposal/admin/form.config.json`'s
"Approve Event" button (§39) now points its `createBeInvolvedEvent`/
`updateBeInvolvedEvent` actions at this URL with `organizationId: 388096`
— which also surfaced and fixed a real placeholder: that config's
`submittedByOrganizationId` had been a literal `0` (the README's own
"Fill in the placeholders" table flagged this as still-unset), and the
reference Worker's own hardcoded allowlist (`388096`/`186922`, labeled
"LLC and ResLife" in its own comment) confirmed `388096` as the real
Luddy LLC organization id — now fixed to the real value, not a guess
pulled from nowhere.

Replaces an earlier ad-hoc Cloudflare Worker that used to live entirely
outside this repo (same core idea — an org-id-gated proxy injecting the
API key — for just 2 hardcoded Engage paths); this version covers all 8
`engage.*` operations, has real tests (`_server/test/`, plain
Node-environment vitest calling the Worker's `fetch(request, env)`
handler directly with a stubbed outbound `fetch`, not a full
`@cloudflare/vitest-pool-workers` Workers-runtime harness — a deliberate
effort/coverage tradeoff, not an oversight), and never hardcodes the
real API key in source (a Worker *secret*, `wrangler secret put`).

**A real live bug found testing the Luddy approve button end-to-end**:
calling this proxy from `pnpm dev` (`http://localhost:4321`) failed as a
bare `TypeError: Failed to fetch` with zero CORS wording anywhere in the
console — that's simply what a browser's `fetch()` reports for any
response missing an `Access-Control-Allow-Origin` header (`cors.ts`'s
own doc comment already explains why: an unrecognized origin gets no
CORS header at all, so the browser blocks the response client-side,
same effective result as a 403 but with none of a 403's diagnostic
detail). Root cause: `wrangler.toml`'s `ALLOWED_ORIGINS` only listed the
production SharePoint origin. Fixed by adding
`http://localhost:4321` to the allowlist (`_server/wrangler.toml`) —
**requires a `wrangler deploy` to take effect on the live Worker**, not
just this file edit; not yet deployed as of this note. If a `script`
action calling this proxy ever fails as a generic "Failed to fetch"
again, check `ALLOWED_ORIGINS` first.

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

**A silent-acquisition `timed_out` no longer dead-ends the whole
sign-in — a real live-tenant bug, found right after the two
`skyeItemPath` fixes above turned out not to be the user's actual
problem.** `authProvider.ts`'s `initAndTrySilent` only ever fell through
to interactive (popup/redirect) when `acquireTokenSilent` threw
`InteractionRequiredAuthError` — the clean "silent genuinely can't
satisfy this" signal. But `acquireTokenSilent`'s fallback path opens a
hidden iframe to the authority and waits for a response, and that
iframe can simply never complete (a slow network, or — increasingly
common on browsers restricting third-party cookies, e.g. Safari ITP /
Chrome's phase-out — the authority's own session cookie being
unreadable inside the iframe at all) without MSAL ever getting far
enough to recognize it as "interaction required." That surfaces as a
`BrowserAuthError` with `errorCode: "timed_out"` instead — a DIFFERENT
error class the old code treated as fatal, rethrowing it all the way to
the page's generic error state instead of ever showing the popup that
would have worked fine. Confirmed live: a real user's console showed
exactly `GraphError: timed_out` with no further recovery. Fixed by also
treating `err instanceof BrowserAuthError && err.errorCode ===
BrowserAuthErrorCodes.timedOut` as "fall through to interactive," same
as `InteractionRequiredAuthError`. 3 new tests in
`src/__tests__/authProvider.test.ts` (falls through on
`InteractionRequiredAuthError`; falls through on the `timed_out`
`BrowserAuthError` — the actual case that was broken; does NOT fall
through for an unrelated error, confirming the broadened catch stayed
narrow). Mocking note for future MSAL tests: `PublicClientApplication`
must be mocked as `vi.fn().mockImplementation(function () { return
mockInstance; })` — a plain `function`, not an arrow — since `vi.fn()`
can only be invoked with `new` (as `getMsalInstance` does) when its
implementation is a real constructor function.

**`applicationId` is recovered the same way tenantId already was, plus a
new shared resolver ties both together.** A URL that loses its
`?applicationId=`/`?tenantId=` entirely — e.g. an MSAL redirect
round-trip that couldn't recover the pre-redirect URL and fell back to
the bare origin (`pages/auth.astro`'s own docstring already flagged this
as a real failure mode: "dumping people on the bare origin with every
query param lost") — used to just dead-end on `/form`/`/view` (both
require a real `applicationId` to resolve a route at all) rather than
self-heal the way a lost tenantId alone already did.
`tenantResolver.ts`'s `resolveApplicationAndTenantId(search, envDefaults?)`
is the one place both now get resolved together: URL → that page's own
existing env-default (`PUBLIC_DEFAULT_APPLICATION_ID`/
`PUBLIC_DEFAULT_TENANT_ID`, passed in per-caller since `/form`/`/view`
never used these while `/switcher`/`/builder` did — this doesn't change
that) → whatever this browser last used successfully
(`getCachedApplicationId`/`getCachedTenantId`, new+existing localStorage
caches). A value recovered from the cache is backfilled into the address
bar (`backfillApplicationIdInUrl`/`backfillTenantIdInUrl`, no
navigation); the env-default case is never backfilled, since it's already
free. **The two ids are NOT cached symmetrically**: a URL-provided
`applicationId` is cached directly here (not a secret, and a wrong value
fails no worse than a missing one); a URL-provided `tenantId` is
deliberately NOT auto-cached here — only one a real successful sign-in
actually confirmed gets remembered (`rememberTenantFromResult`,
unchanged), so a wrong/typo'd `?tenantId=` in some copied link can never
poison the cache for a later, different visit. `routing.ts`'s
`parseCurrentRoute()`/`parseCurrentViewRoute()` call this before parsing
(no env defaults — preserves `/form`/`/view`'s existing "no
PUBLIC_DEFAULT_APPLICATION_ID fallback" behavior exactly, only adds the
cache layer); `builder.ts`/`switcher.ts` call it with their existing env
defaults passed through, replacing their previous inline
`params.get(...) ?? PUBLIC_DEFAULT_...` chains (which is also a genuine
small fix for `builder.ts`, which never consulted the tenantId cache at
all before this).

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

`engage.createEvent`/`engage.updateEvent` now return `accessCode` too
(alongside the existing `eventId`/`name`/`startsOn`/`endsOn`) — the
event's attendance-scanner check-in code. Same "pull the raw spec"
discipline paid off again here: confirmed present on the real response
(`3.0-Event-PostPutResponse.accessCode: string`) by downloading
`https://engage-api.campuslabs.com/swagger/swagger.json` directly and
grepping its `definitions`, after `WebFetch`'s own page-summarization
step twice failed to surface it from the (large) spec. Previously
missing from both actions' return statements entirely — a config
referencing `{{results.<actionKey>.accessCode}}` (the Luddy LLC admin
form's own approve flow already did) silently resolved to `""`, not an
error, so this was a real, live gap, not just an untested one.

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

**Confirmed live against the real IU Engage account (2026-10): the
`_server` proxy's `ENGAGE_API_KEY` can CREATE events but is NOT
authorized to UPDATE them.** `engage.updateEvent` (the Luddy approve
button's re-approval branch — runs when an item already has a
BeInvolved event id from a prior approve) failed with a real `403` from
Engage itself: `{"error":"The specified API key is not authorized to
use this endpoint.", "version":"v3.0", "method":"PATCH", "endpoint":
"/events/event/<id>", "ip":"<cloudflare-edge-ip>"}`. Confirmed this is
genuinely Engage's own rejection, not `_server`'s gate (whose own 403
body is just `{"error": "<message>"}`, with none of Engage's
`version`/`method`/`endpoint`/`ip` fields) — the request shape itself
was also independently verified correct (`PATCH /v3.0/events/event/{id}`
with an RFC 6902 patch body, matching the error's own `"method"`/
`"endpoint"` exactly). **This is an Engage-account-side API key
permission gap, not an app bug** — Campus Labs Engage API keys are
scoped per-endpoint by whoever issues them, and this one was evidently
only ever granted Create, not Update. Re-approving an already-approved
Luddy LLC event will keep failing this way until whoever manages the
Engage integration grants this key Update permission on the Events
endpoint (or the approve button's update branch is accepted as
unsupported until then). No code fix exists for this — flagged here so
it isn't re-diagnosed as a bug next time it's hit.

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
  route recovery; site provisioning into Site Assets. 479 tests (82
  `@skye/form-config` + 397 `@skye/app`), type-check clean (TypeScript 7),
  Astro 7 build of all pages, `test:views:browser` green — all verified on
  the modernized toolchain (see "Toolchain versions" above).
- **Not yet done:** a real rich-text editor for `skye-richtext`,
  `attachment`-mode file uploads (needs a second MSAL scope), an ARIA
  pass on the functional components.
- **Untested against a live tenant:** everything Graph-writing —
  `searchSitesWithSkyeData`'s response-shape assumptions, the
  provisioning flow, `canWriteSkyeData`'s write probe, and auth overall
  (structurally complete, never run against real Entra/SharePoint). A
  half-filled form's values are still lost across an MSAL redirect
  round-trip (only the route is recovered).

## Toolchain versions

As of the 2026-09 dependency modernization the repo is on the current
major of everything: **Astro 7** (Vite 7 under it), **Vitest 5**, **jsdom
30**, **TypeScript 7** (the native compiler), **@azure/msal-browser 5**,
Turbo 2.10, tsx 4.23, ajv 8.20. `@microsoft/microsoft-graph-client`,
`@playwright/test`, and `invokers-polyfill` were already current.

- **Node**: the toolchain needs **Node ≥ 22.12** (enforced by
  `engines.node` in the root `package.json`, pinned for version managers
  by `.node-version`). Older Node 4.x-era-ish setups are fine; the trap is
  the *other* direction — Astro 4 / Vitest 2 hard-hang or crawl on Node
  26, which is what forced this upgrade. Astro 7 / Vitest 5 run cleanly on
  Node 26.
- **`packages/app/vitest.config.ts` sets `pool: "threads"`.** Vitest's
  default `forks` pool spins up a fresh Node process per test file and
  stands up jsdom inside it — ~7s each here, which trips the worker-
  startup timeout on a chunk of the suite. Threads share the process
  (jsdom's native bits load once) and still give each file an isolated
  environment. The full app suite runs in ~8s this way.
- **`packages/form-config` builds via `tsconfig.build.json`** (extends
  `tsconfig.json`, excludes `*.test.ts` / `__tests__/`). Vitest 5 no
  longer excludes `dist/` by default, so without this the compiled test
  copies in `dist/` got discovered and every form-config test ran twice.
  `form-config/vitest.config.ts` also carries an explicit `exclude` list
  with a `dist/` guard as belt-and-braces.
- **MSAL 5**: `navigateToLoginRequestUrl` moved off the `Configuration.auth`
  block onto `handleRedirectPromise({ navigateToLoginRequestUrl: false })`
  (see `shared/auth/redirectReturn.ts`). The auth flow is otherwise
  unchanged and still **unverified against a live tenant** — MSAL 3→5
  behavioral changes need real-Entra testing when that's possible.
- **jsdom 30** implements `<dialog>.showModal()` and
  `ElementInternals`'s Constraint Validation API, which jsdom 25 did not.
  The feature-detected fallbacks in `shared/ui/confirmDialog.ts` and
  `features/form/registerElements.ts` (their comments still say "jsdom <
  26" / "jsdom 25") are now inert but harmless — leave them for anyone on
  an older jsdom.
- **`astro dev` / `astro preview` in Astro 7 auto-detect an "AI agent"
  shell** (via `am-i-vibing`) and daemonize, switching to JSON logs
  (`astro dev stop|status|logs` to manage one). A normal user terminal is
  unaffected — `pnpm dev` runs in the foreground as before. The Playwright
  gate sets `ASTRO_PREVIEW_BACKGROUND=1` in its `webServer.env` to opt out
  (otherwise the foreground process exits and Playwright sees the server
  "exit before becoming ready").

## Commands

Everything below runs through Turborepo (`turbo.json`); root `package.json`
scripts are wrappers around `turbo run <task>`. Turbo runs independent
tasks in parallel and caches results (a repeat `pnpm test`/`pnpm build`
with no relevant changes replays in milliseconds — look for `>>> FULL
TURBO` in the output).

```bash
pnpm install                          # install all workspace deps
pnpm build                            # turbo run build  — builds both packages, cached
pnpm test                             # turbo run test   — runs every package's test suite (479 tests total), in parallel
pnpm test:config                      # turbo run test --filter=@skye/form-config — just @skye/form-config's 82 tests
pnpm typecheck                        # turbo run typecheck — tsc --noEmit across both packages
pnpm lint:configs -- <path>           # turbo run lint:configs -- <path> — validate + additive-lint a local skye_data/forms/ checkout
pnpm dev                              # turbo run dev — starts packages/app's dev server (persistent, not cached)

# Custom Views browser regression gate (Playwright + system Chrome; not part
# of `turbo run test` — needs a browser + a preview server):
cd packages/app && pnpm test:views:browser

# Reach for pnpm --filter directly only when you want just one package
# without going through turbo, e.g.:
pnpm --filter @skye/app test

# from packages/app, for PUBLIC_MOCK_GRAPH-specific runs:
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
