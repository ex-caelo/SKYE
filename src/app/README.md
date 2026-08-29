# @skye/app

The Astro site: URL routing, MSAL auth, Microsoft Graph integration, and the
form renderer. Depends on `@skye/config` for schema types, merge/lint,
condition evaluation, and the postAction pipeline — this package owns
everything that touches the DOM, the browser, or the network.

## Request flow (create/edit/view a form)

1. **`pages/index.astro`** — a thin shell; the only thing that varies per
   deploy, not per route. Loads `scripts/entry-form.ts` as a module script.
2. **`entry-form.ts`** — bootstraps the page:
   - `lib/routing/router.ts` parses `location.hash`/`location.search` into
     a `FormRoute` (`{formId, mode, itemId?, siteId, applicationId}`) or an
     `UnresolvedRoute` if anything required is missing.
   - **If unresolved** (typically: no `siteId`), shows the site switcher
     instead: `graph.searchSitesWithSkyeData()` finds every site with a
     `skye_data` folder via Graph's `/search/query`, and
     `lib/routing/siteSwitcher.ts` renders a picker. Selecting a site
     reloads the page with `?siteId=` filled in.
   - `lib/graph/createGraphClient.ts` picks the mock or real `GraphClient`
     based on `PUBLIC_MOCK_GRAPH`.
   - `graph.getSkyeFormConfigFiles(siteId, formId)` returns the base config
     plus every `[permission]` overlay the signed-in user can currently see
     (SharePoint ACLs decide that — see root `CLAUDE.md`).
   - `@skye/config`'s `mergeConfig` combines them; `route.mode === "view"`
     then force-sets every field `readonly` as an app-level render flag
     (not a schema concept).
   - `lib/render/renderForm.ts` builds the actual DOM from the merged
     config and mounts it into `#skye-app`, including a `submitButton`.
   - `entry-form.ts` attaches listeners for the `skye-people-search`/
     `skye-lookup-search` events the picker Web Components dispatch,
     fulfilling them against `graph.searchPeople`/`graph.searchLookupItems`
     — this is the one place in the app that knows both about the pickers
     AND the Graph client, keeping the elements themselves Graph-agnostic.
   - `entry-form.ts` attaches a click handler on the submit button calling
     `lib/submit/submitForm.ts`, which orchestrates the full submission:
     `beforeSubmit` postActions → primary item write → `parentReference`
     lookupTable row writes → `afterSubmit` postActions →
     `onSuccess`/`onError`. See that file's own docstring for the
     deliberate failure-handling policy (a `beforeSubmit` failure aborts
     before writing anything; a later failure doesn't roll back an
     already-successful primary write). A write that hits an etag conflict
     (someone else edited the item first) surfaces as a distinct
     `result.conflict` rather than a generic failure.

## What's real vs. placeholder right now

| Piece | Status |
|---|---|
| Routing (`router.ts`) | Real, fully tested (5 tests covering all 3 modes + the unresolved fallback). |
| `applyAttributes`/`applyStyle` | Real, fully tested — this is the security choke point stripping `on*` keys regardless of what passed schema validation. |
| Field registry (`fieldRegistry.ts`) | Real for all native controlTypes (text/number/select/checkbox/radio/etc.) and structurally complete for the 5 Web Component controlTypes. |
| `renderForm`/`renderField`/`layoutEngine` | Real, tested end-to-end against the actual base example config (tabs, grid layout, `visibleIf` reactivity at both field and page level). |
| Mock Graph client | Real, fixture-backed, scoped per `(siteId, listId)` so a lookupTable's related list can't collide with the primary list's items, including a simulated 412 on etag mismatch — see `lib/mock-graph/`. |
| Real Graph client | Structurally complete (list CRUD, config-file loading, retry-on-429), **untested against a live tenant**. |
| Auth (`authProvider.ts`) | Structurally complete (popup-first, per-`applicationId` MSAL instance caching, redirect fallback), **untested against a live tenant**, and the redirect fallback does **not** currently restore hash/form state after the round-trip — see TODO §13. |
| **Submit pipeline (`submitForm.ts`)** | **Real**, tested end-to-end against `MockGraphClient` — full trigger-phase sequencing, `{{item.id}}`/`{{fields.x}}`/`{{results.x}}` interpolation flowing through to real postAction calls, optimistic-concurrency etag pass-through with a distinguishable `EtagConflictError` (see below), and a beforeSubmit-failure-aborts-before-writing case. |
| **lookupTable row writes (`lookupTableRows.ts`)** | Real and tested — create, update, AND delete (an existing row's removal marks it `deleted: true` in the UI so the server-side delete still happens; a never-saved row is just dropped), the `<Column>LookupId` convention, `lookupColumn` mode correctly no-op'ing. |
| `skye-people-picker`, `skye-lookup-picker` | **Real** — debounced search-as-you-type against the Graph client, via `skye-people-search`/`skye-lookup-search` events that `entry-form.ts` fulfills (keeps the elements themselves Graph-agnostic). Minimal styling, no ARIA yet. |
| `skye-lookup-table` | **Real** — add/remove rows (with real server-side deletion, not just a client-side no-op), one input per configured column (text/number/select), wired to the submit pipeline. No per-column validation or `visibleIf` yet. |
| `skye-richtext` | **Deliberate minimal placeholder** (per explicit instruction) — a plain contenteditable for basic text entry plus a purely visual (CSS/HTML only, no click handlers) toolbar bar. No formatting logic, no `execCommand`, nothing beyond the shared get/set `value` + `skye-change` contract every SKYE element has. This replaced an earlier `execCommand`-based toolbar from a prior pass, on the reasoning that a smaller, honestly-minimal surface is easier to fully replace later than a partial "real" implementation. When you're ready to upgrade, only the `value`/`skye-change` contract needs to survive — everything else inside the element (the toolbar markup, the editor itself) is fair game to replace wholesale. Tiptap suggested. |
| `skye-calculated-display` | **Real**, including reactivity — `renderForm.ts` recomputes every `calculatedDisplay` field via `@skye/config`'s `evaluateCalculatedExpression` on every field change and writes the result back into both `values` and the control. |
| **Site switcher (`lib/routing/siteSwitcher.ts`)** | **Real** — `GraphClient.searchSitesWithSkyeData()` uses Graph's `/search/query` (entityType `driveItem`, `queryString: "skye_data"`), filters to hits that are an EXACT folder named `skye_data` (the Search API can return fuzzy matches) before resolving each to a site, so a site with no SKYE config never appears. **Untested against a live tenant** — the exact response shape assumptions (`resource.folder`, `resource.parentReference.siteId`) need verification. Needs `PUBLIC_DEFAULT_APPLICATION_ID` set for the case where a URL has no `applicationId` at all. |
| **File uploads (`lib/submit/fileUpload.ts`)** | `library` mode: **real**, tested (Graph's simple-upload PUT endpoint, writes the resulting `webUrl` into the bound column). `attachment` mode: **deliberately unimplemented** — Graph v1.0 has no solid, documented endpoint for SharePoint list item attachments; a real implementation likely needs a second MSAL scope for the SharePoint REST API's token audience, which is out of scope for "one more Graph call." Throws a clear, explanatory error rather than guessing at an endpoint. |

## Local development without a live tenant

```bash
PUBLIC_MOCK_GRAPH=1 pnpm dev
```

Renders the `test-event-signup` fixture form (mirroring the real
`form.config.example.json` + its admin overlay) entirely from local JSON in
`src/lib/mock-graph/fixtures/`, with an in-memory item store so
create/update calls behave consistently within a dev session. No Azure app
registration, no signed-in session, no network calls at all.

To exercise a real tenant instead, omit `PUBLIC_MOCK_GRAPH` — `createGraphClient`
will construct a `RealGraphClient` backed by MSAL + the Graph JS SDK. You'll
need a real Azure app registration (client ID passed as `?applicationId=`
in the URL) with `Sites.ReadWrite.All` delegated permission consented.

## Commands

```bash
pnpm test          # 57 tests (jsdom environment — real DOM APIs, no browser needed)
pnpm dev           # local dev server
pnpm build         # production build (verified working with PUBLIC_MOCK_GRAPH=1)
```
