# SKYE — Architecture

SKYE renders and submits SharePoint-backed **forms** and sandboxed
author-written **views**, entirely client-side, driven by JSON config
files that live in a `skye_data/` folder on the SharePoint site itself.
No code deploys to add or change a form. Two audiences: end users filling
forms, and non-technical *authors* editing the config (which is why the
JSON Schema's descriptions are written to teach).

## Two packages (`packages/`)

| Package | npm name | Job |
|---|---|---|
| `packages/form-config` | `@skye/form-config` | The **model**: the JSON Schema + TS types for `form.config.json`, config merge/lint (permission overlays), condition & calculated-expression evaluation, field validation, and the post-action pipeline. **Pure functions — no DOM, no Graph SDK.** Unit-tested without a browser or tenant. |
| `packages/app` | `@skye/app` | The **Astro site**: hash-based routing, MSAL auth, Microsoft Graph integration, the field-registry-driven form renderer, the config builder, the Custom Views sandbox host, and submission. Depends on `@skye/form-config`. |

`form-config` never imports `app`. `app` imports `form-config` only via
the `@skye/form-config` workspace alias.

Task orchestration is **Turborepo** (`turbo.json`); root `package.json`
scripts (`pnpm build|test|typecheck|dev|lint:configs`) wrap `turbo run`.

## Inside `packages/app/src/`

```
pages/          one .astro per route (Astro file-based routing). Ships all page
                states as hidden <section>s; the page script toggles them.
page-scripts/   one client bootstrap script per page (pages/form.astro loads
                page-scripts/form.ts). Kept out of pages/ because Astro treats
                any pages/*.ts as a route.
components/     reusable .astro components (dialog, message panel, the switcher
                step screens) — never nested inside a feature.
layouts/        BaseLayout.astro — the shared document shell.
features/
  form/         render a form from its config — field registry, layout engine,
                validation, the web-component controls, and the submit pipeline.
  builder/      the /builder visual editor for form.config.json (schema-driven).
  custom-views/ the sandboxed-iframe host + runtime for author-written views.
  switcher/     the /switcher site → form/view picker wiring (siteSwitcher.ts).
shared/
  auth/         MSAL sign-in, tenant resolution, redirect-flow recovery.
  sharepoint/   the Graph client (real + mock) and its fixtures.
  ui/           cross-page behaviour helpers: page-state toggling, the dialog /
                message-panel drivers, the invoker-commands polyfill loader.
  routing.ts    URL ⇄ route parsing/building (every page script uses it).
  site-config.ts  the site-wide skye.config.json model (allowlists, home, builderEditors).
integrations/   external-service actions a "script" post-action can call —
                teams.*, outlook.*, engage.* — plus the registry that names them.
```

`packages/app/browser-tests/` holds the Playwright regression gate (the
Custom Views sandbox security probes); it's separate from the `vitest`
unit suites and runs via `pnpm --filter @skye/app test:views:browser`.

## Load-bearing invariants (do not weaken without sign-off)

- **No code is ever loaded from SharePoint.** Config files are data only.
  `customValidators` and `postAction.functionName` are keys into
  hardcoded, reviewed registries in `packages/app` source — never fetched,
  imported or `eval`'d.
- **Permission overlays are additive-only.** A `[permission]/form.config.json`
  may add pages/fields/actions or loosen a constraint; never remove or
  tighten. Enforced by `@skye/form-config`'s `lintOverlay` + `mergeConfig`.
- **Permissions are SharePoint folder ACLs.** No app-level role code — the
  app asks Graph which `[permission]` subfolders it can read and merges
  those.
- **Custom Views run in `sandbox="allow-scripts"` with no origin and no
  network**; every capability is mediated over a private `MessageChannel`
  to a trusted host on SKYE's own origin. Read-only, always. Full spec:
  [`docs/custom-views-spec.md`](docs/custom-views-spec.md).
- **Never fetch a full SharePoint list client-side.** Query server-side
  with `$filter`/`$search` + `$top`, `$select` only what's needed.

## URL scheme

Everything is in the URL — no server-side routing. Query string comes
before the `#`:

```
/form?siteId=&applicationId=&tenantId=#{formId}/{new | itemId | itemId/view}
/switcher?applicationId=&tenantId=            (optional &siteId=)
/view?siteId=&applicationId=&tenantId=#{viewId}
/builder?applicationId=&tenantId=             (optional &siteId=, #formId prefill)
```

`tenantId` is only needed for a single-tenant app registration.
`PUBLIC_MOCK_GRAPH=1` swaps the real Graph client for local fixtures (no
sign-in) — see `README.md`.

## More detail

- Conventions & permissions reference: [`CLAUDE.md`](CLAUDE.md)
- What's built / decided / open: [`docs/build-log.md`](docs/build-log.md)
- Handoff briefing: [`docs/handoff.md`](docs/handoff.md)
- View authoring: [`docs/custom-views-authoring.md`](docs/custom-views-authoring.md)
