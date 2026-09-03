# SKYE

Client-side forms and views for SharePoint, driven by JSON config files
authored in a `skye_data/` folder on the SharePoint site itself — no code
deploy needed to add or change a form. Built to prioritise ease-of-editing
for non-developers and structural consistency across every config.

**New here? Read [`ARCHITECTURE.md`](ARCHITECTURE.md).** It's one page: the
two packages, the app layout, the invariants, and the URL scheme.
[`CLAUDE.md`](CLAUDE.md) has the conventions and the Graph-permissions
reference; [`docs/`](docs/) has the build log, handoff, and Custom Views
spec.

## Repo map

```
packages/
  form-config/   @skye/form-config — the model: schema, types, merge/lint,
                 condition & expression eval, validation, post-action engine.
                 Pure functions; no DOM, no Graph. Testable without a tenant.
  app/           @skye/app — the Astro site. Inside src/:
    pages/          one .astro per route
    page-scripts/   one client bootstrap script per page (form.astro loads page-scripts/form.ts)
    components/     reusable .astro components   layouts/  BaseLayout.astro
    features/       form/  builder/  custom-views/  switcher/
    shared/         auth/  sharepoint/  ui/  routing.ts  site-config.ts
    integrations/   teams.* / outlook.* / engage.* actions
                 (browser-tests/ = the Playwright Custom Views security gate)
docs/            build log, handoff, Custom Views spec & authoring guide
ARCHITECTURE.md  the one-page overview
CLAUDE.md        conventions + real-tenant Graph permissions reference
```

Tasks run through **Turborepo** — root `pnpm build|test|typecheck|dev|lint:configs`
wrap `turbo run <task>` (parallel + cached across the two packages).

## Getting started

```bash
pnpm install
pnpm approve-builds --all       # first time only — see CLAUDE.md's note on pnpm/esbuild/sharp
pnpm test                       # all package suites
pnpm test --filter=@skye/form-config   # just the model package

cd packages/app
PUBLIC_MOCK_GRAPH=1 pnpm dev     # local dev, no live tenant / sign-in — fixtures under src/shared/sharepoint/fixtures/
pnpm dev                         # real: needs an Azure app registration + SharePoint site (see CLAUDE.md)
```

If `pnpm install`/`test`/`build` stops with `ERR_PNPM_IGNORED_BUILDS`, run
`pnpm approve-builds --all` (see `CLAUDE.md` for why).

## Pages

Every page reads its context (site, application, form/view id, …) straight
off `window.location` — there is no server-side routing. Mock examples use
`x` for `siteId`/`applicationId` (the mock validates neither) alongside its
fixture ids (`test-event-signup`; views `calendar` / `security-probes`).

| Page | Purpose | Mock example |
|---|---|---|
| `/form` | Render / submit a form | `/form?applicationId=x&siteId=x#test-event-signup` |
| `/switcher` | Pick a site, then a form/view | `/switcher?applicationId=x` |
| `/view` | Render a Custom View | `/view?applicationId=x&siteId=x#calendar` |
| `/builder` | Create / edit form configs | `/builder?applicationId=x` |
| `/diag` | Real-tenant Graph permission diagnostics | *(always talks to the real Graph API by design)* |

`/` is an OAuth-error / stray-old-link catcher that forwards to `/form`;
`/404` is the static not-found page.

**Common query params** (all off `window.location`, no server):
- `applicationId` (required outside the mock) — the Azure app registration's
  client id MSAL authenticates against.
- `tenantId` (optional) — only for a single-tenant app registration (which
  rejects MSAL's default `/common` authority).
- `siteId` (required by `/form` and `/view`; optional on `/switcher` /
  `/builder`, which show a picker without it) — the SharePoint site's Graph id.

**Page-specific hash:**
- `/form`: `#formId` (create), `#formId/itemId` (edit), `#formId/itemId/view`
  (read-only); optional `&draft=<draftId>` renders a `/builder` draft in
  place of the live config.
- `/builder`: `#formId` optionally prefills straight to that form.

## Config authoring

Form configs live under `skye_data/forms/[id]/`, with permission-specific
overlays in `skye_data/forms/[id]/[permission]/`. Validate a local checkout
before publishing:

```bash
pnpm lint:configs -- /path/to/local/skye_data/forms
```

This checks every config against the JSON Schema, every overlay for
additive-only compliance against its base, and flags any grid layout whose
row token counts don't match `gridTemplateColumns`.
