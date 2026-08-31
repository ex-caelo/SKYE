# SKYE

## Reece TODO:
  - [ ] Switcher is super slow.
  - [ ] Identify areas that JS could be replaced by CSS
  - [x] Make astro pages more state-obvious and get some of the markup out of ts files
  - [ ] Builder is still jank with pages, conditional visibility, what you're editing, etc.
  - [ ] Replace some of these things with components
  - [ ] Security check
  - [ ] Graph Attributes
 
Client-side forms and views for SharePoint, driven by JSON config files
authored in a `skye_data/` directory on the SharePoint site itself. Built to
prioritize ease-of-editing for non-developers and structural consistency
across every config, over developer convenience.

See `CLAUDE.md` for repo conventions and current implementation status, and
`SKYE-pre-scaffold-TODO.md` for the itemized build checklist.


## Getting started

```bash
pnpm install
pnpm approve-builds --all  # first time only — see CLAUDE.md's note on pnpm/esbuild/sharp
pnpm test              # run all package test suites (139 tests total)
pnpm test:config       # just @skye/config

cd src/app                    # actual path — the workspace glob is src/*, not packages/*
PUBLIC_MOCK_GRAPH=1 pnpm dev  # local dev with no live tenant required
```

If `pnpm install` or `pnpm test`/`pnpm build` stops with an
`ERR_PNPM_IGNORED_BUILDS` error, run `pnpm approve-builds --all` — see the
note in `CLAUDE.md` for why.


## Pages

Every page reads its context (site, application, form/view id, ...) from
the URL — there's no server-side routing, so the URL itself is the only
thing that decides what a given visit shows. Two ways to run the app,
picking which Graph client every page below actually talks to:

```bash
cd src/app
PUBLIC_MOCK_GRAPH=1 pnpm dev   # mock: no live tenant, no sign-in — fixtures in lib/mock-graph/fixtures/
pnpm dev                       # real: needs a real Azure app registration + SharePoint site (see CLAUDE.md)
```

Both serve at `http://localhost:4321` by default. The mock examples below
use `x` for `siteId`/`applicationId` (the mock never actually validates
either — same placeholder convention the project's own Playwright suite
already uses, see `e2e/customViews.spec.ts`) alongside its real fixture
ids (`test-event-signup` is the one fixture form; `calendar`/
`security-probes` are the two fixture views); the real-tenant examples use
`<angle-bracket>` placeholders for whatever's actually yours — never
hardcode real ids into the app itself (see CLAUDE.md).

| Page | Purpose | Mock example | Real-tenant example |
|---|---|---|---|
| `/form` | Render/submit a form | `/form?applicationId=x&siteId=x#test-event-signup` | `/form?siteId=<site-id>&applicationId=<app-client-id>&tenantId=<tenant-id>#<formId>` |
| `/switcher` | Pick a site, then a form/view | `/switcher?applicationId=x` | `/switcher?applicationId=<app-client-id>&tenantId=<tenant-id>` |
| `/view` | Render a Custom View | `/view?applicationId=x&siteId=x#calendar` | `/view?siteId=<site-id>&applicationId=<app-client-id>&tenantId=<tenant-id>#<viewId>` |
| `/builder` | Create/edit form configs | `/builder?applicationId=x` | `/builder?applicationId=<app-client-id>&tenantId=<tenant-id>` |
| `/diag` | Real-tenant Graph permission diagnostics | *(none — always talks to the real Graph API regardless of `PUBLIC_MOCK_GRAPH`, by design; see its own docstring)* | `/diag?applicationId=<app-client-id>&tenantId=<tenant-id>` |

`/` and `/404` aren't meant to be visited directly with parameters — `/` is
just an OAuth-error/stray-old-link catcher that forwards to `/form`, and
`/404` is the static not-found page.

**Common query params**, all read straight off `window.location`, no
server involved:
- `applicationId` (required everywhere except the mock, where it can be
  any string) — the Azure app registration's client id MSAL authenticates
  against.
- `tenantId` (optional) — only needed for a single-tenant app registration
  (which rejects MSAL's default `/common` authority); omit for multi-tenant.
- `siteId` (required by `/form`/`/view`; optional on `/switcher`/`/builder`,
  where omitting it shows a site picker first) — the SharePoint site's
  Graph id.

**Page-specific hash/query extras:**
- `/form`'s hash is `#formId` (create), `#formId/itemId` (edit), or
  `#formId/itemId/view` (read-only); an optional `&draft=<draftId>` query
  param renders a `/builder` draft in place of the live config instead —
  e.g. `/form?applicationId=x&siteId=x&draft=<draftId>#test-event-signup`.
- `/builder`'s hash (`#formId`) is an optional prefill straight to that
  form, skipping its own form-picker step once a site is known.


## Packages

- **`packages/skye-config`** — framework-agnostic core logic: the
  `form.config.json` JSON Schema, TypeScript types, config merge/lint,
  condition/expression evaluation, field validation, and the postAction
  pipeline. Pure functions, unit-tested without needing a live SharePoint
  tenant. See its own README for details.
- **`packages/app`** — the Astro site: URL/hash routing, a Graph-search-based
  site switcher, MSAL auth, Graph integration, the field-registry-driven
  form renderer, real search/lookup/table Web Components, and the submit/
  postAction pipeline including file uploads. Rendering, routing,
  mock-Graph development, and submission are all working end-to-end; a
  real rich-text editor library and `attachment`-mode file uploads are
  still open. See its own README for what's real vs. remaining.

## Monorepo tooling

Tasks across `packages/skye-config` and `packages/app` are orchestrated by
**Turborepo** (`turbo.json`) rather than raw `pnpm -r`. Root scripts like
`pnpm build`/`pnpm test`/`pnpm typecheck` are wrappers around `turbo run
<task>` — this runs independent packages' tasks in parallel and caches
results, so an unchanged `pnpm test` replays instantly instead of
re-running the whole suite. See `CLAUDE.md`'s Commands section for the
full list, including how to target just one package.

## Config authoring

Form configs live on the SharePoint site under `skye_data/forms/[id]/`, with
permission-specific overlays in `skye_data/forms/[id]/[permission]/`.
Validate a local checkout of that directory before publishing changes:

```bash
pnpm lint:configs -- /path/to/local/skye_data/forms
```

This checks every config against the JSON Schema, checks every overlay for
additive-only compliance against its base, and flags any grid layout whose
row token counts don't match `gridTemplateColumns` (the one consistency
rule JSON Schema itself can't express).
