# SKYE — Handoff Briefing

For exhaustive detail, see:
`CLAUDE.md` (conventions + status) and `build-log.md`
(itemized checklist, what's done vs. open).

## What SKYE is

A website that renders dynamic forms and views backed by SharePoint,
authored entirely through JSON config files (`form.config.json`) stored
in a `skye_data/` directory on the SharePoint site itself — no code
deploys needed to add or change a form. Two audiences: end users filling
out forms, and non-technical form *authors* editing config JSON, which is
why ease-of-editing and structural consistency are explicit project goals
(see the JSON Schema's own descriptions — they're written to teach, not
just validate).

Two packages:
- **`packages/form-config`** — framework-agnostic: the JSON Schema, TS
  types, config merge/lint, condition/expression evaluation, validation,
  the postAction pipeline. Pure functions, no DOM, no Graph SDK.
- **`packages/app`** — the Astro site: hash-based routing, MSAL auth,
  Microsoft Graph integration, the field-registry-driven renderer, and
  submission.

## Key decisions already made (don't relitigate without reason)

- **No code is ever loaded from SharePoint.** Config files are data only.
  `customValidators` and `postAction.functionName` are keys into
  hardcoded, reviewed registries in the app's own source — never fetched,
  imported, or `eval`'d from SharePoint.
- **Permissions are pure SharePoint ACLs.** `[permission]` subfolders
  under `skye_data/forms/[id]/` are readable or not based on native
  SharePoint folder permissions — there is no app-level role-mapping code.
- **Permission overlays are additive-only.** A higher-permission overlay
  can add fields/pages/actions or loosen a constraint, never remove
  something a lower permission sees or make something stricter. Enforced
  by `@skye/form-config`'s `mergeConfig`/`lintOverlay`.
- **URL scheme**: `getskye.app/form?siteId={siteId}&applicationId={appId}&tenantId={tenantId}#{formId}/{new|itemId|itemId/view}`.
  The query string comes before the `#` — `router.ts` reads `siteId`/
  `applicationId`/`tenantId` from the real `location.search`, which by URL
  spec must precede the fragment. (An earlier version of this doc had the
  query string after the `#`, which the browser folds into the hash
  fragment instead — `location.search` ends up empty and the app can't
  resolve a route. Found and fixed a session ago; see TODO's "Newly
  discovered gaps".) `tenantId` is optional — omit it for an actually
  multi-tenant Azure app registration (uses the `/common` authority); a
  single-tenant registration REJECTS `/common` outright (`AADSTS50194`,
  confirmed against a real tenant) and needs its tenant id. Resolution
  order (`shared/auth/tenantResolver.ts`): `?tenantId=` → `PUBLIC_DEFAULT_TENANT_ID`
  → a tenant id a previous sign-in on this browser cached in `localStorage`
  → `/common`. If `/common` is refused (single-tenant, nothing configured),
  the app asks the user for their work email, resolves it to a tenant id
  via Entra's public OIDC discovery document, caches it, rewrites the URL
  to carry `?tenantId=`, and retries — so a bare single-tenant link
  "self-heals" with no deploy-time env var. After any successful sign-in
  the real tenant id (from the MSAL result) is cached + backfilled the
  same way.
- **Multi-page, still 100% client-side (no SSR)**: `/form`, `/switcher`,
  `/` (landing), and `/404` are separate real `.astro` files/paths — plain
  static output, each shipping only the client JS it needs (confirmed via
  a real build: `/form`'s bundle is ~25KB, `/switcher`'s is ~1.7KB, `/`'s
  is ~0.2KB, `/404` ships none at all). `formId`/`itemId`/`siteId`/
  `applicationId` still live in the hash/query, parsed at runtime — real
  Astro dynamic path params (`[formId].astro`) aren't usable here since
  those values are live/unbounded SharePoint data unknown at build time.
  `/form` redirects (`window.location.assign`, a real page load) to
  `/switcher` when it can't resolve a route, carrying whatever it already
  knows (`siteId`/`applicationId`/the raw hash) forward.
- **`/switcher` is a two-step chooser**, not just a site picker: with no
  `siteId` at all it shows a site picker (`GraphClient.searchSitesWithSkyeData`);
  once a site is known but there's still no `formId` in the hash, it shows
  a form picker instead (`GraphClient.listSkyeForms`, reading the `title`
  out of each form's base config under that site's `skye_data/forms/`).
  Picking a site when a `formId` was already known (the original "just
  missing a siteId" case) skips the form-picker step and goes straight
  back to `/form`; picking a form defaults to create mode. `hashHasFormId`
  in `router.ts` is what tells the two cases apart, and also guards
  against a redirect loop back to `/form` with still nothing to resolve
  there. See `page-scripts/switcher.ts` and `features/switcher/siteSwitcher.ts`'s
  `renderSiteSwitcher`/`renderFormPicker`.
- **Rendering**: native HTML elements wherever one exists; Web Components
  only for the 5 controlTypes with no native equivalent (`peoplePicker`,
  `lookupPicker`, `lookupTable`, `richtext`, `calculatedDisplay`).
- **`skye-richtext` is a deliberate minimal placeholder** — HTML/CSS-only
  toolbar (no buttons, no JS), plain contenteditable for text entry. Not
  unfinished — explicitly requested this way so a real editor library
  (Tiptap suggested) can replace the internals later without disturbing
  the `value`/`skye-change` contract everything else depends on.
- **`attachment`-mode file uploads are deliberately NOT implemented** —
  Microsoft Graph v1.0 has no solid, documented endpoint for SharePoint
  list item attachments. Rather than guess at one, `library`-mode uploads
  (Graph's well-documented drive API) are the only fully working path.
- **Site switcher** uses Graph's `/search/query` (entityType `driveItem`),
  filtered to sites with an *exact* `skye_data` folder — a site with no
  SKYE config never appears in the switcher.

## Current status (last verified)

139 tests passing (45 in `@skye/form-config`, 94 in `@skye/app`), both packages
type-check clean, Astro production build succeeds, monorepo tasks run via
Turborepo (`turbo run <task>`, confirmed caching).

**Fully working end-to-end** (in `PUBLIC_MOCK_GRAPH=1` dev mode): routing, config
merge/overlay, field rendering incl. `visibleIf`/`calculatedDisplay`
reactivity, validation, search-as-you-type pickers, editable lookup
tables (create/update/delete rows), the full submit/postAction pipeline,
library-mode file uploads, the site switcher.

**Explicitly open** (see TODO for the full list): a real `skye-richtext`
editor library, `attachment`-mode uploads, an ARIA/accessibility pass,
MSAL redirect-fallback state recovery, and everything tagged "untested
against a live tenant" (auth, `searchSitesWithSkyeData`'s exact response
shape, etc.) — none of this has been exercised against a real Microsoft
365 tenant yet, only against the mock Graph client and fixtures.

## Running it locally

```bash
pnpm install                      # if ERR_PNPM_IGNORED_BUILDS, run: pnpm approve-builds
cd src/app                        # actual path — the workspace glob is src/*, not packages/*
PUBLIC_MOCK_GRAPH=1 pnpm dev              # → http://localhost:4321 (or next free port)
```

Only one form has mock fixture coverage: `test-event-signup`. `siteId`/
`applicationId` can be any non-empty string in mock mode.

| Try | URL |
|---|---|
| Create | `http://localhost:4321/form?siteId=x&applicationId=x#test-event-signup/new` |
| Edit existing item | `http://localhost:4321/form?siteId=x&applicationId=x#test-event-signup/1` |
| View mode | `http://localhost:4321/form?siteId=x&applicationId=x#test-event-signup/1/view` |
| Site switcher (direct, formId already known) | `http://localhost:4321/switcher?applicationId=x#test-event-signup` |
| Site switcher (via redirect) | `http://localhost:4321/form?applicationId=x#test-event-signup/new` — no `siteId`, bounces to `/switcher` automatically |
| Site picker (browse from scratch) | `http://localhost:4321/switcher?applicationId=x` — no `siteId`, no `formId` |
| Form picker (site known, no form yet) | `http://localhost:4321/switcher?siteId=x&applicationId=x` |

Notes: the `haiku` field only appears once campus = Bloomington; the
"Banquet details" tab only appears once "attending banquet" is toggled on;
submissions write to an in-memory mock store that resets on refresh.

## If you don't have these in the new conversation, ask for them

- The original project spec docs (SharePoint directory-structure notes,
  the Forms-vs-Views doc, the pre-edit `form.config.schema.json`/
  `form.config.example.json`) — these were project-knowledge files in the
  original conversation, not guaranteed to carry over to a new one.
- This repo, at minimum `CLAUDE.md`, `build-log.md`, and the
  full `packages/` tree (not just the docs — the assistant will want to
  read actual source files, not just descriptions of them).
