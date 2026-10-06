# SKYE — Build Log

> Started life as a pre-scaffolding TODO; it's now the running record of
> what was built, what was decided, and what's still open. Newest work is
> at the bottom (§18+). For the current shape of the repo see
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md); for conventions see
> [`../CLAUDE.md`](../CLAUDE.md).
>
> **Paths in older entries predate the 2026 restructure.** `src/app/` and
> `src/skye-config/` are now `packages/app/` and `packages/form-config/`
> (npm `@skye/form-config`); inside the app, `src/lib/{render,submit,graph,
> auth,ui,views,…}` moved under `src/features/*` and `src/shared/*`, and
> the per-page `src/scripts/entry-*.ts` are now `src/entries/*.ts`. See
> `ARCHITECTURE.md` for the map.

---

## 1. Schema changes needed (edit `form.config.schema.json` first — everything downstream depends on it)

- [x] Add `fileStorage` to the `field` def (`target: "attachment" | "library"`, `library.driveId`, `library.folderPath`). — *Implemented in `packages/skye-config/src/schema/form.config.schema.json`.*
- [x] Add a structured `calculatedDisplay` expression shape, modeled on `condition` (e.g. `{ op: "sum" | "concat" | ..., fields: [...] }`), for the common cases. — *`$defs/calculatedExpression`; ops: sum/subtract/multiply/divide/min/max/concat.*
- [x] Decide whether `calculatedDisplay` also needs a hardcoded-function escape hatch — **decided: structured expression only, no script escape hatch** (per discussion; keeps calculations reviewable, consistent with the "no code from SharePoke" rule since a formula-language escape hatch would reopen that door).
- [x] Update the `customValidators` and `script` postAction descriptions — *done; both now state they're keys into a hardcoded app-source registry.*
- [x] Re-run the schema through a JSON Schema validator after edits — *validated with ajv (draft 2020-12); `form.config.example.json` still validates unmodified.*
- [x] **(Found during implementation, not originally listed)** The base schema's top-level `required: [list, pages, fields]` doesn't fit overlay files, which are legitimately partial (the real admin overlay example has no `list` key at all). Added a companion `form.config.overlay.schema.json` — same shape, nothing required at the top level — used by `lint:configs` to validate overlays instead of the base schema. See `packages/skye-config/src/schema/form.config.overlay.schema.json`.

## 2. Security decisions — locked in, just need enforcing in code

- [x] **No code ever loaded from SharePoint.** `customValidators` names and `script.functionName` are string keys into hardcoded, git-tracked registries. — *Implemented: `validation/customValidatorRegistry.ts` (mechanism + `createCustomValidatorRegistry` helper) and `actions/handlers/script.ts` both throw a loud error on an unregistered name. Note: only the **mechanism** lives in `@skye/config` — the real validator/script functions must be registered in `packages/app`, never here, per the "reviewed app source only" decision.*
- [x] Central `applyAttributes(el, attrs)` helper strips any key matching `/^on/i` before `setAttribute`, independent of schema validation — this is the one choke point every control's attribute/style application must go through. — *Implemented in `packages/app/src/lib/render/applyAttributes.ts`, plus a sibling `applyStyle` for the cosmetic style bag (applied via CSSStyleDeclaration, never a raw string, so no cssText injection surface). Tested: verified it strips `onclick`/`onerror`/mixed-case `ONMOUSEOVER` and warns rather than throwing.*
- [ ] Confirm allowlist-not-blocklist approach stays intact if/when new `htmlAttributes`/`cssStyle` keys get added later — deliberate, one at a time, reviewed. — *Ongoing convention, nothing to check off yet.*

## 3. URL scheme & routing

- [x] Final scheme: `getskye.app/form#{formId}/{new|itemId|itemId/view}?siteId={siteId}&applicationId={appId}`
- [x] `router.ts`: parse `formId`, mode segment (`new` / itemId / itemId+`view`), `siteId`, `applicationId` from `location.hash` + `location.search`. — *Implemented in `packages/app/src/lib/routing/router.ts` as a pure `parseRoute(hash, search)` function plus a thin `parseCurrentRoute()` wrapper reading real `window.location`. Tested: all three modes plus the unresolved (missing formId/siteId/applicationId) fallback.*
- [x] `view` mode is an **app-level render flag** (forces all fields readonly), not a schema concept — schema only knows `create`/`edit`/`both`. Make sure this doesn't get conflated with `mode` in the renderer. — *Handled in `entry-form.ts`: after merge, `route.mode === "view"` loops over `merged.fields` setting `readonly = true` — entirely separate from the schema's own `mode` property.*
- [x] Decide 404 / no-`siteId` fallback flow (site-switcher via Graph `/search/query` for `skye_data` dirs). — *Implemented per spec: `GraphClient.searchSitesWithSkyeData()` uses Graph's `/search/query` (entityType `driveItem`, `queryString: "skye_data"`), filters to hits that are an EXACT folder literally named `skye_data` (not fuzzy/partial matches, which the Search API can return) before resolving each to a site via a follow-up `/sites/{siteId}` call — so a site without a real SKYE configuration never appears, by construction at the source rather than filtered client-side after fetching. `renderSiteSwitcher` (`lib/routing/siteSwitcher.ts`) renders the picker via a callback (not direct navigation), keeping it testable without real browser navigation. **One real architectural decision surfaced here**: the switcher needs SOME `applicationId` to authenticate with before a form-specific one is even known (chicken-and-egg), so a new `PUBLIC_DEFAULT_APPLICATION_ID` env var covers that case — falls back to a clear error message if neither the URL nor the env var provides one, rather than silently failing.*
- [x] **(New)** Split the single-page app into separate `.astro` pages for code segmentation, while staying 100% client-side (no SSR — deliberately ruled out, since `formId`/`itemId` are live/unbounded SharePoint data unknown at build time, incompatible with Astro's static `getStaticPaths`/`[param].astro` dynamic routes). `pages/index.astro` used to be the one page handling every mode inline; now: `pages/form.astro` (create/edit/view — `mode` stays an app-level render flag on this one page, not split further, per the `view`-mode decision above), `pages/switcher.astro` (site switcher, previously rendered inline by `entry-form.ts`), `pages/404.astro` (Astro's conventional not-found page — host-dependent whether a given static host actually wires up `404.html`), and `pages/index.astro` (now a near-static landing page). `formId`/`itemId`/`siteId`/`applicationId` still live entirely in the hash/query, parsed at runtime exactly as before — only *which page* loads changed, not how deep into the URL Astro's own file-based router reaches. Navigating between `/form` and `/switcher` is a real `window.location.assign` (a full page load, not a client-side transition) with the target URL built by pure helpers in `router.ts` (`buildSwitcherRedirectUrl`, `buildFormUrlForSelectedSite`, `hashHasFormId` — see the next item for how `hashHasFormId` is actually used now). `entry-index.ts` on the landing page only forwards a stray visit still carrying the old bare-`/`-plus-hash link shape to `/form`. Confirmed via a real production build that this actually shrinks what each page ships: `/form`'s bundle is ~25KB (field registry, submit pipeline, etc.), `/switcher`'s is ~1.7KB, `/`'s is ~0.2KB, and `/404` ships no script at all — previously every one of these was bundled into the single page's script regardless of which mode a visit actually needed.
- [x] **(New)** "Set up SKYE on another site" — from the site-picker step, an owner can bootstrap a site that has no SKYE setup yet. `renderAddSitePanel` (`siteSwitcher.ts`, controller `{ element, setStatus, setBusy }`) takes a SharePoint site URL; `entry-switcher.ts` runs `graph.resolveSiteByUrl(url)` (Graph hostname-path addressing → GUID; null on 404/403), then `graph.hasSkyeConfig(siteId)`, and if there's no config confirms via `showConfirmDialog` and calls `graph.installSkyeSiteConfig(siteId)`.
  - **SKYE data lives in a `skye_data` folder inside the site's Site Assets library.** (Earlier passes tried a folder in `Documents` then a dedicated `SKYE` library — the latter 403'd because `POST /sites/{id}/lists` needs a `manage`/`fullControl` grant and the IU test tenant's is `write`. Final answer: Site Assets — an ordinary library, so creating folders/files in it only needs `write` — but keep it out of `Documents`.) `RealGraphClient.skyeItemPath(siteId, rel)` resolves+caches the Site Assets driveId (`resolveSiteAssetsDrive` → `findSiteAssetsListId`). Site Assets is a **hidden system list** on many sites (Teams-provisioned especially) → excluded from BOTH the `/lists` and `/drives` *collection* responses (confirmed against `msteams_79e519`). What works, in order: (1) a **`$filter`** — `GET …/lists?$filter=displayName eq 'Site Assets'` returned the hidden list on `msteams_79e519` (`$filter=name eq …` → **400**, `name` isn't filterable, so that attempt was removed); (2) direct `GET …/lists/SiteAssets`; (3) paginated `/lists` scan; (4) `/drives` scan → `/drives/{id}/list`. Then `GET …/lists/{id}/drive`. Builds `/drives/{driveId}/root:/skye_data/…`; throws `SkyeNotConfiguredError` if there's no Site Assets library. **`listSkyeForms`/`listSkyeViews` now return `[]` on a 404** — a site can have `skye_data/config/skye.config.json` but not `skye_data/forms`/`skye_data/views` yet (the best-effort folder creation in `installSkyeSiteConfig` isn't guaranteed; those folders also get auto-created on the first form/view save). This was the "Something went wrong loading the switcher" bug: config resolved fine, then `listSkyeForms` threw an uncaught 404. `SkyeInstallResult` is `{ libraryListId: string | null, libraryName: "Site Assets" }`. `getListItemImage`/`uploadToLibrary` untouched.
  - **If the site has no Site Assets library, SKYE can't create it** (that's `POST /lists` again → the `manage`-grant 403). `installSkyeSiteConfig` throws `SkyeInstallError` kind `"siteAssetsMissing"`, and `entry-switcher.ts` shows `renderCreateSiteAssetsStep` — "One step in SharePoint first": a new-tab link to `{siteWebUrl}/_layouts/15/CreatePage.aspx` (adding+saving any page provisions Site Assets), a **"Check again"** button that re-runs the install (`runInstall`), and a **~30s auto-poll** (`setInterval`, 6×5s, `inFlight` guard, cleared on success/cancel/exhaustion) that advances on its own once the library shows up. Mock: a siteId containing `noassets` throws `siteAssetsMissing` the first time then succeeds (simulates the user creating it between retries).
  - **A "Manage permissions" step** (`renderPermissionsStep`) after install — Graph can't set SharePoint ACLs, so it tells the user Members can currently edit SKYE's files and (new tab, `noopener`) links to the **`skye_data` folder's** item-level permissions page: `buildFolderPermissionsUrl(siteWebUrl, listId, itemId)` → `…/_layouts/15/user.aspx?List={listId}&obj={listId},{itemId},LISTITEM&noredirect=true` (dashes `%2D`-encoded, no braces — the format SharePoint's own "Manage access → Advanced" produces for an item). `installSkyeSiteConfig` reads both ids from the `skye_data` folder's `GET {basePath}?$select=sharepointIds` → `{ listId, listItemId }`, returned as `SkyeInstallResult.{libraryListId, skyeDataItemId}`. Fallback: `buildLibraryPermissionsUrl` (whole library) if only the list id resolved; else no link (message still says to break inheritance on the `skye_data` folder). "I'm finished setting permissions" → `goToSite`. The inheritance break / Member demotion stays a manual SharePoint step (or a future SP-REST automation).
  - A 403 on the config **write** → `SkyeInstallError` kind `"forbidden"` — "you can't add files here, or SKYE's grant doesn't cover this site".
  - **(New) "Create New Form Config" button in the switcher's form/view picker.** `renderFormOrViewPicker` takes an optional 4th `onCreateNew` callback → renders `.skye-picker-create` ("Create New Form Config"), shown even when the site has no forms/views yet. It navigates to `buildBuilderUrl(siteId, applicationId, tenantId)` (`router.ts` — `/builder?siteId=…&applicationId=…[&tenantId=…][#formId]`), landing on the builder's "pick a form / start a new one" chooser.
    - **Gate: "can the user actually write into `skye_data`".** `entry-switcher.ts` shows the button when `(await graph.canWriteSkyeData(siteId)) || canEditFormConfigs(configFiles)`. `canWriteSkyeData` is a **new `GraphClient` method** — Graph has no reliable read-only signal for a user's effective permission on a folder (reading a driveItem's `permissions` collection itself needs manage-permissions rights, so a plain contributor false-negatives), so it's a **functional probe**: PUT a `skye-write-check.tmp` marker into `skye_data/` and DELETE it; 2xx on the PUT ⇒ write access. Any failure (403 read-only, no Site Assets library → `SkyeNotConfiguredError`, filename rejected, network) ⇒ `false` — safe for a UI gate that should hide the affordance when unsure. Plain name + `.tmp` extension (no leading dot) so a filename-validation 400 can't masquerade as "no access"; cleanup is best-effort (a stray marker is harmless, the next probe overwrites it). MockGraphClient: `true` on a set-up site, `false` for a `forbidden`/`readonly` siteId or one with no config yet.
    - **`lib/builder/permissions.ts`'s `canEditFormConfig` now ORs the same probe in first** (`if (await graph.canWriteSkyeData(siteId)) return true;` before the `builderEditors` check), so `/builder`'s own access gate and `/form`'s "Edit in Builder" link agree with the switcher button — a write-access user no longer hits a "you don't have edit permission" panel after clicking through. This **supersedes the earlier ⚠️** that a freshly-installed site showed no button until `builderEditors` was configured: any user who can write to `skye_data` (i.e. could Save at all) now gets the button and the builder. `builderEditors` stays as an explicit-allowlist fallback path.
    - 3 picker tests (button text updated to `/create new form config/i`), `builderPermissions.test.ts` extended (write-access short-circuits without consulting `builderEditors`), `mockGraphClient.test.ts` +1 (`canWriteSkyeData` across configured / not-set-up / read-only).
  - **Audited: every `skye_data` read/write goes through Site Assets.** All callers (`entry-form`/`entry-view`/`entry-switcher`/`entry-builder`, `lib/builder/*`) use only `GraphClient` methods — no raw path building — and in `RealGraphClient` every `skye_data`-touching method (`getSkyeFormConfigFiles`/`saveSkyeFormConfigFile`/`listFormDrafts`/`getFormDraft`/`saveFormDraft`/`publishFormDraft`/`listSkyeForms`/`getSkyeViewFiles`/`getSkyeSiteConfigFiles`/`listSkyeViews`/`hasSkyeConfig`/`installSkyeSiteConfig`) is routed through `skyeItemPath`/`siteAssetsDriveId`. `searchSitesWithSkyeData`'s `/search/query` for a folder named `skye_data` is inherently library-agnostic (unchanged; docstring notes the "search must index Site Assets folders" caveat and that the paste-a-URL panel is the reliable path). `getListItemImage`/`uploadToLibrary` are unrelated (arbitrary drives) and untouched. User-facing "not set up" strings updated to say "the site's Site Assets library".
  - Mock: `installedSites` mirrored to `sessionStorage` (same pattern as the form-config store) so an install on `/switcher` survives the navigation to the new site; `installSkyeSiteConfig` returns a fake `libraryListId`; a URL containing `notfound`/`missing` → null; a siteId containing `forbidden`/`readonly` → the forbidden error; a freshly-installed mock site lists no forms/views. 16 new tests (`addSitePanel.test.ts`, `mockGraphClient.test.ts`). Manually E2E-verified against the mock: resolve → confirm → install → Manage-permissions step (correct link URL) → "I'm finished" → empty form/view picker; plus the forbidden path.
  - **The paste box is forgiving about what URL you give it** (`lib/graph/siteUrl.ts`'s `parsePastedSiteUrl`, used by `resolveSiteByUrl` in both clients): a deep SharePoint URL (a library view, a page, a `_layouts` settings screen — `…/sites/msteams_79e519/Shared Documents/Forms/AllItems.aspx`) is reduced to its site root (`…/sites/msteams_79e519`, keeping the `/sites/` or `/teams/` managed-path segment; no such segment → the tenant root site). A **Teams channel deep link** (`teams.microsoft.com/l/…?groupId=<guid>`) yields the backing M365 group id, which `resolveSiteByUrl` turns into a site via `GET /groups/{groupId}/sites/root` — ⚠️ that call needs `Sites.Read.All` (or a `Group.*` scope), which is NOT in the current `Sites.Selected`-only `GRAPH_SCOPES`, so it 403s and falls back to null (the user pastes the SharePoint URL instead) until such a scope is added. Mock resolves Teams links to a synthetic per-group site so the flow is demoable. 9 tests in `siteUrl.test.ts`.
  - **Not yet fully verified against a live tenant** — Site Assets driveId resolution went through two dead ends against `msteams_79e519` (`GET …/drives` and plain `GET …/lists` both omit it — hidden system list), and now relies on `GET …/lists?$filter=displayName eq 'Site Assets'` (proven to return it there) or the direct `GET …/lists/SiteAssets`; confirm one of those yields a listId and `…/lists/{id}/drive` a usable `drive.id`. Also: whether the config PUT into Site Assets really only needs `write` (expected — it's item creation in an existing library), whether `/_layouts/15/CreatePage.aspx` reliably provisions Site Assets on save, and the Teams-link `/groups/{id}/sites/root` resolution (needs a scope beyond `Sites.Selected`). **`searchSitesWithSkyeData` (switcher step-1 list) confirmed NOT finding a `skye_data` folder inside Site Assets on `msteams_79e519`** — search is eventually consistent (a just-created folder isn't indexed for minutes+), and Site Assets content indexing is uncertain regardless. Mitigations added: broadened the hit filter (folder `name === "skye_data"` OR `webUrl` ends `/skye_data`), and a second source — `GET /me/followedSites` verified per-site with the Site-Assets-aware `hasSkyeConfig` — BUT `/me/followedSites` needs `Sites.Read.All` (not in GRAPH_SCOPES), so it 403s and no-ops today. **Reliable path for a specific site: the "set up SKYE on another site" paste box** (`resolveSiteByUrl` + `hasSkyeConfig`, both Site-Assets-aware) — it reports "already set up, opening" and navigates in. Step-1 copy now says a recent setup can take a few minutes to appear and points at the box. Also **hardened the search-hit parsing** (a likely cause): the trimmed `/search/query` `resource` often omits the `folder` facet AND `parentReference.siteId`, so the old filter dropped valid hits — now matches on `name === "skye_data"` OR `webUrl` ending `/skye_data` (no `folder` requirement) and derives the site from the hit's `webUrl` when `parentReference.siteId` is missing. **`/diag` got a "SKYE storage discovery" section** (`runSkyeStorageChecks`) — dumps the raw `/search/query` hits (name / folder-facet / parentRef.siteId / webUrl), `GET /me/followedSites`, and per given site id walks `hasSkyeConfig` + the raw `$filter`/direct list lookups. Run it in a real browser (`/diag?applicationId=…&tenantId=…`, site id in the box) to see which of index-lag / not-indexed / parsing is actually happening — can't be tested here without live-tenant credentials. A site set up *before* this change (with `skye_data` in `Documents`) would no longer be found — no such data exists yet, but noted.
  - **(New) Speed + strictness pass on the switcher's step-1 list** (user report: "it works but it's really slow" + "if `skye_data` ISN'T in Site Assets, that site shouldn't appear"). Two changes:
    - **Faster Site Assets driveId resolution** (`resolveSiteAssetsDrive`): the working `GET …/lists?$filter=displayName eq 'Site Assets'` call now also carries `$expand=drive`, so the driveId comes back in the SAME response — the separate `GET …/lists/{id}/drive` round-trip only happens on the slow-path fallback now. `findSiteAssetsListId`'s redundant first step (it repeated the same `$filter`) was removed; it starts at the direct `GET …/lists/SiteAssets` and the paginated scans. Per-site driveId is still cached for the session (`siteAssetsDriveCache`), so `hasSkyeConfig` across many candidates reuses it.
    - **`searchSitesWithSkyeData` no longer trusts a bare `skye_data` name.** A `/search/query` hit is only included WITHOUT a verifying call when its `webUrl` matches `/\/SiteAssets\/skye_data\/?$/i` — that path IS the proof it's in Site Assets. Any other `skye_data` hit (a stale index entry, an old copy in `Documents`, or a hit with no usable `webUrl`) now goes through `hasSkyeConfig(siteId)` and is dropped if it comes back false. Followed-sites candidates were already verified this way. **All candidates now resolve + verify in PARALLEL** (`Promise.allSettled` over the whole candidate list) instead of the old sequential `for…await` loops — the main source of the "really slow" — with a new private `readSite(siteId)` helper and dedupe by `siteId` after. Net effect: a site with no `skye_data` in Site Assets can't appear, and the list builds in roughly one round-trip's time regardless of candidate count.
- [x] **(New)** `/switcher` grew a second step: picking a form, not just a site — for a visit that arrives with no `formId` in the hash at all (browsing from scratch), rather than the original site-only case (a link to a specific form that's just missing `siteId`). Needed a new `GraphClient.listSkyeForms(siteId)` (real + mock; real implementation lists the `skye_data/forms/` subfolders the same way `getSkyeFormConfigFiles` already lists `[permission]` subfolders, reading each form's base config just far enough to get its `title`) and a `SkyeFormSummary { formId, title }` type. `entry-switcher.ts` now branches on what's already known: no `siteId` → site picker (`renderSiteSwitcher`); `siteId` known but `hashHasFormId` is false → form picker (`renderFormPicker`, new, factored alongside `renderSiteSwitcher` in `siteSwitcher.ts` via a shared `renderPickerList` helper — both are the same "list of buttons calling onSelect" shape); both already known → redirect straight to `/form`, nothing for the switcher to do. Picking a site when a `formId` was already known (the original case) still skips straight back to `/form` rather than detouring through the form-picker — `hashHasFormId` is what tells the two cases apart. Picking a form defaults to create mode (`buildFormUrlForSelectedForm`), since there's no existing item to edit/view yet. `buildSwitcherRedirectUrl` was extended to also carry `siteId` forward (previously dropped it entirely), so `/form?siteId=known&applicationId=x` with no formId correctly lands on the form-picker step instead of making the user re-pick a site they'd already specified. 7 new tests (`router.test.ts`, `siteSwitcher.test.ts`, `mockGraphClient.test.ts`).

## 4. Auth

- [x] MSAL popup flow (not redirect) — preserves in-memory state & hash on return. — *Implemented in `packages/app/src/lib/auth/authProvider.ts`. **Untested against a live tenant** — structurally complete but not exercised end-to-end; flag any issues found on first real auth attempt.*
- [x] Popup-blocked fallback → redirect flow, with graceful hash/state recovery. — *Falls back to `loginRedirect` on popup failure; "graceful hash/state recovery" specifically (restoring the SPA's in-memory state after the redirect round-trip) is not yet implemented — the redirect unloads the page and nothing currently restores post-redirect state on return. Flagged as a gap, not silently assumed solved.*
- [x] `applicationId` comes from the URL, not a build-time constant → cache `PublicClientApplication` instances per `applicationId` (lazy-init map). — *Implemented via the `msalInstances` Map in `authProvider.ts`, now keyed by `(applicationId, tenantId)` — see the next item.*
- [x] Confirm authority: assuming multi-tenant (`/common`). — **Resolved against a real tenant (this was the very first live-auth attempt): a single-tenant Azure app registration rejects `/common` outright with `AADSTS50194`.** `/common` is only valid for an actually-multi-tenant app registration — it was never a safe universal default. Fixed by adding an optional `tenantId`, threaded through the exact same mechanism as `siteId`/`applicationId`: a `?tenantId=` URL param (parsed in `router.ts`'s `parseRoute`/`FormRoute`/`UnresolvedRoute`, carried through every `/form` ↔ `/switcher` redirect builder alongside the other two) with a `PUBLIC_DEFAULT_TENANT_ID` env fallback in `entry-switcher.ts` mirroring `PUBLIC_DEFAULT_APPLICATION_ID`. `authProvider.ts`'s `getMsalInstance` now builds `https://login.microsoftonline.com/${tenantId ?? "common"}` and caches MSAL instances per `(applicationId, tenantId)` pair. Omitting `tenantId` still assumes multi-tenant `/common`, so this is purely additive — no behavior change for an actually-multi-tenant app registration. Not hardcoded anywhere, per instruction. 6 new/updated tests in `router.test.ts`.
- [x] `Sites.ReadWrite.All` delegated scope — confirm admin consent is already granted in target tenant(s) before first real test. — **Resolved/superseded against a real tenant**: hit `AADSTS65001` ("SKYE needs permission... only an admin can grant") on the very first real login, exactly as this item warned. Root cause once dug into: the target Azure app registration was actually configured with `Sites.Selected` (not `Sites.ReadWrite.All`, which the code was requesting) plus `Calendars.ReadWrite.Shared`/`User.ReadBasic.All` — a real scope MISMATCH, not just a missing-consent issue; even after consent, the code's `Sites.ReadWrite.All` request would've failed on its own since that permission isn't on the app registration at all. Deliberately chose to keep `Sites.Selected` (narrower/more secure) rather than switch the app registration to `Sites.ReadWrite.All` — `GRAPH_SCOPES` in `authProvider.ts` now requests all three (`Sites.Selected`, `Calendars.ReadWrite.Shared`, `User.ReadBasic.All`) together, since a Graph access token is scoped to exactly what's requested at acquisition, not to everything admin-consented overall. **Real, not-yet-actionable consequence**: `Sites.Selected` means the app has zero site access by default — a tenant/SharePoint admin must explicitly grant it access to each specific site (SharePoint Admin Center's "API access" page, if enabled, or an out-of-band `Sites.FullControl.All`-privileged `POST /sites/{siteId}/permissions` call — SKYE has no client-credentials flow to make that call as itself) before ANY Graph call against that site works, even after the permission itself is admin-consented. This also means `GraphClient.searchSitesWithSkyeData()`'s tenant-wide `/search/query` can only ever surface sites already explicitly granted — under `Sites.Selected` it can't discover a brand-new site the way it could under `Sites.ReadWrite.All`. **Not addressed yet**: whether/how the site-switcher should behave differently under `Sites.Selected` (e.g. some other site-discovery mechanism, since tenant-wide search is structurally limited now) — flagged here rather than guessed at, since it's a real design question, not a bug.
- [x] **(New)** `pages/diag.astro` + `scripts/entry-diag.ts` — a standalone Graph auth/permissions diagnostic page, not part of SKYE's real routing. Built specifically to isolate "is this an app-registration/consent problem (nothing works at all) vs. one specific scope vs. one specific site's `Sites.Selected` grant" during real-tenant debugging, since a single opaque login failure couldn't distinguish those. Reuses SKYE's actual `authProvider.ts`/`RealGraphClient` code directly (bypassing the `PUBLIC_MOCK_GRAPH` switch entirely, since the whole point is real-tenant testing) rather than a separate reimplementation, so it's testing the real code path. Runs, and reports pass/fail with the real HTTP status/error for each: token acquisition; `GET /me` (baseline, no special scope); `GET /me/events` (`Calendars.ReadWrite.Shared`); `searchPeople('')` (`User.ReadBasic.All`, via the real `GraphClient` method); then per-site `GET /sites/{id}` + `/sites/{id}/lists` for however many site ids are given; then `getListColumns` against the first site + a given list id. Takes `applicationId`/`tenantId`/`sites` (comma-separated)/`listId` via URL params (prefilling a form, not hardcoded) or manual entry. **Found and worth remembering**: the site ids IT/an admin hands you for a `Sites.Selected` grant are typically the M365 **group** id (from the Entra ID group's Azure Portal URL), which is NOT the same as the Graph **site** id `/sites/{id}` expects — use Graph's `hostname:/server-relative-path` addressing instead (built from the site's own SharePoint URL) or resolve the group id via `GET /groups/{groupId}/sites/root` first, otherwise you get a confusing "bad id" failure that looks like a permissions problem but isn't one. **Extended further** (still same session): `acquireToken` in `authProvider.ts` gained an optional third `scopes` parameter (defaulting to the full app-wide `GRAPH_SCOPES`, now exported, so every real call site is unaffected) specifically so this diag page can probe each scope individually — `runDiagnostics` now tries each of `GRAPH_SCOPES` alone (before the combined request the real app makes), since Azure AD combining scopes into one request can genuinely behave differently from each working individually (a real, not just theoretical, distinction worth being able to see). Also added a write test: `createListItem` then immediately `deleteListItem` on a throwaway item, run independently of whether the read checks passed (read and write access under `Sites.Selected` are governed by separate roles on the site grant, so they can be asymmetric) — deliberately cleans up after itself so nothing is left behind in a real list regardless of outcome. Also gained `handleRedirectPromise()` in `acquireToken` (a real, separate fix, not diag-specific — see below) and the diag page no longer auto-runs on load, both landed after hitting a stuck-`interaction_in_progress` state mid-debugging. **First full real-tenant run turned up three more real findings**:
  1. `Calendars.ReadWrite.Shared` needs admin consent that hasn't been granted yet (confirmed in isolation — `Sites.Selected` and `User.ReadBasic.All` both work alone and combined). Temporarily commented out of `GRAPH_SCOPES` (clearly marked, dated) so testing everything else isn't blocked on it — Teams/Outlook calendar actions will fail until it's restored.
  2. **Real bug, not diag-specific**: `GraphClient.searchPeople("")` (an empty query) failed with a Graph 400 (`"Clause 'displayName:' in $search is of right format..."`) — Graph rejects `$search: '"displayName:"'` (empty value) as malformed. `MockGraphClient.searchPeople` already had an established "no query -> just list some users" contract (with its own passing test), but the real client never implemented that fallback — it always sent `$search` even for an empty string. Fixed in `graphClient.ts` to match the mock's contract: skip `$search` entirely for an empty/whitespace query.
  3. **Diag-tool-only bug**: the per-site `/lists` check 404'd ("does not represent a site") for every `hostname:/path`-addressed site (all 3 of the ones IT granted), while the plain `/sites/{id}` read succeeded for the same ids — a URL-construction bug, not a permissions problem. Graph's hostname-path addressing needs a SECOND colon before appending a sub-resource (`GET /sites/{hostname}:/{path}:/lists`, not `.../{path}/lists`); a raw site GUID needs no colon at all. Fixed with a small `siteSubResourcePath` helper in `entry-diag.ts`.
  4. ~~Still open~~ **Resolved**: the listId given for "TestList" was wrong (a different list's id, pasted by mistake) — corrected once caught; `getListColumns` against the right id returns the expected ~15 custom columns.
- [x] **(New)** Found a second real bug in the diag flow itself, this time a genuine one (not just diag-tool-only like the colon-path issue above): `acquireToken`'s `loginPopup`-fails-then-`loginRedirect`-fallback behavior means a CANCELLED interactive prompt (e.g. clicking "Return to Application without Granting" on an admin-approval-required screen, or any other popup rejection) triggers a full-page `loginRedirect` navigation — which for `diag.astro` specifically destroys the entire diagnostics run (page unloads, every result gathered so far is gone) rather than just failing that one check. Fixed with a new `acquireTokenPopupOnly(applicationId, tenantId, scopes)` in `authProvider.ts` — silent-then-popup only, NO redirect fallback, so a cancelled/failed popup just rejects normally and the diag page's own try/catch records it as one failed row and moves on. Deliberately NOT changed in the real app's own `acquireToken` — the redirect fallback is genuinely wanted there, for a real end user whose popup got blocked by browser settings. `initAndTrySilent` factored out as a shared first step for both functions. `entry-diag.ts`'s scope probes and its combined-token step both switched to the new function.
- [x] **(New)** `GRAPH_SCOPES` extended to cover the plugin actions built earlier this session, not just the ones already confirmed working: added `Chat.Create`/`ChatMessage.Send` (`teams.createChat`/`teams.sendMessage`) and `Mail.Send` (`outlook.sendEmail`) alongside the existing `Sites.Selected`/`Calendars.ReadWrite.Shared`/`User.ReadBasic.All`, so `diag.astro`'s per-scope probes cover the full set the app's plugin actions actually need. `Calendars.ReadWrite.Shared` also un-commented now that the flow-stopping bug above is fixed — no more reason to keep it out of the list just to avoid it blocking everything else. **Deliberately NOT added**: an actual write test (send a real Teams message / send a real email) for the new scopes, unlike the SharePoint list write test — those have real, harder-to-reverse side effects (a message someone actually receives, an email someone actually gets) compared to a list item that's trivially created-then-deleted with nothing left behind. Left as token-acquisition-only probes; a real send-test would need an explicit ask and a safe target (e.g. a chat with just yourself, an email to your own address).
- [x] **(New)** Calendar-scope deep dive added to `entry-diag.ts` — deliberately kept SEPARATE from `GRAPH_SCOPES` (a local `CALENDAR_SCOPES_TO_TEST` array), since only one calendar scope would ever actually ship and this is a one-time comparison to decide which: `Calendars.Read.Shared`, `Calendars.ReadBasic`, `Calendars.ReadWrite`, `Calendars.ReadWrite.Shared`, each acquired as its own isolated token, each listing `GET /me/calendars` by name, then sampling one event (`GET /me/calendars/{id}/events?$top=1`, summarized to subject/start/end/organizer) from EVERY calendar found under that scope — not just the first — so each calendar's access is individually confirmable. Read-only by design, same reasoning as the Teams/email scopes above (no event created). **Found immediately on first real use**: originally placed AFTER the combined-token gate (step 2's early `return` on failure) — meaning the combined request failing (one scope in `GRAPH_SCOPES` needing consent) silently skipped the entire calendar deep dive too, even though it doesn't depend on that token at all (it acquires its own isolated per-scope tokens). This was the SAME "one failure stops everything" class of problem as the redirect-navigation bug above, just via an intentional early return this time rather than a page unload. Moved to run right after the general scope probes, before the combined-token gate, so it's now unconditional.
- [x] **(New)** `EXPLORATORY_SCOPES_TO_TEST` added to `entry-diag.ts` — 22 scopes for possible future actions, none confirmed granted yet, deliberately kept separate from `GRAPH_SCOPES` (not what the app actually ships) and probed token-acquisition-only (no per-scope read/write Graph call — several of these have no natural "read" verification at all, e.g. `TeamsActivity.Send`/`UserActivity.ReadWrite.CreatedByApp`, and a full read/write test across 22 scopes would mean a lot of real Graph mutations for scopes with no concrete use case yet). Grouped by category (Teams channels, Teams activity feed, Presence, Online meetings, Files, Tasks/Planner, Chat read, Notifications, People, User activity, User notifications, Bookings) via a `runScopeProbe` label override, so the results table reads in the same groups they were requested in. Placed alongside the calendar deep dive, before the combined-token gate, for the same independence reasoning.
- [x] **(New)** First full real-tenant results from all of the above — recorded as a standing reference in **CLAUDE.md's new "Real-tenant Graph permissions (IU) — what's available for actions/postActions" section**, not duplicated here. Summary: `Sites.Selected`/`User.ReadBasic.All`/`Chat.Create`/`ChatMessage.Send`/`Mail.Send` (everything already built) confirmed working, plus most of the exploratory batch (Teams channels, activity feed, presence, files, chat-read, notifications, Bookings — none yet built against, but available). `Calendars.ReadWrite.Shared` confirmed blocked (real `access_denied`) — breaks the calendar-writing half of the already-built `teams.scheduleMeeting`/`outlook.createCalendarEvent` at runtime. The other 3 calendar variants + `OnlineMeetings.ReadWrite`/`Tasks.ReadWrite`/`Tasks.ReadWrite.Shared`/`People.Read` came back `user_cancelled` rather than `access_denied` — a weaker, client-side-only signal, documented as "treat as unusable for now, but re-test in isolation before trusting it as final" rather than presented as equally confirmed. Documented the `redirect` postAction type (already exists, no new code) as the concrete workaround for calendar/meeting/task actions until/unless IU grants these — a prefilled Outlook/Teams/To Do deep link instead of a Graph write.
- [x] **(New)** `runCalendarAccessWithCurrentScopes` added to `entry-diag.ts` — directly tests whether calendar data is reachable using ONLY an already-confirmed-working, non-`Calendars.*` scope (`User.ReadBasic.All`), rather than just inferring it from the token-acquisition probes above. Acquires its own isolated token (no `Calendars.*`/`OnlineMeetings` at all), then tries `GET /me/events`, `GET /users/{owner}/calendar`, and `GET /users/{owner}/events` against the specific shared-calendar mailbox behind the real published-ICS link tested outside this tool (`f4d4003a2c8f4d76a186ce29f6eab54c@iu.edu`). Per Graph's documented permission model `Calendars.*` should be the only scope family gating this resource at all — expected result is three 403s — but verified rather than assumed, same reasoning as everything else in this tool. Independent placement (before the combined-token gate), same as the calendar deep dive and exploratory-scope batch. **Results, recorded in CLAUDE.md's permissions section, not duplicated here**: `/me/events` came back a clean `403 ErrorAccessDenied` as expected, confirming directly (not just inferred) that no currently-granted scope leaks calendar access. The shared-calendar checks came back `404 ErrorInvalidUser` instead — a different, unexpected finding: the identifier embedded in a published-ICS URL (`f4d4003a2c8f4d76a186ce29f6eab54c@iu.edu`) looks like a mailbox GUID dressed up as an email (32 hex chars, GUID-shaped) and isn't a real Graph-resolvable UPN at all, regardless of scope.
- [x] **(New)** `Calendars.ReadWrite.Shared` **removed from `GRAPH_SCOPES`** (`authProvider.ts`). MSAL requests the whole scope set in one interactive token call, so a scope that needs ungranted admin consent (as this one does on IU — confirmed `access_denied`) fails the *entire* sign-in, not just calendar actions. `GRAPH_SCOPES` is now exactly the confirmed-working set: `Sites.Selected` / `User.ReadBasic.All` / `Chat.Create` / `ChatMessage.Send` / `Mail.Send`. Consequence (already true in practice, now also true of the token): `teams.scheduleMeeting` / `outlook.createCalendarEvent` fail at runtime — the `redirect` deep-link workaround (`outlook.buildCalendarEventDeepLink`, see below) is the path. `diag.astro`'s `GET /me/events` check now expects a 403 and is labelled as a standing "did IU grant a calendar scope yet?" signal. If they do, add back exactly that one scope and re-test the combined sign-in. No tests referenced `GRAPH_SCOPES`, so none changed.
- [x] **(New)** The three expensive, repeatable sections (per-scope probes, calendar-scope deep dive, exploratory-scope batch — 32 individual interactive prompts combined) made **opt-in via checkboxes**, defaulting OFF. Each was originally unconditional, meaning every diagnostics run re-triggered all 32+ popups even once their answers were already known from a prior run — a real usability problem hit directly during testing ("a bunch of launch windows"). A skipped section still gets one row in the results table (new `CheckRow` status `"skipped"`) explaining it was intentionally not run, rather than just having fewer rows with no explanation. `runCalendarAccessWithCurrentScopes` (the one thing without an already-known answer yet) stays unconditional. `runDiagnostics` now takes a `DiagnosticOptions` param read from the three checkboxes at submit time.
- [x] **(New)** Two calendar actions implementing the deep-link workaround from CLAUDE.md's permissions section, since `Calendars.*` remains unavailable: `outlook.buildCalendarEventDeepLink` and `outlook.verifyCalendarEventByIcs`, both in `src/app/src/actions/outlook/`.
  - `buildCalendarEventDeepLink` builds a pre-filled Outlook Web "new event" compose URL (deliberately does NOT write via Graph, and does NOT navigate itself) and embeds a unique marker (`[SKYE-VERIFY:<id>]`, `crypto.randomUUID()` if not given) in the event body. Returns `{ url, verificationId }` — chain a `redirect` postAction via `{{results.<key>.url}}` to actually send the user there (the existing `redirect` type; no new orchestration needed), same "build, then a plain postAction acts on it" pattern as `teams.createChat` → `teams.sendMessage`.
  - `verifyCalendarEventByIcs` takes `icsProxyUrl` (author-configured in the form config — SKYE assumes a server-side proxy already exists and is reachable there; it does not implement one, per the CORS finding in CLAUDE.md) and `verificationId`, fetches via `ctx.httpFetch`, and searches for the marker across all `VEVENT` blocks (RFC 5545 line-unfolding first, so a wrapped `DESCRIPTION` doesn't produce a false miss). Returns only `{ found, verificationId }` — deliberately never the raw ICS text — into `{{results...}}`, so the rest of the calendar's contents don't flow into postAction templating just because one event needed confirming. Throws a clear error (not a silent `found: false`) if the proxy request fails or the response doesn't look like ICS content at all, so a broken proxy can't masquerade as "event not found yet."
  - The marker format (`buildVerificationMarker`/`icsContainsVerificationMarker`/`unfoldIcs`) lives in one shared `outlook/calendarVerificationMarker.ts`, used by both actions, so the embed and search sides can't drift out of sync.
  - **Not yet verified against a real tenant**: the exact Outlook Web deep-link query parameters (`startdt`/`enddt`/etc.) are a commonly-observed URL pattern, not an officially documented API — worth confirming the compose screen actually pre-fills correctly before relying on this in production. The ICS proxy itself also doesn't exist yet — `verifyCalendarEventByIcs` assumes one is already deployed and reachable at whatever `icsProxyUrl` a form config supplies; SKYE has no proxy of its own (see CLAUDE.md's CORS finding for why one is needed at all).
  - 14 new tests (`calendarVerificationMarker.test.ts`, `buildCalendarEventDeepLink.test.ts`, `verifyCalendarEventByIcs.test.ts`, plus a `calendarDeepLinkVerifyChaining.test.ts` proving the real generated `verificationId` — not a hardcoded placeholder — flows through `dependsOn`/`{{results.x}}` templating end-to-end).
- [x] **(New)** First **entirely new third-party service** in the actions system (not Microsoft Graph at all): **Campus Labs Engage** (`src/app/src/actions/engage/`), a campus-involvement platform with its own simple API-key auth (`X-Engage-Api-Key` header — confirmed from the real OpenAPI spec at `https://engage-api.campuslabs.com/swagger/swagger.json`, fetched and parsed directly since the request/response schemas needed to be exact, not summarized/lossy). Scoped deliberately, not a full API wrapper — the real API is ~60+ endpoints across a dozen+ areas (Events, 9 separate Finance sub-areas, Forms, Memberships, Organizations, News, Paths/badges, Room Reservations, Wallet); confirmed with the user to implement just the **Events** area for this first pass (create/RSVP/attendance), leaving Finance/Room Reservations/etc. as explicit future follow-ups rather than guessing at a huge amount of speculative code with no concrete use case yet.
  - `engage.createEvent` (`POST /v3.0/events/event`), `engage.rsvpToEvent` (`POST /v3.0/events/event/{id}/rsvp`), `engage.recordAttendance` (`POST /v3.0/events/event/{id}/attendance`) — each requires `apiKey` (config-supplied, never hardcoded) and accepts an optional `baseUrl` override, since requests sometimes go through a school-specific whitelabeled domain instead of the default `https://engage-api.campuslabs.com/api` (per explicit instruction — this is why `baseUrl` isn't a fixed constant anywhere).
  - **Found via the real schema, not the lossy summary**: `address` on `createEvent` is a structured object (`name`/`address`/`line1`/`city`/`state`/`zip`/`onlineLocation`/...), not a plain string — an initial AI-generated summary of the spec got this wrong; only fetching and parsing the raw JSON directly (not a summarized description of it) caught it. Worth remembering generally: don't trust a summarized reading of a large spec for exact request shapes — pull the raw schema.
  - All three share a `userId`/`submittedById` "UserIdentifier" shape (`EngageUserIdentifier` — any ONE of `campusEmail`/`accountId`/`username`/`communityMemberId`/`sisId`/`swipeCardIdentifier`), a `DEFAULT_ENGAGE_BASE_URL` fallback, and the ok-check/JSON-parse/error-message boilerplate, all in one shared `engage/client.ts` — mirrors `outlook/`'s `graphJson.ts`/`calendarVerificationMarker.ts` pattern of one small shared helper per service folder.
  - **Not yet tested against a real Engage instance/API key** — built directly from the published OpenAPI spec, structurally reasonable but unverified end-to-end, same caveat as everything else in this project that hasn't been exercised against its real external system yet.
  - 13 new tests (`engageActions.test.ts`, covering all three actions + `hasAnyIdentifier`).
  - **(Update)** `apiKey` made OPTIONAL on all three actions and `engageFetch` — some whitelabeled Engage deployments route through a middleman/proxy that injects the real API key itself server-side, so SKYE shouldn't require one. When omitted, `X-Engage-Api-Key` is left off the request entirely rather than sent empty, so a proxy can't confuse "no key" with "authenticating as nobody." 2 new tests confirming the header is genuinely absent (not just empty) when `apiKey` isn't given.
  - **(Update)** Full CRUD rounded out for Events, Attendance, and RSVPs: `engage.updateEvent` (`PATCH /v3.0/events/event/{id}`), `engage.cancelEvent` (`POST /v3.0/events/event/{id}/cancel`), `engage.updateRsvp` (`PATCH /v3.0/events/event/{id}/rsvp/{id}`), `engage.recordAttendance`'s companions `engage.updateAttendance` (`PATCH /v3.0/events/event/{id}/attendance/{id}`) and `engage.deleteAttendance` (`DELETE /v3.0/events/event/{id}/attendance/{id}`).
    - **Found via the raw spec (again, not a summary)**: Engage's PATCH endpoints take an **RFC 6902 JSON Patch body** (`[{op, path, value}, ...]`), not a plain partial object — a new `buildReplacePatch(changes)` helper in `engage/client.ts` builds the `{op: "replace", ...}` array from a plain "what's changing" object (skipping `undefined` keys) so form authors and action code never write raw patch syntax by hand.
    - **Two real business rules straight from Engage's own docs, not guessed**: (1) `engage.updateEvent` requires `submittedById` on *every* update, even when no other field about "who changed this" is relevant — enforced with a clear validation error rather than silently omitting it; per the spec's own example, `submittedById` uses op `"add"` while every other changed field uses `"replace"`. (2) An event's cancellation state can **only** be changed via the dedicated `/cancel` endpoint — `updateEvent`'s general PATCH deliberately never accepts a `status`/`state` field, to avoid a form author reasonably-but-wrongly assuming `updateEvent({ eventId, status: "Canceled" })` would work.
    - **Two deliberate non-additions, both because the endpoints genuinely don't exist** (confirmed from the raw spec, not assumed): there is **no `engage.deleteEvent`** — Events only support `GET`/`PATCH` (+ the separate `/cancel` POST), no DELETE at all, so `cancelEvent` is the actual real-world equivalent and is documented as such in its own file. There is **no `engage.deleteRsvp`** — RSVPs only support `GET`/`POST`/`PATCH`; Engage's own supported way to withdraw an RSVP is `engage.updateRsvp({ ..., response: "No" })`, which `updateRsvp.ts`'s docstring calls out explicitly so nobody goes looking for a delete action that was never built because it can't be. Attendance, by contrast, genuinely does support DELETE, so `engage.deleteAttendance` is a real one-to-one wrapper.
    - 14 new tests (`engageActions.test.ts`, now 27 total for the Engage service) covering the happy path (URL/method/body shape) and validation errors for all five new actions, plus `buildReplacePatch` itself (op shape, `undefined`-skipping, empty-input case). `actionsRegistry.test.ts` updated for the now-8-action Engage registry (15 actions total across all services). Not yet exercised against a real Engage tenant/API key, same standing caveat as the rest of this service.
- [x] **(New)** `acquireToken` never called MSAL's `handleRedirectPromise()` — a real, standing gap in `authProvider.ts`, not just a diag-tool issue. Without it, an interrupted/failed `loginRedirect` fallback round-trip leaves MSAL's `sessionStorage`-persisted "interaction in progress" flag stuck forever for that browser tab; every subsequent `acquireToken` call then fails immediately with `interaction_in_progress`, regardless of whether the original problem (consent, site grant, etc.) is even still present — discovered exactly this way during real-tenant debugging. Fixed by calling it once right after `msal.initialize()`; safe/idempotent when there's no pending redirect to process.
- [x] **(New)** Landing on `/` with an OAuth error in the hash (e.g. `#error=access_denied&error_subcode=cancel...` — MSAL's `redirectUri` is the bare origin, so a failed `loginRedirect` always lands here first) used to be silently misread as a garbage `formId` and bounced through several unresolved-route redirects ending on a blank `/switcher` page with zero explanation. Added `parseAuthErrorFromHash` to `router.ts` (checked in `entry-index.ts` before the existing stray-link redirect) so this now shows a clear, specific message on the landing page instead. 3 new tests.

## 5. Permissions — directory-ACL based (no app-level role logic)

- [x] `configService.ts` lists `[permission]` subfolders under `skye_data/forms/[id]/`, relies on Graph to omit/403 folders the signed-in user can't see, `.catch(() => null)` on any overlay fetch failure. — *Implemented as `getSkyeFormConfigFiles` in `packages/app/src/lib/graph/graphClient.ts` (real) and mirrored in `mockGraphClient.ts` (mock, fixed fixture set). Real implementation catches per-overlay read failures without failing the whole form load; **untested against a live tenant**.*
- [ ] Adopt numeric-prefix naming convention for `[permission]` folders (`10-editor`, `20-admin`) for deterministic overlay merge order when a user is in multiple groups at once. — *Not yet enforced anywhere — current real implementation just sorts folder names alphabetically, which happens to give a deterministic order but doesn't encode intent the way a numeric prefix would. Revisit once you have real permission folder names to test against.*
- [x] **Verify in a real tenant**: does Graph's children-listing actually omit inaccessible folders, or does it return names but 403 on content? — *Still unverified (needs a live tenant), but the real implementation is now written to tolerate either answer: a 403 on an individual overlay's content fetch is caught and skipped rather than failing the whole form load. Marking this implementation-complete; the tenant behavior itself is still an open empirical question, not a code gap.*
- [x] `lintOverlay.ts`: additive-only checker (no removed keys, no stricter constraints than base) — run in dev on every config load, plus a standalone `pnpm lint:configs` for CI/pre-publish. — *Both implemented: `merge/lintOverlay.ts` (library function) and `scripts/lintConfigs.ts` (CLI, walks a local `skye_data/forms/` checkout, also checks grid-row token-count consistency). Verified end-to-end against the real base+admin example configs, including confirming it actually catches an injected stricter-constraint violation.*
- [x] **(New, found while validating a real-tenant test config)** `lintConfigs.ts` resolved its own schema files via `new URL(SCHEMA_PATH).pathname`, which leaves percent-encoding (e.g. `%20` for a space) in the returned string instead of decoding it back to a real filesystem path — so `pnpm lint:configs` threw `ENOENT` on any checkout under a directory containing a space, which is exactly where this repo lives (`.../Personal Projects/SKYE`). It had apparently never actually been run successfully from this checkout before. Fixed by switching to `fileURLToPath` from `node:url`, which decodes correctly. No test previously exercised the CLI script itself (only the library functions it calls), so this went unnoticed — worth a standing note, not just a one-off fix.

## 6. Config loading & merge

- [x] `mergeConfig.ts`: RFC 7396 merge patch; treat a literal `null` in an overlay as a **lint error** (delete semantics are intentionally unsupported), not a real delete. — *Implemented in `packages/skye-config/src/merge/mergeConfig.ts`; also see `lintOverlay.ts` + `assertOverlayIsAdditive`.*
- [ ] Cache list-column schema fetches in-session (rarely changes, no need to refetch per form open). — *Still not built — `RealGraphClient.getListColumns` re-fetches every call. Small, isolated follow-up.*
- [x] Local dev / offline mode: `MOCK_GRAPH=1` serving fixture JSON — *Implemented: `packages/app/src/lib/mock-graph/` (fixtures for list columns, base config, admin overlay, one sample item) + `MockGraphClient` implementing the full `GraphClient` interface, including a simulated 412 on etag mismatch. Selected via `createGraphClient.ts` reading `import.meta.env.MOCK_GRAPH`. Verified: Astro production build succeeds with `MOCK_GRAPH=1` set, and 5 tests exercise the mock client directly.*

## 7. Rendering — the field registry ("rosetta stone")

- [x] Web Components for non-native controls (`peoplePicker`, `lookupPicker`, `lookupTable`, `richtext`, `calculatedDisplay`); native elements for everything with a direct HTML equivalent. — *Implemented: `packages/app/src/lib/render/fieldRegistry.ts` (the mapping) + `packages/app/src/elements/registerElements.ts` (the 5 custom elements). **Upgraded from placeholders to real, working implementations this session**: `skye-people-picker`/`skye-lookup-picker` are real debounced search-as-you-type controls (dispatching `skye-people-search`/`skye-lookup-search` events that `entry-form.ts` fulfills against the Graph client — keeps the elements themselves Graph-agnostic); `skye-lookup-table` is a real editable table with add/remove/delete rows and per-column inputs (text/number/select), wired to `writeLookupTableRows`. `skye-richtext` is a **deliberate exception**: per explicit instruction, it's a minimal placeholder by design — a plain contenteditable for basic text entry plus a purely visual (CSS/HTML only, no click handlers) toolbar bar, with no formatting logic at all. This replaced an earlier `execCommand`-based toolbar from a prior pass, which added complexity/deprecated-API risk without being a real upgrade path anyway. Styling is intentionally minimal per instruction — markup and logic were the focus, not visual design. 11 tests in `__tests__/registerElements.test.ts`.*
- [x] `mapChildren` support for parent/child controls (`select`→`option`, `radio`/`checkboxGroup` groups). — *Implemented as `buildChildren` in `fieldRegistry.ts`; `radio`/`checkboxGroup` render into a `<fieldset>` of labeled inputs sharing the field's `bindTo` as the `name`.*
- [ ] Rich text editor library choice for `skye-richtext` — pick one (Tiptap suggested) before building that element, keep it isolated behind the custom element so it's swappable. — *Still open by design. `SkyeRichtext` is intentionally a minimal placeholder (plain contenteditable + a purely visual toolbar, zero formatting logic, no `execCommand`, no click handlers) rather than a partial real implementation — per explicit instruction, the goal was basic text functionality plus HTML/CSS placeholders only, so there's less to unwind when a real editor library goes in. The get/set `value` + `skye-change` event contract is the one thing a real implementation must preserve (that's what `fieldRegistry.ts`/`renderForm.ts` depend on) — everything else inside the element is fair game to replace wholesale.*
- [x] `layoutEngine.ts`: `gridTemplateColumns`/`gridTemplateAreas`/`gridTemplateRows` → real CSS Grid; note the "equal token count per row" and "valid rectangular grid" checks are lint-time, not schema-enforceable. — *Implemented in `packages/app/src/lib/render/layoutEngine.ts` (`applyPageLayout`). The token-count/rectangular-grid check itself already lives in `packages/skye-config`'s `lint:configs` CLI (§5), not here — this file only applies whatever layout the (already-linted) config declares.*
- [ ] Accessibility pass on custom elements (ARIA roles/labels) — not yet scoped in detail, flag before elements ship. — *Still open; the now-functional pickers/table/richtext still have no ARIA attributes (e.g. the search dropdown isn't announced as a listbox, the richtext toolbar buttons aren't labeled for screen readers). Worth doing now that the interaction patterns are real rather than placeholder, since ARIA roles depend on the actual interaction model.*
- [x] **(New)** `relatedList` schema property for `lookupPicker`. — *Found necessary while implementing the real lookupPicker: the schema had no way to say which related list a lookupPicker searches (`lookupTable` has `table.relatedList`, but plain `lookupPicker` fields had nothing analogous). Added `field.relatedList: { id, siteId?, displayField }` to `form.config.schema.json`, required when `controlType` is `lookupPicker`. Mirrors the earlier `fileStorage`/`calculatedExpression`/overlay-schema pattern of fixing schema gaps as they're found during implementation rather than working around them silently.*
- [x] **(New)** `GraphClient.searchPeople`/`searchLookupItems`. — *Added to the `GraphClient` interface (`packages/app/src/lib/graph/types.ts`) to back the two search pickers. Real implementation uses Graph's `/users?$search=` (directory search) and the existing `searchListItems` (for lookup); mock implementation uses a new `fixtures/people.json` and the existing per-list item store.*
- [x] **(New)** `calculatedDisplay` reactive recomputation. — *`renderForm.ts` now recomputes every `calculatedDisplay` field via `evaluateCalculatedExpression` after every field change (and once on initial render), writing the result both into `values` (so it flows into postAction templating/submission like any other field) and onto the control's displayed value. Tested in `renderForm.test.ts` with a `quantity * price` example.*
- [x] **(New)** Etag-conflict UX. — *Added a distinguishable `EtagConflictError` class to `GraphClient` (thrown by both mock and real clients on a 412/simulated mismatch) so `submitForm.ts` can set `result.conflict = true` instead of a generic failure. `entry-form.ts` shows a specific "someone else changed this item since you opened it" message for that case. Tested in both `mockGraphClient.test.ts` and `submitForm.test.ts`.*

## 8. Validation

- [x] Native constraint mapping: `required`/`minlength`/`maxlength`/`min`/`max`/`pattern` → real Constraint Validation API. — *Implemented as pure logic in `validation/nativeValidators.ts` (`validateField`), returning a result the app wires to `setCustomValidity`. Checks in the same priority order native HTML uses.*
- [x] `matchesField` (SKYE-specific, no native equivalent) — cross-field check. — *Included in `validateField`.*
- [x] `customValidators` → hardcoded registry lookup (see §2), loud error on unregistered name. — *`runCustomValidators` in the same file.*

## 9. Post-actions & submit pipeline

- [x] `actionRunner.ts`: trigger-phase execution (`beforeSubmit`/`afterSubmit`/`onSuccess`/`onError`), `dependsOn` ordering, parallel execution where no dependency exists, skip-cascade on `when: false`. — *Implemented in `actions/actionRunner.ts` + `actions/dependencyGraph.ts` (topological batching via Kahn's algorithm, grouped into parallel batches). Tested end-to-end in `__tests__/actionRunner.test.ts` against a scenario mirroring the real example config's `createFollowupTicket`→`notifyCatering` chain.*
- [x] `handlers/registry.ts`: type → handler map, each a standalone file. — *Implemented: `actions/handlers/{httpRequest,graphRequest,redirect,showMessage,setField,script}.ts` + `defaultHandlerRegistry.ts`. Confirmed as a clean extension point — a new type is one file + one registry line.*
- [x] `templating.ts`: `{{fields.x}}` / `{{item.x}}` / `{{results.actionKey.path}}` interpolation. — *Implemented, recursively walks arbitrary JSON (so a whole `request.body` object can be templated at once). Missing/unresolved placeholders resolve to `""` rather than throwing.*
- [x] Core submit sequence (**not** postActions): beforeSubmit actions → write/patch primary item → write `parentReference`-mode `lookupTable` rows → afterSubmit actions → onSuccess/onError. — *Implemented in `packages/app/src/lib/submit/submitForm.ts`. A deliberate failure-handling policy is documented in its own docstring (not left implicit): a `beforeSubmit` failure aborts before anything is written to SharePoint and runs `onError`; once the primary item write succeeds it's never rolled back, so a later `afterSubmit` failure still reports `success: true` (the item exists) alongside its own `onError` run. Tested end-to-end in `__tests__/submitForm.test.ts` against a scenario with real `{{item.id}}`/`{{fields.x}}` interpolation flowing into an `afterSubmit` httpRequest and an `onSuccess` redirect, plus a beforeSubmit-failure-aborts-before-writing case.*
- [x] ~~Still-open~~ **Resolved (interim default):** a dependency that runs and *fails* now cascade-skips its dependents exactly like a `when: false` skip would (see `shouldCascadeSkip` in `dependencyGraph.ts`) — chosen so a phase doesn't hang or a dependent doesn't blindly run against missing data. This is flagged in code comments as an interim default; if the product decision instead becomes "a failure should immediately abort the whole submission and fire onError," that's a change to `runTriggerPhase`'s caller (`submitForm.ts`), not to `dependencyGraph.ts` itself.
- [x] Optimistic concurrency on edit-mode submits: use `@odata.etag` + `If-Match`. — *`submitForm.ts` accepts an optional `ifMatchEtag` and passes it through to `GraphClient.updateListItem`; `MockGraphClient` simulates a 412 on mismatch (already had this from an earlier session) and `submitForm.test.ts`'s edit-mode test exercises the happy path. **Not yet built:** the actual "someone else changed this since you opened it" UI-facing error message — right now a 412 just surfaces as a generic write failure through the same `onError` path as any other write error, rather than a distinct, clearer message. Small follow-up.*
- [x] **(New)** `parentReference` lookupTable row writes, INCLUDING deletion. — *Implemented in `packages/app/src/lib/submit/lookupTableRows.ts` (`writeLookupTableRows`), called from `submitForm.ts` after the primary item write (resolving the exact sequencing gap the README calls out). Writes the SharePoint lookup-column convention (`<ParentReferenceColumn>LookupId` set to the numeric parent id) and dispatches to create vs. update based on whether a row carries an `id`. **`skye-lookup-table` (§7) has a real add/edit/remove-row UI**, so this path is reachable end-to-end from an actual form. **Row deletion is now fully implemented**: added `GraphClient.deleteListItem` (both real and mock); `skye-lookup-table`'s remove handler marks an existing (previously-saved) row `deleted: true` and hides it rather than dropping it from `.value`, so `writeLookupTableRows` still sees it and issues the actual delete; a never-saved row is just dropped entirely (nothing to delete server-side). Tested in both `lookupTableRows.test.ts` and `registerElements.test.ts`.*
- [x] **(New)** SharePoint field-value mapping. — *`packages/app/src/lib/submit/mapValuesToSharePointFields.ts` converts SKYE field-key-keyed values into `bindTo`-keyed SharePoint fields, excluding `virtual` fields and fields never touched by the user (so a submit doesn't send spurious overwrites). Reused identically for both the primary item and lookupTable rows, since both are "a dict of FieldConfig keyed by field key."*
- [x] **(New, found while testing)** `MockGraphClient`'s item store was a single flat map shared across every list, meaning a lookupTable's related-list rows could collide with the primary list's fixture item ids. Fixed: the store is now scoped per `(siteId, listId)` pair. This was a real correctness bug in the mock, not just a test-fixture inconvenience — worth knowing about if anyone was relying on the old cross-list behavior (nobody should have been).
- [x] **(New)** `script` postAction "plugins" directory, for readily expanding available actions (different services, multiple actions per service) without touching the schema per addition. `packages/app/src/actions/` (real path: `src/app/src/actions/`): one folder per service (`teams/`, `outlook/`), one file per action exporting a `ScriptAction` (new named type, exported from `@skye/config`, `(args, ctx) => Promise<unknown>` — `args[0]` is a single named options object, not positional args), a shared `graphJson.ts` helper wrapping the ok-check/JSON-parse boilerplate every Graph-backed action needs, and one explicit `registry.ts` barrel mapping `"service.actionName"` → function (no auto-discovery/glob — kept explicit and reviewable, matching `defaultHandlerRegistry.ts`'s existing style). Wired into `entry-form.ts`'s `submitForm` call via `callbacks.scriptActions`. See CLAUDE.md's "Authoring a new script postAction" convention for the full recipe. Five actions shipped as the first real plugins:
  - `teams.createChat` (POST /chats) and `teams.sendMessage` (POST /chats/{id}/messages, plain text or an Adaptive Card attachment) — deliberately TWO actions, not one combined "create and send," so they compose through the existing `dependsOn` + `{{results.actionKey.path}}` chaining instead of needing new orchestration logic. Proven end-to-end in `teamsActionChaining.test.ts`.
  - `teams.scheduleMeeting` and `outlook.createCalendarEvent` both POST to `/users/{id}/events` — Graph has no separate "send a Teams invite" call; a Teams meeting that actually emails attendees a join link IS a calendar event with `isOnlineMeeting`/`onlineMeetingProvider` set. Kept as two independent files (not a shared cross-folder helper) so each service's folder stays self-contained; the near-duplicate request-building is a deliberate, small tradeoff for that isolation.
  - `outlook.sendEmail` (POST /users/{id}/sendMail) — Graph returns 202 with no body on success, so this is the one action here with nothing to return for later `{{results.x}}` chaining.
  - **Not yet verified against a live tenant** (same caveat as everything else Graph-related in this project): needs delegated Graph scopes consented for the app registration — likely `Chat.Create`, `ChatMessage.Send`, `Calendars.ReadWrite`, `Mail.Send`, `OnlineMeetings.ReadWrite` (exact set depends on tenant policy). In `PUBLIC_MOCK_GRAPH=1` dev mode these hit the same generic mock `graphFetch` the built-in `graphRequest` type already uses (a canned `{ mocked: true }` response) — good enough to prove the wiring/composition, not representative of real Graph response shapes.
  - 20 new tests (`teamsActions.test.ts`, `outlookActions.test.ts`, `actionsRegistry.test.ts`, `teamsActionChaining.test.ts`).
- [x] **(New, found while building the above)** `scriptHandler` never interpolated `action.args` before calling the registered function — every other handler (`httpRequest`, `graphRequest`, `redirect`, `setField`, `showMessage`) explicitly interpolates its templated fields, but `script` silently passed `args` through raw. This meant a `script` postAction could never reference `{{fields.x}}`/`{{results.x}}` at all, which would have made `teams.createChat` → `teams.sendMessage` chaining (above) silently pass the literal string `"{{results.createChatAction.chatId}}"` instead of a real chat id — caught by `teamsActionChaining.test.ts`, not by inspection. Fixed in `actions/handlers/script.ts`; covered directly by a new `scriptHandler.test.ts` in `@skye/config`.
- [x] **(New)** `httpRequest.request.params` — a separate query-string bag (`Record<string, string>`, interpolated, appended to `url` after templating) so a config author doesn't have to hand-build a query string inside the `url` field themselves. Schema + `types.ts` + `httpRequestHandler.ts` updated; 3 new tests in `httpRequestHandler.test.ts`.

## 10. File uploads

- [x] Implement both `fileStorage.target` modes: `attachment` and `library`. — *Only `library` mode is actually implemented (Graph's well-documented simple-upload PUT endpoint, `GraphClient.uploadToLibrary`, real + mock). **`attachment` mode is deliberately NOT implemented** — as of this writing, Microsoft Graph v1.0 has no well-documented, stable endpoint for SharePoint list item attachments (historically requiring the separate SharePoint REST API, a different token audience than Graph, which this app hasn't set up). Rather than guess at an endpoint that might not exist or silently fail against a real tenant, `uploadFieldFile` (`packages/app/src/lib/submit/fileUpload.ts`) throws a clear, explanatory error for `attachment` mode instead of attempting it. This is a considered decision, not an oversight — see that file's own docstring. If real attachment support is needed, it likely means adding a second MSAL scope for the SharePoint REST API audience, which is a bigger change than "write one more Graph call."
- [x] Decide what gets written to the bound column for `library` mode. — **Decided: `webUrl`** (not `driveItem.id`), since a URL is directly useful (clickable) if someone views the raw list data outside of SKYE, whereas a drive item ID alone isn't. Implemented in `submitForm.ts`'s upload step.
- [x] **(New)** Wiring file selection into form values. — *`file` controlType fields use `valueAccessor: "none"` in `fieldRegistry.ts` (the generic value-reader doesn't handle them), so `renderForm.ts` special-cases `controlType === "file"` to capture the selected `File` object directly from `input.files[0]` on change.*
- [x] **(New)** Upload failure handling. — *A failed upload doesn't abort the whole submission — it's recorded per-field in `SubmitResult.fileUploadErrors` and that field is left unset (not sent as a raw `File` object, which would break `mapValuesToSharePointFields`). `entry-form.ts` shows a distinct warning-level status message listing which fields failed, alongside an otherwise-successful submission.*
- [x] **(New, found while testing)** `Blob.arrayBuffer()` isn't implemented by jsdom's `File` polyfill (used in this repo's tests), even though `File`/`Blob`/`FileReader` otherwise work fine there. Fixed by reading file contents via `FileReader` instead (`readFileAsArrayBuffer` in `fileUpload.ts`) — broader environment support, not just a test workaround.
- [x] **(New pass, 2026-09)** `fileStorage.fileNameTemplate` — an optional string on `fileStorage` that renames the uploaded file instead of keeping the uploader's disk name. Supports `{{fields.<key>}}` (raw value) and `{{date:<key>}}` (a `date`/`datetime-local` value formatted `YYYY.MM.DD`, read from the value's `YYYY-MM-DD` prefix so there's no time-zone day-shift); the original extension is always reattached and characters SharePoint rejects in a name are replaced with spaces. If the template renders empty the original name is kept, so a naming issue never fails an upload. Schema + `types.ts` `FileStorage` updated; `renderUploadFileName` added to `fileUpload.ts` and `submitForm.ts` now threads `values` into `uploadFieldFile` (5th arg, defaulted to `{}` so existing callers/tests are unaffected). Motivated by the Luddy LLC event-proposal form, whose poster must land in `Documents/PHOTOS!/Event Posters/2026-2027` as `2026.xx.xx <Event Name> Poster`. 5 new `renderUploadFileName` tests + 1 `uploadFieldFile` test in `fileUpload.test.ts`.

## 11. Graph throttling, pagination & batching

- [ ] Never fetch a full list client-side — `lookupPicker`/`peoplePicker`/table lookups query server-side with `$filter`/`$search` + `$top` (small page size) as the user types.
- [ ] `$select` on every list/item read — only the fields the config actually references.
- [ ] Shared `paginate()` helper following `@odata.nextLink` (for the cases that do need multi-page reads).
- [ ] Cache column-schema fetches per session (ties into §6).
- [ ] Use `/$batch` for edit-mode loads (primary item + related lookupTable rows) instead of sequential round trips.
- [ ] 429 retry honoring `Retry-After`, plus a concurrency cap (e.g. max 4 in-flight Graph calls) rather than firing everything on form load.

## 12. Testing

- [x] Unit tests for `mergeConfig`/`lintOverlay` (pure logic, framework-agnostic, highest ROI given no live tenant needed). — *`__tests__/mergeConfig.test.ts`, `__tests__/lintOverlay.test.ts`.*
- [x] Unit tests for `evaluateCondition` (all/any/not + operators). — *`__tests__/evaluateCondition.test.ts`.*
- [x] Unit tests for `templating.ts` interpolation and `dependencyGraph.ts` skip-cascade. — *`__tests__/templating.test.ts`, `__tests__/dependencyGraph.test.ts`.*
- [x] **(Added, not originally itemized separately)** Unit tests for `nativeValidators.ts` and `evaluateCalculatedExpression.ts`, plus an end-to-end `actionRunner.test.ts` exercising a full trigger-phase run against a scenario mirroring the real example config. — *40 tests total, all passing; `tsc --noEmit` clean.*
- [x] Fixture-driven tests for the field registry (config → expected DOM shape) once `MOCK_GRAPH` fixtures exist. — *Implemented in `packages/app/src/__tests__/renderForm.test.ts` using jsdom, rendering the real base-form-config fixture end-to-end: verifies tab count, control tag/type mapping, value read-back on input, field-level `visibleIf` (haiku/campus), and page-level `visibleIf` (banquetDetails/attendingBanquet). Plus `router.test.ts` (5), `applyAttributes.test.ts` (5), `mockGraphClient.test.ts` (5) — 20 tests total in `packages/app`, all passing, `tsc --noEmit` clean, and a full Astro production build verified to succeed with `MOCK_GRAPH=1`.*

## 13. Still genuinely open / needs a decision before touching that area

- [x] ~~Site-switcher / 404 flow scope for v1 (§3).~~ **Resolved this session** — see §3.
- [x] ~~Tenant model: multi-tenant `/common` vs. per-tenant authority (§4).~~ **Resolved against a real tenant** — both are now supported via an optional `tenantId` param; see §4.
- [x] ~~Dependency-failure cascade behavior for postActions (§9).~~ Resolved with an interim default — see §9.
- [x] ~~`calculatedDisplay` escape-hatch necessity (§1).~~ Resolved: no escape hatch, structured expression only.
- [x] ~~File-upload target column semantics (§10).~~ **Resolved this session** — see §10 (`webUrl`, and `attachment` mode deliberately unimplemented with an honest explanation).
- [x] **(New)** MSAL redirect-fallback URL recovery (§4). A popup-blocked user gets bounced through `loginRedirect`, and AAD returns to the app registration's FIXED redirect URI — dropping the `?applicationId=`/`?tenantId=`/`?siteId=` query string, so the landing entry script errored out ("no application configured") before `handleRedirectPromise()` ever ran and sign-in never completed. Fixed with `lib/auth/redirectReturn.ts`: `rememberRedirectReturn()` stashes `window.location.href` in `sessionStorage` (and it's also passed as MSAL's `state`) right before `loginRedirect`; `completeRedirectReturn()` — called first thing in every entry script (`entry-form`/`entry-view`/`entry-switcher`/`entry-index`) — detects a `#code=…&state=…` landing, finishes the token exchange with a throwaway MSAL instance built from the stashed client id (`navigateToLoginRequestUrl: false` so it doesn't race us), then `location.replace`s back to the pre-redirect URL (now with a cached account, so the retry is silent). An `#error=` landing is routed to `/#error=…` (no `state`, so it can't loop) where `entry-index.ts`'s existing "Sign-in didn't complete" panel shows. **Still not restored: in-progress form field values** — only the URL/route (formId, mode, siteId, applicationId, tenantId) survives; a half-filled form is lost through the redirect. That's a smaller, separate follow-up (stash `rendered.getValues()` too). Not verified against a live tenant yet. 6 tests in `redirectReturn.test.ts`.
- [ ] **(New)** `skye-richtext` is a deliberate minimal placeholder (plain contenteditable + a purely visual toolbar) rather than any working formatting implementation — this was an explicit simplification request, replacing an earlier `execCommand`-based toolbar from a prior pass. A real editor library (Tiptap suggested) still needs to be chosen and integrated; deprioritized partly because of real risk that Tiptap/ProseMirror doesn't work reliably in jsdom (this repo's test environment), so an untested integration seemed worse than an honest, deliberately-minimal placeholder. The custom-element boundary already isolates this, so swapping the internals later shouldn't require touching `fieldRegistry.ts` or any caller — only the `value` getter/setter + `skye-change` event contract needs to survive the upgrade.
- [x] **(New)** `PUBLIC_*` env vars are now documented — `src/app/.env.example` + `src/app/src/env.d.ts` (typed `ImportMetaEnv`) cover `PUBLIC_MOCK_GRAPH`, `PUBLIC_DEFAULT_APPLICATION_ID` (still genuinely required for the switcher when a URL has no `applicationId` — a client id can't be discovered), `PUBLIC_DEFAULT_TENANT_ID` (now optional — omitting it makes a single-tenant deployment prompt for the user's work email on first sign-in, then remember; see §4), and `PUBLIC_AUTH_ALLOW_COMMON` (multi-tenant opt-in).
- [x] **(New)** Single-tenant links self-heal without `PUBLIC_DEFAULT_TENANT_ID`. `lib/auth/tenantResolver.ts` + `authProvider.ts`. Resolution order in `acquireToken`: `?tenantId=` / `PUBLIC_DEFAULT_TENANT_ID` → a tenant id a prior sign-in cached in `localStorage` → **prompt** (a small modal for the user's work email → resolve to a tenant GUID via an unauthenticated GET to `https://login.microsoftonline.com/<domain>/v2.0/.well-known/openid-configuration`, the OIDC `issuer` carries the GUID → cache + `history.replaceState` `?tenantId=` into the address bar). **`/common` is NOT tried speculatively for a single-tenant app** — its failure isn't cleanly recoverable (the popup dead-ends on an AAD error page MSAL can't read; it surfaces as `user_cancelled`, which was exactly why the first cut of this didn't actually self-heal). A genuinely multi-tenant deployment sets `PUBLIC_AUTH_ALLOW_COMMON=1` to try `/common` first instead of prompting. After any successful sign-in `rememberTenantFromResult` caches + backfills the real tenant id from the MSAL result; a rejected provided/cached tenant (`AADSTS50194`/`90002`/`500011`/`90072`) clears the cache and re-prompts. `entry-form.ts`/`entry-view.ts`/`entry-switcher.ts` consult `getCachedTenantId` in their precedence. `acquireTokenPopupOnly` (diag) unchanged — manages tenant explicitly. `.env.example` + `src/env.d.ts` now document `PUBLIC_MOCK_GRAPH`/`PUBLIC_DEFAULT_APPLICATION_ID`/`PUBLIC_DEFAULT_TENANT_ID`/`PUBLIC_AUTH_ALLOW_COMMON`. 12 tests in `tenantResolver.test.ts`.
- [x] ~~Submit/postAction wiring inside `packages/app` (§9)~~ — **Done.** `submitForm.ts` orchestrates the full sequence and is wired to `renderForm`'s new `submitButton` in `entry-form.ts`, with a status area reflecting `showMessage` postAction calls and generic success/failure fallbacks.

## Newly discovered gaps (surfaced while building `packages/app`, not originally itemized)

- [ ] List-column caching (§6) — `RealGraphClient.getListColumns` re-fetches on every call; needs an in-session cache.
- [ ] `[permission]` folder ordering (§5) — real implementation currently sorts alphabetically rather than by an enforced numeric-prefix convention; fine for now but not the intended deterministic-by-design scheme.
- [ ] ARIA/accessibility pass on the Web Components (§7) — now that they're functional (not placeholders), this is worth doing — see §7's note.
- [x] ~~`calculatedDisplay` fields don't recompute reactively (§7/§9)~~ — **Resolved**, see §7.
- [x] ~~lookupTable row deletion (§9)~~ — **Resolved this session**, see §9.
- [x] ~~Etag-conflict UX (§9)~~ — **Resolved**, see §7/§9.
- [ ] **(New)** `skye-lookup-picker`'s search isn't fully tested end-to-end. — *`registerElements.test.ts` verifies the `relatedList` property round-trips onto the element instance, but doesn't exercise the debounced search-and-select flow the way the peoplePicker test does (advancing fake timers), since that would need a second full-timer test. Low-risk (identical code path to the peoplePicker test that IS covered), but noted rather than silently assumed equivalent.*
- [ ] **(New)** `skye-lookup-table`'s row inputs have no validation, no `visibleIf`, and select columns aren't wired to `field.style`/`attributes` the way top-level fields are — it reuses only `controlType`/`options`/`label` from each column's `FieldConfig`, not the full field shape `fieldRegistry.ts` supports for top-level fields. Acceptable for a first working version; flagged as a real gap if a lookupTable column needs richer behavior later.
- [ ] **(New)** `RealGraphClient.searchSitesWithSkyeData()`'s tenant-wide `/search/query` call is **untested against a live tenant** — the exact shape of Graph Search API responses for `driveItem` hits (specifically whether `resource.folder` and `resource.parentReference.siteId` are populated the way assumed) needs verification against a real tenant before this is trusted in production. Structurally reasonable based on documented Graph Search API shape, but this is exactly the kind of Graph-specific assumption that's historically been wrong before (see the `attachment`-mode file-upload decision) — worth a deliberate first real test rather than assuming it just works.
- [x] **(New, found and fixed this session — first real `pnpm dev` + browser test)** `MOCK_GRAPH` never reached the client bundle. `createGraphClient.ts`/`rawGraphFetch.ts` read `import.meta.env.MOCK_GRAPH`, but Astro/Vite only inline client-bundled env vars prefixed `PUBLIC_` (no custom `envPrefix` was set in `astro.config.mjs`) — so a bare `MOCK_GRAPH=1` shell var was always `undefined` in the actual browser bundle, silently falling through to `RealGraphClient` + real MSAL auth, which then hung (no live tenant, no interactive popup) with `Cross-Origin-Opener-Policy`/`window.closed` console errors and a stuck "Loading…" screen. None of the 97 unit tests caught this because they all instantiate `MockGraphClient` directly, never going through `createGraphClient` inside an actual Vite-built client bundle. **Fixed**: renamed to `PUBLIC_MOCK_GRAPH` everywhere (both source files + every doc reference) rather than adding a custom `envPrefix`, to keep the convention standard/discoverable. Re-verified via a headless-Chromium run against `PUBLIC_MOCK_GRAPH=1 pnpm dev` — the sample form now renders correctly (see below).
- [x] **(New, found and fixed this session)** The documented URL scheme (`getskye.app/form#{formId}/...?siteId=...&applicationId=...`) put the query string *after* the `#`, which browsers fold into the hash fragment rather than the real query string — `router.ts`'s `parseRoute` reads `siteId`/`applicationId` from `location.search`, which by URL spec must precede `#`, so the documented ordering made every example URL unresolvable in practice (hit this as the very first symptom, before the `PUBLIC_MOCK_GRAPH` bug above). **Fixed**: corrected the scheme description and every example URL in `HANDOFF.md`/`README.md` to `?siteId=...&applicationId=...#{formId}/...` (query before hash) — no code change needed, `router.ts`'s parsing logic was already correct.
- [ ] **(New)** `packages/skye-config`/`packages/app` in the docs (`README.md`, `CLAUDE.md`, `HANDOFF.md`) no longer match the real workspace layout — the actual `pnpm-workspace.yaml` glob is `src/*`, so the real paths are `src/skye-config` and `src/app`. Runnable command lines (`cd packages/app` etc.) were corrected this session; the broader architectural prose (package descriptions, directory-layout diagram) throughout all three docs still says `packages/` and hasn't been renamed — flagged rather than fixed, since it's a larger, purely-cosmetic rename across many lines with no functional impact.
- [ ] **(New)** `attachment`-mode file uploads remain unimplemented by design (§10) — if this is needed, the likely path is adding a second MSAL scope for the SharePoint REST API's token audience (distinct from Graph's), since that's the API surface that actually supports list item attachments well. This is a bigger change than "add one more Graph call" and deserves its own scoping pass.

---

## 14. Ongoing conventions while implementing (applies from here forward)

- [x] **Keep this TODO current.** Whenever a checklist item above is implemented, check it off in the same commit/PR. If implementing something surfaces a new decision, gap, or follow-up not already listed, add it to the relevant section (or §13 if it's a genuine open question) rather than letting it live only in chat/commit history. — *This file itself is the evidence this convention is being followed — see the "Newly discovered gaps" section above and the inline additions throughout §2–§13.*
- [x] **Comment every non-trivial function/logic block.** Each function, and each distinct logic block within a longer function (e.g. a merge step, a validation branch, a skip-cascade check), gets a concise comment stating what it does — not restating the code line-by-line, just enough that someone unfamiliar with the file can follow the flow without tracing it themselves. This matters more than usual here since a stated goal of SKYE is ease-of-editing for people with little coding experience — the code itself should model that clarity. — *Followed throughout `packages/skye-config` and `packages/app` — every non-trivial function/branch has a comment stating its purpose. This is an ongoing convention, not a one-time checkbox, so it stays checked as a standing reminder rather than being "done."*

---

**Suggested build order:** §1 (schema edits) → `packages/skye-config` (merge/lint/condition/templating/action-runner, all framework-agnostic and testable without a live tenant) → `MOCK_GRAPH` fixtures → `packages/app` render layer (field registry, layout engine) → auth/Graph integration last, once everything else is provable against fixtures.

## 15. Monorepo tooling — Turborepo (new, not originally itemized)

- [x] Adopt Turborepo for cross-package task orchestration instead of raw `pnpm -r`/`pnpm --filter`. — *Added `turbo.json` defining `build` (depends on `^build`, caches `dist/**`), `typecheck`, `test`, `test:watch` (uncached, persistent), `lint:configs` (uncached — takes a path argument, shouldn't be cached), and `dev` (uncached, persistent). Root `package.json` scripts rewritten as thin `turbo run <task>` wrappers. Added a `typecheck` npm script to both packages (previously only run manually via `tsc --noEmit`).*
- [x] Verify caching actually works, not just that tasks run. — *Confirmed: a repeat `turbo run build`/`test`/`typecheck` with no source changes replays cached logs in <250ms ("FULL TURBO") instead of re-running `tsc`/`vitest`/`astro build`. Confirmed independent packages' tasks run in parallel (both packages' test suites started concurrently, ~18s wall time for what would be sequentially slower).*
- [x] Verify `--filter` and `--` argument-forwarding both still work the way the existing scripts need. — *`pnpm test:config` → `turbo run test --filter=@skye/config` confirmed. `pnpm lint:configs -- <path>` → `turbo run lint:configs -- <path>` confirmed forwarding the path argument through to `lintConfigs.ts` correctly.*
- [x] **(Found during implementation)** Turborepo's caching requires a git repository — it hashes tracked files via git to determine cache keys. This sandbox had no `.git` at all, and without one, every task was a permanent cache miss (silently — no error, caching just never engaged). Initialized git at the repo root with an appropriate `.gitignore` (`node_modules/`, `dist/`, `.astro/`, `.turbo/`, etc.) to actually verify caching works. **If you're setting this up somewhere that isn't already a git repo, you'll hit the same silent non-caching behavior** until one exists.
- [x] **(Found during implementation, corrects an earlier session's CLAUDE.md note)** The existing `pnpm-workspace.yaml` note about `onlyBuiltDependencies` suppressing `ERR_PNPM_IGNORED_BUILDS` was **incomplete/wrong** for pnpm 11: that setting alone did not stop `pnpm run <script>` from failing via pnpm's internal "deps status check" (which itself shells out to `pnpm install` and fails the same way). The actual fix is running `pnpm approve-builds --all` once (non-interactive, safe for CI/scripts) — this writes an `allowBuilds` key into `pnpm-workspace.yaml` (a different key than `onlyBuiltDependencies`), which is what persists across future installs. `CLAUDE.md`'s Commands section has been corrected accordingly.

---

## 16. Custom Views (new feature — see `CUSTOM-VIEWS-SPEC.md`)

Sandboxed, author-written HTML/CSS/JS "views" (calendars, charts, dashboards) stored in `skye_data/views/<id>/`, run in an `sandbox="allow-scripts"` iframe with no origin and no network, every capability mediated over a private `MessageChannel` to a trusted host on SKYE's own origin that holds the real Graph token. Read-only. Threat direction is author → viewer. Reference prototype (`skye-host.js` / `skye-runtime.js`) was pasted into the planning conversation; it is a demo, not committed, and this feature is being built natively into `src/app` reusing the existing auth/Graph wiring.

### 16.0 Plan status
- [x] Plan reviewed; Q1–Q8 (§16.8) answered by product owner.
- [x] Final go-ahead to begin implementation.
- [x] **First implementation pass landed.** 219 unit tests pass (45 `@skye/config` + 174 `@skye/app`), both packages type-check clean, Astro production build succeeds, and the Playwright browser gate passes (3 specs, 23 security probes all BLOCKED). See the per-item notes below for what's done vs. still open.

Resolved decisions from the Q&A:
- **Q1** The sandbox shares the **same stylesheet as the parent SKYE page** (not a separate mini view CSS). Deliver it inlined into `srcdoc` (`?inline`/`?raw` import of the shared app stylesheet) so the frame — which has no origin and can't load `/styles/…` — still renders with SKYE's own look.
- **Q2** Internal navigation targets are concrete form/view ids only; a view cannot navigate to `/switcher`.
- **Q3** `skye.config.json` permission overlays are additive-only, same as form overlays.
- **Q4** Config shape this pass = `{ views: { allowedLists }, navigation: { allowedExternalOrigins }, home? }`. `home` is an optional **default destination** (a view or form id) that a bare site visit auto-navigates to; the switcher is shown only when there is no `home`. More keys later.
- **Q5** `skye.image()` is **fully implemented** against real Graph (list/SharePoint images actually work), not mock-only.
- **Q6** Browser harness: `@playwright/test`.
- **Q7** The `/switcher` chooser lists **views as well as forms** — needs `listSkyeViews(siteId)`.
- **Q8** The view query path may use its own stricter code rather than sharing the internal `filter`-string path.

### 16.1 Routing & page shell (`src/app`)
- [x] `pages/view.astro` — mount point + `<script src="../scripts/entry-view.ts">`, `import "../styles/view.css"`. URL shape `/view?siteId=&applicationId=&tenantId=#{viewId}`. `scripts/entry-view.ts` resolves the route, loads+merges `skye.config.json`, renders "SKYE isn't set up here yet" on `SkyeNotConfiguredError`, else calls `mountView`.
- [x] `router.ts`: `ViewRoute` + `parseViewRoute`/`parseCurrentViewRoute` (the view id is slug-validated `^[A-Za-z0-9_-]+$` — it's interpolated into a Graph drive path, so `..`/`/` would be traversal → treated as unresolved). Builders: `buildViewUrl`, `buildFormUrl` (generic mode+itemId), `buildViewSwitcherRedirectUrl` (wanted view id travels as `?view=` so the switcher can tell "resume a view" from "resume a form" from "browse"). An unresolved `/view` visit bounces to `/switcher`.
- [x] `<meta http-equiv="Content-Security-Policy" content="frame-src 'self'">` on `view.astro` (top-level-page half of the isolation model — the sandbox attr alone doesn't stop a view navigating its OWN frame out). Comment in the file says a real deployment should also send this + `frame-ancestors` as HTTP headers.

### 16.2 The host (trusted, parent origin) — `src/app/src/lib/views/`
- [x] `viewHost.ts` — `mountView({ container, graph, siteConfig, viewId, ctx, onStatus? })`. Iframe `sandbox="allow-scripts"` + `referrerpolicy="no-referrer"` only; `srcdoc` = CSP meta + shared CSS (`?raw`) + runtime (`?raw`), nothing author-written; `skye:hello` → fail-closed `contentWindow.document` read → `skye:port` handshake over a `MessageChannel`; watchdog; teardown (also removes the handshake `message` listener); load-count self-navigation guard. No `localStorage` token; files come from `GraphClient.getSkyeViewFiles`.
- [x] `view-runtime.js` — plain script (no imports), `?raw`-imported and inlined into `srcdoc`. Exposes `window.skye` only; the port and `call()` are IIFE-closed so author `view.js` (run via `AsyncFunction`) can't reach them. Ports faithfully from the prototype.
- [x] The `srcdoc` `<style>` is `src/styles/view.css`, `?raw`-imported by the host AND `import`ed by `view.astro` — one stylesheet, both places (Q1). Verified in the build output: inlined into the page `<style>` and into the entry chunk as a string; no standalone asset a view could fetch.
- [x] `messageApi.ts` — `createViewApi({ graph, siteConfig, ctx, navigate })` → `{ has, handle }`. Handlers: `skye:lists`, `skye:schema`, `skye:list`, `skye:item`, `skye:image`, `skye:navigate`. **No write handler exists**; `handle` uses `Object.hasOwn` (not `in`) so `constructor`/`__proto__` can't resolve to a prototype member → `unknownType`. Per-mount schema cache. ⚠️ `skye:batch` **not implemented** (spec §4.6 lists it as "consider" — deferred; see below).
- [x] `viewQuery.ts` — `ViewQuery { where?: Condition; orderBy?; select?; top?; skip?; count?; cursor? }` reusing `@skye/config`'s `Condition` verbatim, plus the shared limit constants.
- [x] `validateViewQuery.ts` — `validateViewQuery(query, allowedFields)` → normalized `ViewQuery`, else `ViewQueryError` (stable `.code`: `badQuery`/`unknownField`/`badOperator`). Rejects unknown top-level keys (kills a smuggled `filter` string), caps depth (6) / rule count (64) / orderBy (5), clamps `top`≤200 / `skip`≤100000, every field checked against the list's real columns.
- [x] `compileQueryToOData.ts` — validated `ViewQuery` → `{ filter?, orderby?, top?, skip?, count?, select? }`. Field names re-asserted `^[A-Za-z0-9_]+$` (throws, not emits, on a miss); string literals single-quote-escaped (`''`); `in`/`notIn` expanded to `or`/`and` chains; `all`/`any`/`not` recursion. Hard injection tests in `compileQueryToOData.test.ts`.
- [x] `navigationPolicy.ts` — `resolveNavigation(target, ctx)` → `{ kind: "internal"|"external", url }` or throws `NavigationError` (`navBlocked`). `{ view }` / `{ form, itemId?, mode? }` → same-site `/view` or `/form` URL (ids slug-checked); `{ url }` → allowed only if `new URL(url).origin` is in `navigation.allowedExternalOrigins` AND scheme is http/https; the host opens external via `window.open(url, "_blank", "noopener,noreferrer")`, internal via `window.location.assign`. Never a sandbox flag.
- [x] `viewConfig.ts` — `resolveSiteConfig(files)` merges base + `[permission]` overlays: allowlists **unioned** across all layers (additive-only, Q3), `home` last-layer-wins. Missing base → `SkyeNotConfiguredError`. Real `GraphClient.getSkyeSiteConfigFiles` lists `skye_data/config/[permission]/` folders the same way forms do and throws `SkyeNotConfiguredError` when there's no base file. Code + this doc note it's a shape guardrail, not a permission boundary.
- [x] `home` handling — in `entry-switcher.ts`: once a site is known and nothing specific is requested, load the config; if `home` is set, redirect straight to that view/form; only show the combined picker when `home` is absent.
- [x] Watchdog interval is a named `WATCHDOG_INTERVAL_MS = 15_000` constant (up from the prototype's 4s) with a comment on the trade-off. The calendar demo (real Graph mock latency + a full month render) mounts well inside it in the browser gate.
- [x] Host-side rate limiting — token bucket per mounted view (`RATE_CAPACITY = 24`, `RATE_REFILL_PER_SEC = 12`); over-limit requests get `{ error, code: "429" }` back over the port instead of degrading the host.

### 16.3 The runtime (inside the sandbox) — author-facing `skye.*`
- [x] `skye.lists()`, `skye.schema(name)`, `skye.list(name, query, opts?)`, `skye.item(name, id)`, `skye.count(name, query)`, `skye.image(name, id, field)` → `data:` URI, `skye.navigate(target)`, `skye.report(...)` (probe demo only).
- [x] Client-side field-name validation — `skye.list` walks the query for referenced field names and checks them against a cached `skye.schema(name)` before sending, throwing a clear `unknownField` error (the host re-validates authoritatively).
- [x] Stale-response guard — `skye.list` calls are keyed (default: the list name); a newer call supersedes older in-flight ones, which reject with `AbortError`. Opt out with `{ keepStale: true }`.
- [x] In-session cache for `schema()`/`lists()` only — never `list()`/`item()`/`image()`.

### 16.4 GraphClient interface additions (real + mock)
- [x] `getSkyeViewFiles(siteId, viewId)` → `{ html, css, js }` (real reads `.../view.{html,css,js}` as TEXT; a missing `view.css` is tolerated).
- [x] `getSkyeSiteConfigFiles(siteId)` → base + `[permission]` overlays under `skye_data/config/`.
- [x] `ListItemQuery` extended with `orderby` (OData string), `skip`, `count`, `cursor`; `ListItemPage` extended with `totalCount`. Real `searchListItems` follows a `cursor` (an opaque `@odata.nextLink`) directly and ignores the other fields when one is present.
- [x] `getListItemImage(siteId, listId, itemId, field)` → `{ contentType, bytes }`. Real impl: read the field, normalize the many SharePoint shapes (plain URL string, `{Url}`, Image-column JSON, server-relative path) to a server-relative path, match it against one of the site's document libraries by its `webUrl` root, and read that drive item's bytes + `file.mimeType`. Only ever reads from **this site's own** drives (an off-site URL fails to resolve — no SSRF), and `..` segments are percent-encoded so they can't traverse. ⚠️ **Untested against a live tenant** — the shape-matching is best-effort; verify before trusting in production.
- [x] `listSkyeViews(siteId)` → `SkyeViewSummary[]` (folder id + optional `view.json` `title`). The `/switcher` step-2 chooser now lists forms and views together (`renderFormOrViewPicker` + `toPickerEntries`).

### 16.5 Mock fixtures & demo views
- [x] `MockGraphClient` implements every 16.4 addition against fixtures, including a **minimal OData `$filter` evaluator** (`fields/F <op> V`, `contains()`, `and`/`or`/`not`/parens) so the demo views actually filter; `orderby`/`skip`/`count`/`cursor` supported; `getListColumns` **throws for an unknown list** (simulated Graph 404) which is what the defense-in-depth test leans on.
- [x] `fixtures/views/calendar/{view.html,view.css,view.js}` — month calendar over `Events`, detail panel pulling `EventDetails` + a `skye.image()` poster + a `skye.navigate({ form })` sign-up button.
- [x] `fixtures/views/security-probes/{...}` — 24 probes across 4 groups: host reach (5), network exfil (6), API abuse (7, incl. raw-`filter` smuggle, operator/field-name OData smuggle, `image()` traversal, `skye.navigate` to a non-allowlisted origin and a `javascript:` URL), navigation exfil (6). All BLOCKED.
- [x] `fixtures/views/skye.config.json` + `skye.config.admin.json` (overlay) + `fixtures/views/lists.json` (`Events` + `EventDetails`, columns + items). A 1×1 PNG is returned inline for `getListItemImage`.

### 16.6 Testing
- [x] Unit (vitest): `viewConfig.test.ts`, `validateViewQuery.test.ts`, `compileQueryToOData.test.ts`, `navigationPolicy.test.ts`, `messageApi.test.ts` (incl. "no write handler" + prototype-chain dispatch guard), `viewsMockGraph.test.ts`, `viewRouting.test.ts`, `formOrViewPicker.test.ts` — 74 new tests.
- [x] Defense-in-depth test — `messageApi.test.ts`: with the allowlist forced to contain a list the fake Graph doesn't have, `skye:list` still rejects at the Graph layer.
- [x] Browser regression gate — `@playwright/test`, `pnpm test:views:browser` (own script, not in `turbo run test`). Builds with `PUBLIC_MOCK_GRAPH=1` via `e2e/globalSetup.ts`, serves `astro preview`, runs against system Chrome (`channel: "chrome"`, no browser download). 3 specs: calendar mounts inside the frame; all 23 probe verdicts BLOCKED / 0 LEAKED (read from the host's `[probe]` console lines, since the last navigation probe tears the frame down); the host refuses to hand over the port when the `sandbox` attribute is stripped.
- [x] Security pass — audited host DOM/token reach, network exfil (fetch/beacon/WS/img/SW/dynamic-import), navigation exfil (popup/form/top/self + mediated), OData injection (operator + field-name smuggle, quote-escaping), confused-deputy via `image()` path traversal, prototype-chain dispatch, `srcdoc` boundary loss, view-id path traversal, rate-limit/watchdog. Fixes applied: `Object.hasOwn` dispatch, slug-validated view id in `parseViewRoute`, handshake listener removed on teardown. All probes + tests green.

### 16.7 Docs
- [x] `CLAUDE.md` — "Custom Views" section added (conventions + status + the recipe for authoring a view).
- [x] View-author guide — `docs/custom-views-authoring.md` (the `skye.*` API, the query grammar, navigation rules, the config allowlist, the sandbox limits).
- [x] This §16 checklist kept current (this edit).

### 16.9 Still open / follow-ups from this pass
- [ ] `skye:batch` message type (spec §4.6 "consider") — not implemented. Add if dashboard views prove to fire many small queries per interaction.
- [ ] `getListItemImage` real-Graph path is **untested against a live tenant** — the field-shape → drive-item resolution is best-effort; verify the common cases (Image column, Hyperlink-or-Picture, attachment) against a real SharePoint list.
- [ ] `searchListItems` `$skip` / `$count` / `$orderby` against real Graph list items — SharePoint's support for `$skip` and `$orderby` on non-indexed columns is uneven; cursor paging (`nextLink`) is the reliable path and is what the code prefers. Confirm behavior on a real large list.
- [ ] ARIA pass on the demo views + the `/view` chrome (parallels the §7 form-components ARIA gap).
- [ ] `.env.example` / Astro env typing still doesn't document `PUBLIC_MOCK_GRAPH` or the `PUBLIC_DEFAULT_*` vars (pre-existing gap, noted again here since the view gate depends on `PUBLIC_MOCK_GRAPH`).
- [ ] A publish-time static validator for a view (scan `view.js`/`view.html` for referenced list names + fields, check against the config allowlist before it goes live) — spec Appendix A; nice-to-have, not required.

### 16.8 Q&A with the product owner — all resolved (see §16.0 for the decisions)
- [x] **Q1** CSS/runtime delivery → share the parent page's stylesheet, inlined into `srcdoc` via a `?raw`/`?inline` import.
- [x] **Q2** Internal nav → concrete form/view ids only; no navigating to `/switcher`.
- [x] **Q3** Config overlays → additive-only, like form overlays.
- [x] **Q4** Config shape → `{ views.allowedLists, navigation.allowedExternalOrigins, home? }`; `home` is an optional default destination, switcher shown only when it's absent.
- [x] **Q5** `skye.image()` → fully implemented against real Graph.
- [x] **Q6** Browser harness → `@playwright/test`.
- [x] **Q7** `/switcher` → lists views as well as forms (`listSkyeViews`).
- [x] **Q8** View query path → may use its own stricter code, not the shared internal `filter`-string path.

## 17. Form Config Builder (`/builder` — new feature)

A standalone visual editor for creating and editing `form.config.json`
(base + `[permission]` overlays) without hand-writing JSON. Explicitly
requested: pick a site + list, a live preview on the left where clicking a
field opens its editable properties on the right, and those properties
generated **directly from the schema** rather than hardcoded — so a schema
change grows the builder's UI automatically instead of needing a second,
separately-maintained "what FieldConfig looks like" description.

- [x] **`@skye/config`: schema introspection** (`src/schema/schemaIntrospection.ts`) —
  a deliberately narrow JSON Schema navigation layer (not a general-purpose
  library: no `anyOf`, no format validation) over `form.config.schema.json`
  itself. `classifySchemaProperty()` maps any schema node to one of a
  fixed set of UI-relevant shapes (`enum`/`boolean`/`string`/`integer`/
  `number`/`stringArray`/`objectArray`/`object`/`dictionary`/
  `oneOfPrimitive`/`condition`/`unknown`) that the DOM renderer knows how
  to draw a control for. One real wrinkle found here: postAction's
  type-specific payload (`request`/`to`/`message`/`functionName`/...)
  lives ONLY inside `allOf[].then.properties`, not the def's own top-level
  `properties` — a plain property walk misses it entirely. Added
  `getConditionalProperties()` to merge in the matching `allOf` branch by
  discriminator key/value, used for postAction's `type`. The one
  deliberate non-goal: `condition` (`visibleIf`/`when`) is genuinely
  self-recursive (all/any/not of more conditions) and is NOT expanded into
  a visual tree editor — classified as its own `"condition"` kind and
  edited as raw JSON text instead, a conscious scope cut rather than an
  oversight. 20 new tests (`schemaIntrospection.test.ts`).
- [x] **`@skye/config`: browser-safe schema validation** (`src/validation/validateConfig.ts`) —
  wraps the same ajv setup `lint:configs`'s CLI script already used
  (`ajv` is a real `dependencies` entry of `@skye/config`, not
  devDependencies, so this was always safe to ship into the browser
  bundle) as `validateFormConfig`/`validateFormConfigOverlay`, so
  "Save" in the builder runs the exact same check `pnpm lint:configs`
  would — nothing the builder can persist should ever fail that CLI
  afterward. 7 new tests (`validateConfig.test.ts`).
- [x] **Important discovery while designing the overlay editing UX**: the
  overlay JSON *schema* (`form.config.overlay.schema.json`) requires any
  field/page/postAction an overlay DOES declare to be a FULL, independently
  valid object (a field still needs `controlType`; a page still needs
  `title`) — not a sparse `{ readonly: false }`-style patch, even though
  `FormConfigOverlay`'s TS type in `schema/types.ts` says `Partial<...>`.
  This matches how the two real overlay fixtures in this repo are already
  authored (full field redeclarations) and is confirmed by the schema's
  own description. Consequence: the builder edits an overlay's field the
  same way it edits a base field (the identical full FieldConfig editor),
  just seeded from a copy of the effective merged field the first time
  that key is touched in that overlay, rather than trying to build a
  separate "sparse patch" UI.
- [x] **`@skye/app`: one new Graph write capability** — `GraphClient.saveSkyeFormConfigFile(siteId, formId, source, config)`,
  implemented in `RealGraphClient` as a PUT to
  `skye_data/forms/[formId]/(<source>/)form.config.json:/content` (same
  simple-upload addressing `uploadToLibrary` already uses, just a JSON
  string body + explicit `Content-Type` instead of raw file bytes — Graph
  creates any missing intermediate folder itself, so a brand-new
  `[permission]` overlay folder needs no separate "create folder" call).
  `MockGraphClient` implements it against a new in-memory
  `formConfigStore`, which `getSkyeFormConfigFiles`/`listSkyeForms` now
  also consult first — lets the builder round-trip (load → edit → save →
  reload) and create entirely new forms against the mock, with no live
  tenant needed for development. This is a deliberate scope decision
  (confirmed with the user): the builder writes directly back to
  SharePoint on Save rather than only exporting JSON for manual upload.
  4 new tests in `mockGraphClient.test.ts`.
- [x] **`@skye/app`: the schema-driven DOM renderer** (`src/lib/builder/`) —
  - `schemaControls.ts`: the generic engine. Every control reads/writes
    `parent[key]` directly (mutating the object in place) and calls a
    no-payload `onChange()` — the same "mutate a shared object, notify"
    shape `renderForm.ts` already uses for its own `values`, deliberately
    not a second state-management pattern. One real design problem solved
    here: an optional nested object (`fileStorage`, `calculatedDisplay`,
    `table`, `style`, ...) can't be eagerly instantiated as `{}` just
    because the property exists on the schema — most have their OWN
    required sub-keys, so doing that for every field regardless of
    `controlType` would make nearly every field fail validation
    immediately. Solved with an explicit presence checkbox
    (`renderPresenceToggledEditor`) that only creates the nested object
    when the author opts in. `options`/`customValidators`-shaped arrays,
    `headers`/`params`-shaped strin­g dictionaries, and `columns`/`pages`/
    `postActions`-shaped object dictionaries (`renderNamedObjectDictionary`)
    all get real add/remove UI, not a raw-JSON fallback.
  - `fieldEditor.ts`: the full FieldConfig editor, straight from
    `getFieldSchemaProperties()`, plus exactly two narrow, justified
    overrides using data the builder already has on hand rather than
    trusting free text: `bindTo` becomes a dropdown of the target list's
    REAL live columns (`GraphClient.getListColumns`), with a one-click
    "fill options from this column's choices" button for Choice-bound
    select/radio/checkboxGroup fields (mirrors `populateChoiceOptions.ts`'s
    existing render-time behavior); `page` becomes a dropdown of the
    form's actual current page keys instead of free text a typo could
    silently break (a field whose `page` doesn't match a real page key
    just never renders — see `renderForm.ts`).
  - `formSettingsEditor.ts`: the right pane's default panel (top-level
    form settings, minus `pages`/`fields`/`postActions`) plus the Pages
    and Post Actions dictionaries. Post Actions needed one more piece of
    per-entry dynamic behavior: changing a postAction's `type` tears down
    and rebuilds JUST that one entry's body (not the whole list, and not
    on unrelated keystrokes elsewhere) to swap in that type's own payload
    properties.
  - `builderPreview.ts`: wraps the real `renderForm.ts` (so the preview is
    exactly what an end user would actually get, not a separate rendering
    path) with click-to-select-a-field delegation and the same
    peoplePicker/lookupPicker search-event wiring `entry-form.ts` uses.
  - 22 new tests across `schemaControls.test.ts`, `fieldEditor.test.ts`,
    `formSettingsEditor.test.ts`, `builderPreview.test.ts`.
- [x] **`pages/builder.astro` + `scripts/entry-builder.ts`** — the
  orchestration layer, following the same "page owns only the mount
  point, entry-*.ts owns the logic" pattern as every other page. Flow:
  (1) pick a site (reuses `renderSiteSwitcher`, same as `/switcher`);
  (2) pick an existing form (reuses `renderFormPicker`) or start a new one
  by entering a form id + choosing the target list from a **dropdown of the
  site's lists** (`GraphClient.listSiteLists` — paginated `GET /sites/{id}/lists`,
  `$select`ed small, `list.hidden` system lists filtered out, sorted). An
  earlier pass hand-entered the list GUID as a scope cut; **the user
  reversed that** — list metadata is a small bounded collection, not list
  items, so "never fetch a full list client-side" doesn't apply. A trailing
  "Other — enter a list id manually…" option keeps the free-text path for a
  cross-site list or one the enumeration missed; the optional "different
  siteId" field re-enumerates that site's lists into the dropdown on
  change. Mock `listSiteLists` returns a stable small set whose ids
  `getListColumns` all accept; +1 test in `mockGraphClient.test.ts`; (3) the builder itself — a view switcher
  (`base` + every detected `[permission]` overlay, plus "+ Add view" for a
  brand new one), the live preview, the field/settings editor, and a
  Save button that runs `validateFormConfig`/`validateFormConfigOverlay` +
  (for an overlay) `lintOverlay`'s additive-only check before ever calling
  `saveSkyeFormConfigFile` — a config the builder can save is one
  `lint:configs` would also accept. No dedicated `entry-builder.test.ts`,
  matching the existing convention that every other `entry-*.ts` is thin
  orchestration tested indirectly through its sub-modules, not directly
  (none of `entry-form`/`entry-switcher`/`entry-view`/`entry-diag` have
  one either).
- [x] **Manual end-to-end verification** (not part of `turbo run test` —
  a one-off Playwright script against `astro preview` with
  `PUBLIC_MOCK_GRAPH=1` baked in at build time, matching the existing
  `test:views:browser` pattern's own reasoning for why dev-mode env vars
  aren't trustworthy here): confirmed the full click-through — site → pick
  the fixture form → click a field in the preview → edit its label → see
  the live preview update → Save → "Saved base." — and separately the
  brand-new-form flow (create → add a page → add a field → Save correctly
  BLOCKS with a clear ajv error, `must have required property 'bindTo'`,
  because the new field defaults to `source: sharepoint` per the schema's
  own default and the author hadn't set `bindTo` yet). Both ran clean, no
  console errors beyond an unrelated pre-existing missing-favicon 404.

### 17.1 Second pass — permission gate, diff review, drafts (per explicit follow-up feedback)

- [x] **Access-gated, not just Save-gated.** New site config field
  `skye_data/config/skye.config.json`'s `builderEditors: string[]` —
  names of `[permission]` overlay folders under `skye_data/config/` that
  grant `/builder` edit rights; a user has edit access if they can
  currently READ (per normal SharePoint ACLs) any ONE of those overlay
  folders. `viewConfig.ts`'s new `canEditFormConfigs` (pure, given the raw
  `SkyeSiteConfigFile[]`) + `lib/builder/permissions.ts`'s
  `canEditFormConfig` (the Graph-fetching wrapper) back both `/builder`'s
  top-of-`main()` gate (a non-editor sees `lib/ui/messagePanel.ts`'s
  plain "you don't have edit permission" panel, never the site/form
  picker or the builder itself) and `/form`'s new conditional "Edit in
  Builder" link. Chosen over a per-form `_editors` marker folder (the
  other option put to the user) because it reuses site config data the
  app already loads for `home`/`allowedLists`, at the cost of being
  site-wide rather than per-form. 15 new tests across
  `viewConfig.test.ts`/`builderPermissions.test.ts`.
- [x] **Answered "should reused interactions become components"**: not as
  Astro components — this app is static-output with no SSR, so anything
  whose content depends on runtime state (which is every real confirm
  dialog or error panel) has to be built by client JS regardless; an
  `.astro` file only runs at build time and can't help. Extracted instead
  as plain shared TS modules, the same pattern `renderSiteSwitcher`/
  `renderFormPicker` already used: `lib/ui/confirmDialog.ts` (generic
  modal confirm, custom button labels, resolves a Promise with whichever
  option was clicked) and `lib/ui/messagePanel.ts`. 4 new tests.
- [x] **Review-before-save diff.** `@skye/config`'s new
  `merge/configDiff.ts` (`computeConfigDiff`, pure, 10 tests) diffs the
  config as loaded/last-saved this session against the current in-memory
  edits — added/removed/changed per field/page/postAction, which specific
  properties changed, and a `visibilityChange` ("added"/"removed"/
  "changed") when a `visibleIf`/`when` specifically differs, covering
  "hidden" and "made conditionally visible" in one signal. Deliberately
  structural (JSON.stringify equality), not semantic — sufficient for
  this app's plain-JSON config data. `lib/builder/configDiffView.ts`
  renders it grouped by page for fields specifically, per the explicit
  ask ("by page/field"); 5 new tests. Save now: validate (schema +
  additive-only lint) → if there are changes, show the diff in
  `confirmDialog` → only write on "Confirm & Save". An empty diff skips
  the dialog entirely and just says "No changes to save."
- [x] **Draft/publish workflow.** A draft is a FULL alternate FormConfig
  (not a partial overlay — same shape as base), stored at
  `skye_data/forms/[id]/_drafts/[draftId]/form.config.json`. Deliberately
  its own GraphClient surface — `listFormDrafts`/`getFormDraft`/
  `saveFormDraft`/`publishFormDraft` — rather than another
  `getSkyeFormConfigFiles` `source`, so the live-form-loading path can
  never accidentally merge one in; `getSkyeFormConfigFiles`'s own
  `[permission]`-folder scan additionally now skips any folder starting
  with `_` outright, as defense in depth (also future-proofs any other
  reserved SKYE-internal folder convention). `publishFormDraft` reads the
  draft and writes it as the new base — non-destructive, the draft stays
  in place for further edits/re-publish rather than being consumed.
  `router.ts`'s `FormRoute` gained an optional `draftId` (`?draft=`) +
  a new `buildDraftPreviewUrl` for the shareable link; `/builder`'s
  top bar got a parallel draft selector/"+ New draft" (seeded from a copy
  of the live base)/"Copy preview link"/"Publish this draft" set of
  controls, unified into the SAME view-select dropdown as base/overlays
  via an internal `"draft:"`-prefixed key (base/overlay/draft editing
  share almost all the same plumbing — preview, field editor, settings
  editor, diff, save — once that one distinction is threaded through).
  A draft is deliberately invisible to `listSkyeForms`/the switcher by
  construction (nested one level deeper than either ever looks), not by
  extra filtering. 4 new mock-layer tests
  (`listFormDrafts`/`saveFormDraft`/`getFormDraft`/`publishFormDraft`),
  2 new router tests.
- [x] **Draft-preview submission is gated by an explicit dialog**,
  matching the user's own specified wording exactly: client-side field
  validation always runs first (native constraints + registered custom
  validators — see the new, first-ever-used validation piece below) and
  blocks submission with a clear per-field message list on failure; once
  valid, `confirmDialog` asks "Run post-submission actions? This is a
  Form Preview. Would you like to save the form submission and run
  post-submission actions (sending emails and messages, running
  integrations, etc.) as if it's a live submission?" — "Don't Run
  Actions" does nothing further (no item write, no postActions — a pure
  validation check with an explicit "nothing was saved" message);
  "Run Actions" calls the exact same `submitForm` used by a real
  submission. Manually verified BOTH choices end-to-end against the mock,
  including confirming "Run Actions" genuinely reaches the real
  `submitForm` pipeline (it hit the fixture form's own placeholder
  webhook URLs, `https://hooks.example.com/...`, failing to resolve in
  the sandbox — the fixture's own pre-existing simulated-failure
  behavior, not a bug in this feature; see the base-form-config fixture's
  `notifySlack` postAction).
- [x] **A genuine pre-existing gap, surfaced while building the
  validation gate above, not introduced by it**: no form config in this
  entire app has EVER had field-level validation
  (`validateField`/`runCustomValidators`, both already exported from
  `@skye/config` since early in the project but never actually called
  anywhere) run before submission — confirmed by grepping the whole app
  for any caller, finding none. The normal (non-draft) `/form` submit
  path STILL doesn't validate before writing to SharePoint; this pass
  only wires validation into the NEW draft-preview path, per the actual
  scope of what was asked, not the general submit flow. New:
  `lib/validation/validateFormValues.ts` (pure, 7 tests — skips
  content-only controls, readonly fields, and fields currently hidden by
  their own `visibleIf`) and `src/validation/customValidators.ts` (the
  app's real registry — currently EMPTY, since no config in this repo has
  needed a custom validator yet; add real ones here as they come up).
  **Recommend a deliberate follow-up decision** on whether/how to also
  validate the normal submit path — not done here to avoid silently
  changing existing production submit behavior as a side effect of an
  unrelated draft-preview feature. **Resolved in §17.3 below** — the
  follow-up decision was made explicitly (by the user) and the gap is now
  closed everywhere.
- [x] **Fixed a real bug, not a cosmetic one: the live preview was
  silently resetting to page 1 on every single edit.** Root cause:
  `renderForm.ts`'s page switching happens entirely inside its own
  tab-click handler with no callback out to the caller, so `/builder`'s
  "remember the active page, pass it to the next rebuild" variable was
  only ever updated once, right after construction — never when the
  author actually clicked a different tab afterward. Fixed by having
  `renderForm` track and expose a live `getActivePageKey()` (plus accept
  an `initialPageKey` option) and having `/builder` hold a reference to
  the CURRENT preview instance, reading its live `getActivePageKey()`
  right before tearing it down on every rebuild — reading a stale
  snapshot was the actual bug. Caught by an end-to-end Playwright check
  (switch to page 2, edit a field, confirm the preview is still showing
  page 2 afterward — it wasn't, before this fix), not by the unit tests
  alone. 3 new tests in `builderPreview.test.ts`, 2 in `renderForm.test.ts`.
- [x] **Found and fixed a real mock-only bug during manual E2E
  verification of the draft workflow**: `MockGraphClient`'s in-memory
  stores only ever lived for one page's JS execution — this app has no
  client-side router between pages (confirmed: even the existing top-level
  `atob()` call in this same file at module scope only works because this
  code never actually executes during the Node build step, only in the
  browser), so `/builder` and `/form` are genuinely separate script
  executions with no shared memory. A draft saved in `/builder` was
  invisible to `/form`'s draft-preview even in the SAME browser tab.
  Fixed by mirroring the form-config and draft stores to `sessionStorage`
  (falls back to a plain in-memory Map if unavailable — private
  browsing, or any environment with no `sessionStorage` global at all;
  this is dev/testing convenience only, never a source of truth). This
  does NOT and CANNOT make the mock simulate real cross-user sharing — a
  tester opening a shared preview link in a genuinely fresh browser
  session won't see a draft only ever saved in someone else's tab
  (`sessionStorage` is per-tab); that's an inherent, honest limitation of
  a client-side-only mock, not something to chase further here. A real
  Graph backend has no such limitation at all.
- [x] Mock fixture update: `skye_data/config/skye.config.json`'s mock
  fixture now sets `builderEditors: ["admin"]` — since the mock
  unconditionally simulates a user who can see the "admin" overlay, this
  means every mock session "has edit permission" by default. There's
  currently no way to make the mock simulate a NON-editor to exercise the
  permission-denied panel visually (the underlying logic IS unit-tested
  via `canEditFormConfigs`/`canEditFormConfig` directly) — a minor,
  flagged gap, not a blocker.
- [x] **Manually verified end-to-end against the mock** (two combined
  Playwright scripts, both zero console/page errors): permission gate
  passes through cleanly for the mock's always-editor user; page-tab
  switch + live field edit + preview correctly stays on the same page;
  `Visible If` confirmed present in the field editor (already true by
  construction — every schema property gets a control, this wasn't a
  fix); Save → diff dialog → Confirm & Save → "Saved" status; new draft
  → edit → Save → diff dialog → Publish → "Published" status; `/form`'s
  "Edit in Builder" link present and correctly linked; a fresh tab's
  draft-preview (via `sessionStorage`, same tab as the `/builder` session
  that created it) shows the draft banner, correctly merges the real
  admin overlay on top (title correctly reflects the overlay's override —
  confirms the merge-real-overlays-onto-the-draft design works, not a
  bug), blocks submission with per-field messages until required fields
  are filled, then shows the run-actions dialog; both "Don't Run Actions"
  and "Run Actions" verified to behave as designed.

### 17.2 Third pass — field-level validation everywhere, `:user-invalid`-style reveal

Direct follow-up asking specifically to close the gap flagged at the end
of §17.1: make sure every form-rendering surface (live `/form`, draft
preview, `/builder`'s own live preview) runs field-level validation, and
that an invalid field only visibly shows as invalid once the user has
actually interacted with it — "something like CSS's `:user-invalid`".

- [x] **Implemented centrally, not per-surface.** `lib/render/renderForm.ts`
  itself now owns validation: `RenderFormOptions` gained `customValidators`
  (threaded through from the app's real registry); `RenderedForm` gained
  `validateAll(): boolean` (runs `validateFormValues` — unchanged, already
  existing — over the whole form, marks every field touched, updates every
  field's display, returns overall validity). Because `/form`,
  `/form?draft=...`, and `/builder`'s preview all render through
  `renderForm`/`renderBuilderPreview`, every one of them got this for
  free — no separate wiring needed per surface, which is also what makes
  "everywhere, consistently" actually true rather than aspirational.
- [x] **`entry-form.ts` now calls `rendered.validateAll()` before EVERY
  submit attempt**, live or draft alike — this is the literal gap closure
  from §17.1. The draft-preview's own standalone `validateFormValues` call
  was removed as redundant; it now gets the same validation for free from
  `validateAll()`, with the "run post-submission actions?" dialog layered
  on top only once that passes.
- [x] **The `:user-invalid` ask, implemented as a hybrid, not purely the
  native pseudo-class** — several controls here (`skye-people-picker`,
  `skye-lookup-picker`, `skye-lookup-table`, `skye-richtext`,
  `skye-calculated-display`) are custom elements with no native
  Constraint Validation participation at all, so `:invalid`/`:user-invalid`
  can never match them no matter what CSS says. Solution: a `touchedFields`
  set, populated by ONE delegated `focusout` listener on the form root
  (using `closest("[data-field-key]")` so it works whether the actual
  focused element is the tagged control itself or something inside it —
  handles both shadow-DOM event retargeting and light-DOM structure),
  drives a `.skye-field--invalid` class + explicit `aria-invalid` on
  EVERY control type uniformly — the real source of truth for the visible
  styling. On top of that, any control that DOES support it
  (`typeof control.setCustomValidity === "function"`) also gets the same
  message pushed through `setCustomValidity()`, so the real native
  `:user-invalid`/`:invalid` pseudo-classes engage too — `form.css` styles
  both selectors identically so they can never visually disagree. An
  error is always computed; it's only ever DISPLAYED once touched (blur)
  or `validateAll()` was called (submit attempt) — the actual
  "don't flash red on a pristine field" behavior asked for.
- [x] **Accessibility wiring, not just visual**: `renderField.ts` now
  always gives each field's message element a stable `id` and associates
  it via `aria-describedby` on the control (kept permanently associated
  even while empty, simpler than toggling per validation pass);
  `aria-invalid` is set explicitly and identically across native and
  custom-element controls alike, not left to whatever the browser happens
  to infer.
- [x] **Manually verified in a REAL browser, not just jsdom** (screenshots
  captured, not just console assertions): a pristine required field shows
  nothing on page load; focusing then blurring it without typing in
  anything reveals its error, red-outlined input + red label + message
  text; typing a valid value clears the error live without needing to
  blur again; clicking Submit with OTHER required fields still empty
  reveals all of them at once via `validateAll()`, blocking the submit
  with a "Please fix the highlighted field(s) below." status and zero
  console/page errors.
- [x] 6 new tests in `renderForm.test.ts` (pristine-hides, touch-reveals,
  live-clear-on-correction, `validateAll` marking every field touched,
  `validateAll` returning true once genuinely valid, a registered custom
  validator actually firing through `RenderFormOptions`).
  **367 tests passing across both packages** (up from 361 — 82 in
  `@skye/config`, 285 in `@skye/app`), both type-check clean, Astro
  production build verified.
- [ ] **Not extended to this pass**: the normal (non-draft) `/form`
  submit path's field validation is the SAME `validateFormValues` logic
  as before (skip content-only/readonly/hidden-by-visibleIf) — no new
  validation RULES were added, only the missing WIRING. If a form ever
  needs a rule this logic doesn't already express, that's a separate,
  future ask.

### 17.3 Fourth pass — custom elements as REAL form-associated custom elements

Direct follow-up: `skye-people-picker`/`skye-lookup-table`/`skye-richtext`/
and every other custom element that's an actual editable form field
SHOULD properly participate in the platform's Constraint Validation API
(the real `ElementInternals` mechanism), not just get a look-alike CSS
class standing in for it.

- [x] **`registerElements.ts`'s `SkyeValueElement` base class is now a
  genuine form-associated custom element**: `static formAssociated = true`
  + `attachInternals()` in the constructor, plus `setCustomValidity(message)`/
  `checkValidity()`/`reportValidity()`/`validity`/`validationMessage`/
  `willValidate`, all delegating to the real `ElementInternals` object —
  the exact same method/property surface a native `<input>` already has.
  Every subclass (`SkyePeoplePicker`, `SkyeLookupPicker` via
  `SkyeSearchPicker`, `SkyeLookupTable`, `SkyeRichtext`,
  `SkyeCalculatedDisplay`) inherits this automatically via the existing
  base-class structure — no per-subclass changes needed.
- [x] **No changes needed in `renderForm.ts` at all** — its existing
  `typeof control.setCustomValidity === "function"` check (from §17.2)
  now simply returns `true` for these elements too, since the method
  genuinely exists now. The integration point was already correct; it
  just had nothing real to call before this pass.
- [x] **Deliberately excludes `skye-calculated-display` from meaningful
  validation** — it still inherits `formAssociated` harmlessly (shared
  base class), but is never marked invalid: it's read-only/derived and
  already excluded from `validateFormValues.ts`'s skip list ("never
  user-edited or read back for validation the normal way", per
  fieldRegistry.ts's existing comment).
- [x] **Deliberately NOT wired: `ElementInternals.setFormValue()`** — the
  other half of form-association (participating in a real `<form>`'s
  FormData on native submission). This app never wraps a form in an
  actual `<form>` element and submits entirely through its own JS
  pipeline (`submitForm.ts` reads `.value` directly) — there is no native
  submission event `setFormValue` would ever feed. Only the VALIDATION
  half of form-association is relevant here, and that's the half asked
  for and implemented.
- [x] **A real, environment-specific gap found and worked around before
  writing any of the implementation, not discovered by a failing test
  after the fact**: verified directly (a small standalone jsdom script,
  not a guess) that jsdom 25 implements `attachInternals()` itself but
  NOT the Constraint Validation portion of what it returns —
  `setValidity`/`checkValidity`/`validity`/`validationMessage`/
  `willValidate` are all `undefined` there (jsdom's `ElementInternals`
  only implements the ARIA-reflection mixin). Every new method on
  `SkyeValueElement` feature-detects (`typeof this._internals?.setValidity
  === "function"`) before touching `_internals`, so behavior is
  environment-appropriate: full participation in a real browser, graceful
  no-ops (never a thrown `TypeError`) under jsdom.
- [x] **Manually verified against real Chrome, not assumed to work just
  because it didn't throw under jsdom**: a rendered `skye-richtext`
  field's `checkValidity()`, `validity.valid`, and the `:invalid` CSS
  pseudo-class all correctly flip to invalid the instant
  `setCustomValidity("...")` is called on it, and correctly flip back
  once cleared with an empty string — genuine, working native Constraint
  Validation for a real custom element. **One honest nuance surfaced by
  this same check, not glossed over**: `:user-invalid` specifically did
  NOT engage from a scripted `focus()` + `blur()` on the element, unlike
  `:invalid` which engaged immediately — Chrome's "has the user
  interacted with this form-associated custom element" heuristic for
  `:user-invalid` appears to require something this test didn't trigger
  (likely a real user-driven interaction sequence, or an actual form
  submission attempt, neither of which a plain scripted `.focus()`/`.blur()`
  call reproduces). This doesn't weaken the feature — it's exactly why
  `renderForm.ts`'s own `.skye-field--invalid` class (driven directly by
  its own `touchedFields` tracking, not a browser heuristic) is the
  layer that actually GUARANTEES the visible styling; the native
  `:invalid`/`:user-invalid` pseudo-classes are confirmed to genuinely
  work now too, as a real additional layer, not the sole mechanism.
- [x] `form.css` extended: `skye-richtext`/`skye-lookup-table` (the two
  custom elements with no single native input/select/textarea for the
  pre-existing invalid-styling rule to reach — richtext's editor is a
  contenteditable div, a lookup table has one input per row not one for
  the whole field) now get a real `border` directly on the custom element
  itself when invalid, both via `.skye-field--invalid` (the guaranteed
  layer) and `:user-invalid` (the native layer, kept visually identical
  so the two can never disagree). `skye-people-picker`/`skye-lookup-picker`
  needed no new rule — their inner search `<input>` was already reached
  by the existing native-input rule.
- [x] 2 new tests in `registerElements.test.ts` — every SKYE custom
  element is `formAssociated`; every one exposes the full Constraint
  Validation method/property surface without throwing (the meaningful,
  environment-safe assertion given jsdom's real limitation above — full
  "does it actually go invalid" behavior was verified against real
  Chrome instead, manually, not asserted in the test suite where it
  can't be). **369 tests passing across both packages** (up from 367 —
  82 in `@skye/config`, 287 in `@skye/app`), both type-check clean, Astro
  production build verified.

### 17.4 Not yet done / known gaps, flagged rather than papered over

  - `/switcher` still has no link to `/builder` (only `/form`'s new "Edit
    in Builder" link exists) — not requested, the page is reachable
    directly via `/builder?applicationId=...`.
  - `visibleIf`/`when` (the `condition` schema kind) and any genuinely
    untyped value (`defaultValue`, `options[].value`, a postAction's
    `value`/`body`) are edited as raw JSON text, not a guided UI — a
    deliberate scope cut (see the schemaIntrospection entry above), not
    an oversight.
  - `htmlAttributes`' `patternProperties` (arbitrary extra `data-*`/`aria-*`
    attributes) aren't editable through the builder yet — only its fixed
    named properties are; export the JSON and hand-edit for those, for now.
  - Deleting a base field that an overlay currently overrides is allowed
    (with no warning yet) even though it can orphan that overlay's
    override — a lint-quality nicety to add later, not a correctness bug
    (Save-time validation still catches anything that makes the *saved*
    config itself invalid).
  - No way to make the mock simulate a non-editor user, to visually
    exercise `/builder`'s permission-denied panel (the logic behind it is
    unit-tested directly instead).
  - A draft has no permission overlays of its own — it's previewed as
    base-plus-whatever-real-overlays-the-viewer-can-see, but there's no
    way to author a draft-specific overlay separate from the live ones.
    Not requested; flagging as a real limitation if per-permission-level
    draft testing ever comes up.
  - `:user-invalid` specifically doesn't reliably engage on SKYE's custom
    elements from a plain scripted focus+blur (confirmed against real
    Chrome — see §17.3) even though `:invalid`/`checkValidity()`/
    `validity` all correctly do. Not a blocker (`.skye-field--invalid`,
    driven by this app's own `touchedFields` tracking, is the actual
    guaranteed styling layer, unaffected by this), but worth knowing if
    anything ever depends on `:user-invalid` specifically for these
    elements.
  - `ElementInternals.setFormValue()` isn't wired on any custom element
    (see §17.3) — deliberate, since this app has no real `<form>` element
    anywhere to submit natively; would need revisiting if that ever
    changes.
  - Not tested against a real tenant — like the rest of this project's
    Graph-writing code, this has only been exercised against
    `MockGraphClient` and jsdom/Playwright, not a live SharePoint site.

## 18. Page markup extracted from TypeScript into `.astro` (new pass)

- [x] **Every page's fixed markup now lives in `src/pages/*.astro`**, not
  in `entry-*.ts`. Pattern: a page ships all its states at once as
  `<section data-state id="…" hidden>` siblings inside
  `<main id="skye-app">` (from `src/layouts/BaseLayout.astro` + composed
  `src/components/*.astro`); the entry script calls
  `showState(root, id)` / `fillSlot` / `el` from **`src/lib/ui/pageState.ts`**
  and clones `<template>`s, instead of `document.createElement` /
  `appRoot.innerHTML = "…"`. Scope confirmed with the user: user-facing
  pages only (`index`/`404`/`view`/`form`/`switcher`/`builder`);
  `diag.astro`/`entry-diag.ts` left untouched; genuinely data-driven
  builders (`lib/render/*`, `lib/builder/fieldEditor|formSettingsEditor|schemaControls|configDiffView|builderPreview`)
  left in TS and mounted into a `[data-slot]`.
- [x] **New shared components:** `BaseLayout.astro` (doc shell + `head`
  slot), `ConfirmDialog.astro` (a native `<dialog>` — `lib/ui/confirmDialog.ts`
  fills+opens it, resolves with the clicked `<button value>`; feature-detects
  `showModal`/`close` so jsdom < 26 still works via an open-attr + `close`-event
  emulation), `MessagePanel.astro` (`lib/ui/messagePanel.ts`), and the
  switcher steps `SitePicker`/`FormPicker`/`FormOrViewPicker`/`AddSitePanel`/
  `PermissionsStep`/`CreateSiteAssetsStep`. `lib/routing/siteSwitcher.ts`'s
  `renderX` functions became `populateSitePicker`/`populateFormPicker`/
  `populateFormOrViewPicker`/`wireAddSitePanel`/`fillPermissionsStep`/
  `wireCreateSiteAssetsStep` operating on the pre-rendered `<section>`; the
  pure URL builders + `toPickerEntries` are unchanged.
- [x] **`command`/`commandfor` + `invokers-polyfill`** — `src/lib/ui/invokers.ts`'s
  `ensureInvokerCommands()` (called early by each entry script)
  dynamic-imports `invokers-polyfill` (^1.0.4, added to `src/app` deps)
  only when `"commandForElement" in HTMLButtonElement.prototype` is false.
  Native `<dialog>`/`<output>`/`<menu>`/`<details>`/semantic sectioning
  used throughout; no `<div>` where a real element fits.
- [x] **Tests restructured** (confirmed acceptable with the user):
  `siteSwitcher`/`addSitePanel`/`formOrViewPicker`/`confirmDialog`/`messagePanel`
  `.test.ts` now mount the real `.astro` component body via
  `src/__tests__/helpers/astroFixture.ts` (reads the file, strips
  frontmatter — components are expression-free) so there's no hand-copied
  fixture to drift; `pageState.test.ts` + `astroMarkupHooks.test.ts` (a
  drift guard asserting every `id`/`data-slot`/`data-el`/`data-tpl` the TS
  queries exists in the `.astro` source) added. **442 tests pass** (82
  `@skye/config` + 360 `@skye/app`), typecheck clean, Astro build of all 7
  pages succeeds, Custom Views browser gate still green, real-Chrome smoke
  pass of every page (site picker / add-site confirm `<dialog>` / permissions
  step / form-or-view picker / builder chrome + Save diff `<dialog>` / form
  mount / view states).
- ⬜ **Follow-ups:** the ARIA pass noted in §17.4 now also covers the new
  semantic sections; a real-tenant pass is still outstanding for
  everything Graph-touching.

## 19. Builder Post Actions editor — phases, sequencing, real action list (new pass)

- [x] **All available action/postAction types are reachable, and the
  `script` list is pulled from the real registry.** A `script` postAction's
  `functionName` renders as a `<select>` grouped by service (`<optgroup>`
  teams / outlook / engage) built from `Object.keys(scriptActions)`
  (`src/actions/registry.ts`) — every `teams.*` / `outlook.*` / `engage.*`
  action this build ships, nothing else. `renderFormSettingsEditor` gained
  a `{ scriptActionNames }` option; `entry-builder.ts` passes it. A
  `functionName` value the current build doesn't register is still shown,
  flagged `(unknown)`, so opening an old config never silently drops it.
  The 6 schema `type`s (`httpRequest`/`graphRequest`/`redirect`/
  `showMessage`/`setField`/`script`) already came from the schema via
  `getPostActionSchemaProperties`; that's unchanged.
- [x] **Separate section per `trigger` phase** — `beforeSubmit` /
  `afterSubmit` / `onSuccess` / `onError`, each with a one-line "when it
  runs" blurb, its own "+ Add action" (presets `trigger`), and a per-card
  "Phase" `<select>` to move an action (which also prunes any `dependsOn`
  that would now cross phases). An action whose `trigger` isn't one of the
  four is surfaced in a red "Not assigned to a phase" section instead of
  disappearing.
- [x] **Sequential vs parallel is visually explicit.** `computeWaves`
  groups a phase's actions by `dependsOn` depth (wave 0 = nothing to wait
  for; wave N depends on an earlier wave); the UI renders "Step 1 — these N
  run at the same time", a "↓ then" separator, "Step 2", … and each card
  says "Starts immediately…" or "Waits for: X". `dependsOn` itself is now a
  checkbox list of the other actions in the same phase, not a
  comma-separated text field. Cards are ordered topologically so a
  dependent never renders above its dependency.
- Implementation: `src/lib/builder/formSettingsEditor.ts` (rewrote the
  `renderPostActionsDictionary` → `renderPostActionPhases` + `computeWaves`
  + `renderDependsOnControl` + `renderFunctionNameControl`), `entry-builder.ts`
  (import `scriptActions`, pass `scriptActionNames`), `public/styles/builder.css`
  (`.skye-builder__phase*` / `__wave*` / `__seq*` / `__depends*` /
  `__phase-add`). `configDiffView`/validation/`submitForm` untouched — the
  saved config shape is unchanged. `formSettingsEditor.test.ts` rewritten
  (10 tests: 4 phase sections, add-presets-trigger, functionName dropdown
  grouped by service, redirect payload still appears, dependsOn checkboxes
  drive the wave view, phase mover, orphan section). **448 tests**, type-check
  clean, build verified, real-Chrome smoke against the `test-event-signup`
  fixture (its `afterSubmit` chain renders as Step 1 [notifySlack +
  createFollowupTicket] → then → Step 2 [notifyCatering "Waits for:
  createFollowupTicket"]).

## 20. Builder: column-first field creation + required-column coverage (new pass)

- [x] **`src/lib/builder/columnMapping.ts` (new)** — `controlTypeForColumn`
  (SP column type → SKYE `controlType`), `fieldConfigForColumn` (a
  ready-to-drop `source:"sharepoint"` field: `bindTo` + mapped
  `controlType` + `label`/`required`/`page`), `fieldKeyForColumn`
  (`_x0020_`-decoded camelCase key, de-duped), `missingRequiredColumns`
  (required, non-`readOnly` columns no sharepoint field binds to). Fully
  unit-tested (`columnMapping.test.ts`, 8 tests).
- [x] **"+ Add field" sub-form gained Source + Bind to `<select>`s**
  (`builder.astro` `#tpl-add-field` + `entry-builder.ts`). Source =
  `sharepoint` / `virtual`; for `sharepoint`, Bind to lists
  `state.listColumns`. Picking a column auto-selects the matching
  `controlType` and pre-fills the key; the type stays manually
  overridable. `source:"sharepoint"` with no column bound is refused; no
  live columns → SP-only controls hide, falls back to a plain virtual
  field.
- [x] **Required-column coverage.** New form: `openBuilder` seeds a bound,
  `order`-ed field per required column right after `getListColumns`
  (`columnMapping.requiredColumnFields`), and the seed's `layout` defaults
  to `{ gridTemplateColumns: 1 }` (`columnMapping.SINGLE_COLUMN_LAYOUT`) —
  a single CSS Grid column, no `gridTemplateAreas`, so the fields
  auto-stack one per row by `order` and stay correct as fields change
  later. Existing base/draft: `renderFormSettingsEditor` shows a top "N
  required SharePoint columns have no field" panel with per-column "Add
  field" (each `order`ed after the last field) + "Add all" (new options
  `{ listColumns, defaultPageKey, requiredColumnCheck, onFieldsChanged }`)
  — surfaced, not silently mutated. Not shown for an additive overlay
  view. `formSettingsEditor.test.ts` +5.
- [x] **`GraphListColumn.readOnly`** added and captured in `mapColumn`, so
  computed/system required columns (Created/Modified/…) are excluded from
  the bind-to list, the new-form seed, and the missing-columns panel.
- [x] **Fix: `renderForm.ts` grid-area collapse.** `renderField` sets
  `grid-area:<fieldKey>` on every field wrapper, but that only resolves
  when the page's `gridTemplateAreas` names the key — an unresolved
  `grid-area` name pins every such field to the same cell, so a
  single-column form with no `gridTemplateAreas` rendered as one
  overlapping pile (user-reported). `renderForm` now builds a per-page set
  of names its `gridTemplateAreas` actually places and calls
  `style.removeProperty("grid-area")` on any field not in it, so those
  fields auto-place into the grid flow instead. Existing fixture forms
  (whose pages name every field) are unchanged. 3 new tests in
  `renderForm.test.ts` (unnamed → no grid-area; named → keeps it; mixed →
  only the unnamed one cleared).
- [x] **Every rendered field is labelled + identifiable** (user-reported:
  builder-seeded fields rendered as bare `<input>`s with no `id` and no
  `<label>`). `renderField.ts` now unconditionally sets `id` = field key
  and `name` = `field.bindTo || fieldKey` on the control, and emits an
  associated `<label for>` — or a `<legend>` for the `<fieldset>`-based
  group controls (`radio`/`checkboxGroup`), where `<label for>` doesn't
  associate; the group's inner inputs also get the shared `name`. Label
  text is `field.label`, falling back to `humanizeFieldKey`
  (`lib/render/fieldLabels.ts`, new — decodes `_x0020_`, splits camelCase).
  `entry-form.ts` runs `backfillFieldLabels(merged.fields, listColumns)`
  after `populateChoiceOptionsFromColumns` so a missing `label` first
  borrows the bound column's `displayName`. Display-only/data-only
  controls (`heading`/`paragraph`/`divider`/`hidden`) are excluded — no
  `<label>` (`hidden` still gets `id`/`name`).
  `columnMapping.fieldConfigForColumn` now always writes an explicit
  `label`. New `fieldLabels.test.ts` (7) + 5 `renderForm.test.ts` cases;
  1 `columnMapping.test.ts` case updated.
- **479 tests** (82 `@skye/config` + 397 `@skye/app`), type-check clean,
  Astro build verified, real-Chrome smoke: picking a `dateTime` column set
  Type→`date` + key→`eventStartTime`; a new form against the `Events` list
  seeded its required `Title` field (panel stayed hidden) with the page
  grid computing to `repeat(1, 1fr)` / a single column; adding more bound
  fields, all stack top-to-bottom at distinct positions, full width, no
  `grid-area` (no overlap); every rendered field (live `/form` + builder
  preview) has an `id`, a `name`, and a non-empty `<label>`/`<legend>`;
  deleting a required field made the panel appear ("1 required SharePoint
  column has no field…"), and its "Add field" restored it.

## 21. Dependency modernization — Astro 7 / Vitest 5 / TS 7 / MSAL 5 (new pass, 2026-09)

Triggered by a user report that `PUBLIC_MOCK_GRAPH=1 pnpm dev` printed
nothing: on the machine's Homebrew **Node 26**, Astro 4's ESM config
loader hangs outright (infinite constructor recursion in a startup
dynamic `import()`, confirmed via `sample`) and Vitest 2 crawls (65s for
82 tests). The fix was to move the whole toolchain to its current major.

- [x] **Versions bumped to latest.** `astro` 4.16 → **7.3.1** (Vite 7
  under it), `vitest` 2.1 → **5.0.0**, `jsdom` 25 → **30.0.1**, `typescript`
  5.6 → **7.0.2** (native compiler), `@azure/msal-browser` 3.27 → **5.21.0**,
  `turbo` → 2.10.12, `tsx` → 4.23.13, `ajv` → 8.20.0. Unchanged (already
  current): `@microsoft/microsoft-graph-client` 3.0.7, `@playwright/test`
  1.62.1, `invokers-polyfill` 1.0.4. Root `engines.node` set to
  `>=22.12.0`; new `.node-version` pins it.
- [x] **Astro 7 app is a near-no-op migration** — the app has no
  integrations, no adapter, no content collections, no `getStaticPaths`,
  no `Astro.glob`; `output: "static"` is still valid. Only Astro API used
  is `Astro.props` + `import.meta.env.PUBLIC_*`. Build, dev, and all 7
  routes verified.
- [x] **MSAL 5**: the one code change. `navigateToLoginRequestUrl` was
  removed from `Configuration.auth` and now lives on
  `handleRedirectPromise({ navigateToLoginRequestUrl: false })` — moved in
  `shared/auth/redirectReturn.ts`. Auth is otherwise untouched and still
  unverified against a live tenant (MSAL 3→5 behavior changes need real
  Entra).
- [x] **Vitest 5: `pool: "threads"`** in `packages/app/vitest.config.ts`.
  The default `forks` pool forks a Node process per file and builds jsdom
  inside it (~7s each), tripping the worker-startup timeout on ~11 of 45
  files ("Failed to start forks worker … Timeout waiting for worker to
  respond"). Threads share the process; the full app suite then runs in
  ~8s, all 397 tests passing.
- [x] **Vitest 5 stopped excluding `dist/` by default**, so `form-config`'s
  `tsc`-compiled `dist/__tests__/*.test.js` copies got discovered and
  every test ran twice (13 files → "26", 82 → "164"). Fixed both ways: a
  new `packages/form-config/tsconfig.build.json` (extends `tsconfig.json`,
  excludes `*.test.ts` + `__tests__/`) that `build` now points at, and an
  explicit `exclude` list with a `dist/` guard in
  `form-config/vitest.config.ts`.
- [x] **jsdom 30** now implements `<dialog>.showModal()` and
  `ElementInternals`'s Constraint Validation API (jsdom 25 didn't). The
  feature-detected fallbacks in `shared/ui/confirmDialog.ts` and
  `features/form/registerElements.ts` are now inert but harmless — left in
  place.
- [x] **Astro 7 `astro dev`/`astro preview` daemonize under AI-agent
  detection** (`am-i-vibing`), switching to JSON logs. Harmless for a
  human terminal (`pnpm dev` stays foreground). The Playwright gate needed
  `ASTRO_PREVIEW_BACKGROUND=1` in `webServer.env` so preview stays
  foreground and Playwright can manage it. `.gitignore` gained `.astro/`
  (Astro 7 writes generated types + a dev/preview lock there).
- **479 tests green** (82 `@skye/form-config` + 397 `@skye/app`), both
  packages type-check clean on TS 7, `pnpm build` builds all 7 pages,
  `pnpm test:views:browser` green (3/3, every security probe BLOCKED),
  `pnpm install --frozen-lockfile` consistent. All via `turbo run <task>`.

---

**Status:** Everything through §12 is now done except the items explicitly called out as open below — schema, `packages/skye-config`, `MOCK_GRAPH` fixtures, the `packages/app` render layer, the submit/postAction pipeline, real Web Component implementations, `calculatedDisplay` reactivity, etag-conflict UX, lookupTable row deletion, the site switcher (Graph `/search/query`, exact-match filtering to `skye_data` folders), file uploads (`library` mode; `attachment` mode deliberately unimplemented with an honest explanation), and Turborepo task orchestration (§15) — **97 tests passing across both packages** (40 in `@skye/config`, 57 in `@skye/app`), both type-check clean, and a full Astro production build succeeds, all runnable via `turbo run <task>` with confirmed caching. `skye-richtext` was deliberately simplified to a minimal HTML/CSS-only placeholder (no `execCommand`, no formatting logic) per explicit instruction, replacing an earlier toolbar implementation. **Remaining open items** (see §13 and "Newly discovered gaps" above): an ARIA pass on the now-functional components, choosing and integrating a real editor library for `skye-richtext`, MSAL redirect-fallback state recovery, and verifying `searchSitesWithSkyeData`/list-column caching/etc. against a real tenant. See `CLAUDE.md` for the running summary and repo conventions.

---

## 22. Multi-value controls + real Person/Choice column writes (new pass, 2026-09)

Driven by testing the Luddy LLC event-proposal form against a live tenant.

- [x] **`peoplePicker` is now a token/chip multi-picker.** Each chosen
  person is a discrete removable unit (chip with an ×; Backspace on the
  empty input removes the last) — no delimiter is ever shown or typed.
  `SkyePeoplePicker` (`registerElements.ts`) no longer extends
  `SkyeSearchPicker` (which stays for the single-value `lookupPicker`).
  `.value` is a `string[]` of keys — each person's email when the
  directory result has one, else their directory id. `set value` also
  accepts a single string or an array of SharePoint person objects
  (`{ Email | LookupValue | … }`) via `normalisePeopleValue`, so an
  edit-mode prefill of a Person column shows chips.
- [x] **`checkboxGroup` is now a dropdown multi-select** (`skye-multi-select`),
  not an always-expanded column of checkboxes: a trigger button that
  summarises the selection ("Alpha, Beta" / "4 selected") and a
  click-away-closable panel of checkable options. Options are threaded in
  via `fieldRegistry`'s `configureElement` hook from the field's
  `options` (which `populateChoiceOptionsFromColumns` still fills from the
  bound Choice column). `.value` is a `string[]`; `set value` splits a
  `"; "`/`","`-joined string too. `renderField`'s `isGroup` branch is now
  `radio`-only — `checkboxGroup` takes a normal `<label for>`.
- [x] **`radio` value is actually read now.** It had `valueAccessor:
  "none"`, so a `<fieldset>`-based radio group never populated `values` —
  meaning a `visibleIf` keyed off a radio field (e.g. "show the Purchase
  Table when Requires Purchases = Yes") could never fire. `radio` is now
  `valueAccessor: "value"` and `renderForm`'s `readControlValue` /
  `writeControlValue` special-case an `HTMLFieldSetElement` (read the
  checked input's value; write by matching `input.value`).
- [x] **Real SharePoint encoding for Person + multi-Choice columns** —
  new `features/form/submit/encodeSharePointFields.ts`
  (`buildPrimarySharePointFields`), used for the primary item write in
  `submitForm.ts` in place of `mapValuesToSharePointFields` (which stays
  for lookupTable rows). Keyed off the live column type from
  `getListColumns`:
  - `personOrGroup` → each identifier resolved via the new
    `GraphClient.resolveSiteUserId(siteId, identifier)` (looks the person
    up in the site's hidden **User Information List** — server-side
    `$filter` on `EMail`/`UserName` with a
    `HonorNonIndexedQueriesWarningMayFailRandomly` Prefer header, then a
    bounded local scan) → `<col>LookupId` (scalar for single-value,
    `Collection(Edm.Int32)` for multi via the new `allowMultiple` flag on
    `GraphListColumn`, read from Graph's `allowMultipleSelection` facet).
  - `choice` + a `checkboxGroup` field → `Collection(Edm.String)`.
  - a stray array anywhere else → joined with `"; "` (never `[object Object]`).
  An unresolvable person is reported in the new `SubmitResult.fieldErrors`
  (surfaced by `page-scripts/form.ts` as a "some values need a second
  look" warning) and that field left unwritten — the item still saves.
  **`resolveSiteUserId`'s real path is unverified against a live tenant.**
- [x] **`isEmpty` (form-config `nativeValidators.ts`) is array-aware** — a
  `required` multi-select / people picker with `[]` now fails `required`
  like an empty text box.
- [x] **`fileStorage` / poster** — file fields render as a tall dashed
  drop zone (`.skye-field--file` in `form.css`) that fills a row-spanning
  grid cell.
- **495 tests** (83 `@skye/form-config` + 412 `@skye/app`), type-check
  clean, Astro build of all 7 pages OK, `lint:configs` green on the
  `luddy-llc-event-proposal` config.

---

## 23. Dedicated MSAL redirect page + responsive form layout + live-tenant testing (new pass, 2026-09)

Driven by testing the Luddy LLC event-proposal form in a real headed
browser against the IU tenant.

- [x] **`/auth` — a dedicated, minimal MSAL redirect landing page.**
  `redirectUri` was `window.location.origin` (the index SPA), so a
  `loginPopup` sent the popup to the full app ("mini SKYE"), MSAL's popup
  handshake never completed, and every sign-in timed out after 60s and
  fell back to `loginRedirect`. New `shared/auth/redirectUri.ts`
  (`authRedirectUri()` → `${origin}/auth`), `pages/auth.astro` (no
  BaseLayout, no stylesheets — just "Signing you in…"), and
  `page-scripts/auth.ts`: in a popup, settle MSAL and let the opener close
  the window (self-close fallback after 4s); in a full-page redirect, run
  the existing `completeRedirectReturn()` and navigate back.
  `authProvider.ts` and `redirectReturn.ts` now use `authRedirectUri()`;
  `findClientIdInMsalCache` is exported for the new page. **Deployment: the
  Entra app registration must add `<origin>/auth` as an SPA redirect URI.**
  Verified end-to-end against the live tenant — sign-in completes through
  `/auth`, no app flash.
- [x] **Responsive form layout.** `public/styles/form.css` gained a
  `@media (max-width: 700px)` block that collapses every page's grid to a
  single stacked column. It overrides only the grid *tracks*
  (`grid-template-columns/areas/rows` + each field's inline
  `grid-area:<key>`), never `display` — `renderForm`'s `showPage()` hides
  inactive tab pages with an inline `display:none`, and an earlier attempt
  that set `display:block !important` re-showed all four tabs at once. The
  file drop-zone shrinks and the lookupTable scrolls within its own field
  (`overflow-x:auto`). Verified on a 390×844 emulated phone.
- [x] **`GraphClient.resolveSiteUserId` hardened.** The single
  `$filter=fields/EMail eq …` returned empty for real IU users, so it now
  tries `EMail` / `UserName` / `Name` filters, then a **bounded** (3-page)
  scan matching any of those plus the `i:0#.f|membership|<upn>` claims
  format. Bounded deliberately — an unbounded paginated scan turned one
  submit into dozens of sequential Graph round-trips (caught in live
  testing: the submit hung mid-pagination). A person who has never visited
  the site still won't resolve (Graph can't "ensure" a new user); the
  encoder already reports that and leaves the field blank.
- [x] **Encoder: `checkboxGroup` bound to a single-value Choice column**
  now writes the first selection + a `fieldErrors` warning instead of
  sending a `Collection(Edm.String)` that SharePoint 400s. Still defaults
  to the collection when Graph doesn't positively report the column as
  single (`allowMultiple === false`), since the `choice` facet often omits
  the flag for a genuinely multi-value column.
- **Live-tenant findings (not code — the form's list needs work):** the
  Events list has **no `EventType` column** (`bindTo` repointed to
  `HostRole`, whose choices match); several `bindTo` names were wrong
  (`Photographer_x0028_s_x0029_`, `StudentImpact_x002c_EventGoalsan`,
  `BeInvolved_x0020_Event_x0020_Id`, `ProposalResponseText`) — all
  corrected in `skye_data/forms/luddy-llc-event-proposal/`. Multi-value
  Choice encoding (`Location@odata.type: Collection(Edm.String)`) and the
  full form-fill → real `POST /lists/…/items` path are confirmed working;
  the write currently 400s only on the missing `EventType`/`HostRole`
  binding until the config is re-uploaded.
- **495 tests green** (83 `@skye/form-config` + 412 `@skye/app`),
  type-check clean, Astro build of all 8 pages OK, `lint:configs` green.

### 23a. Follow-up — non-site people block the submit (not silently dropped)

Per user feedback: a people picker bound to a `personOrGroup` column, when
a picked person can't be resolved to a member of the site, must **fail
validation and block the submit** with a field-level warning — not save
the item with that field blank.

- `page-scripts/form.ts` runs the new
  `features/form/submit/checkPersonFields.ts`
  (`checkPersonFieldsResolve`) after `validateAll()` and before
  `submitForm` (and before the draft-preview dialog): for every
  `source:"sharepoint"` `peoplePicker` bound to a `personOrGroup` column,
  it resolves each pick via `graph.resolveSiteUserId` (session-cached, so
  the encoder's later call is free) and returns `{ fieldKey: message }`
  for any field with an unresolvable pick, naming the person(s).
- `renderForm` gained `setExternalErrors(Record<string,string>)` — merges
  caller-supplied field errors on top of the normal validation (they win,
  shown regardless of "touched"), marks those fields invalid, and
  re-renders. Any subsequent field edit (change event OR `setFieldValue`)
  clears them; `setExternalErrors({})` clears explicitly. Non-empty
  result → `form.ts` shows "fix the highlighted field(s)" and returns
  without submitting.
- The encoder's own `errors` path for an unresolved person stays as
  defense in depth but should now be unreachable on the live path.
- Virtual people pickers (e.g. the overlay's `reviewer`, which only feeds
  a Teams postAction) are not checked — a non-site person is fine there.
- 5 new tests (`checkPersonFields.test.ts` ×4, a `setExternalErrors` case
  in `renderForm.test.ts`). **500 tests green** (83 + 417).

### 23b. Follow-up — validate on page switch; trim the switcher's load path

Two user asks after live testing.

**Validation runs on page switch** (`renderForm.ts`): `showPage()` now
touches every field on the page being *left* and re-runs
`updateValidationDisplay()`, so a problem shows the moment you navigate
away — not only at Submit. `updateValidationDisplay()` additionally
toggles `.skye-form__tab--error` on any tab whose page has a shown error
(red label + a `●`, in `form.css`), so an error on a page you're not
looking at is still visible. No-op on the initial render.

**Site-switcher / sign-in load path, reviewed in a browser against the
real tenant** (`_drive-switcher.mjs`, gitignored). The critical path from
"token acquired" to the form/view picker was ~4.5s of serial Graph calls;
cuts:

- **`canWriteSkyeData` is a write probe** (PUT + DELETE of a marker file —
  two round-trips) and it ran on *every* `/switcher`, `/form` and
  `/builder` load just to gate a "Create/Edit in Builder" link. Now
  `RealGraphClient` caches the result in `sessionStorage`
  (`skye:canWrite:<siteId>`) and re-probes only once per site per browser
  session; `installSkyeSiteConfig` clears it for the site it set up.
- **The switcher no longer blocks the picker on that probe.**
  `canBuildPromise` is resolved in the background (`builderEditors` is a
  cheap synchronous check; the probe only runs if that misses), and
  `wireCreateNewFormConfig()` (split out of `populateFormOrViewPicker`)
  flips the link on when it lands.
- **`getSkyeSiteConfigFiles` + `listSkyeForms` + `listSkyeViews` now run
  in parallel** instead of config-then-lists — the `home` redirect still
  wins when set (the two list reads are then wasted, a rare path). All
  three resolve the same cached Site Assets drive id, so concurrent
  callers share one lookup. `SkyeNotConfiguredError` from the list calls
  is swallowed (the config result owns that case); any other list error
  still bubbles.

`_drive-switcher.mjs` confirms the warm (second) `/switcher` load makes
**zero write calls** (cold load still does the one probe). Tests + type-
check green (**501 total**).

### 23c. Follow-up — full form test against the tenant: bugs found + fixed

A comprehensive headed-browser run (`_drive-full.mjs`, gitignored) — every
field type, poster upload, purchase-table row, then re-open in edit mode.

**Confirmed working end-to-end against the live list:** item creation
(`POST 201`); **person columns** — single (`HostLookupId: 14`) and
multi (`Photographer_x0028_s_x0029_LookupId` as `Collection(Edm.Int32)`),
resolved via `resolveSiteUserId`; **all multi-value Choice** as
`Collection(Edm.String)` (Location, Categories, StudentSuccessDomain,
NACECompetencies); dates, text, `HostRole`, `Attire`, `RequiresPurchases`;
page-switch validation + the tab error markers.

**Bugs fixed:**

- **`ReferenceError: Buffer is not defined` on every library file upload.**
  `@microsoft/microsoft-graph-client`'s `serializeContent()` calls
  `Buffer.from()` on an `ArrayBuffer`/TypedArray request body — a Node
  global, absent in the browser. `uploadToLibrary` now wraps the data in a
  `Blob` (the one binary body shape the SDK passes through untouched).
  Confirmed: the poster then `PUT 201`s to
  `…/PHOTOS!/Event Posters/2026-2027/<templated name>.png`.
- **Blocked submit didn't move you to the problem.** `renderForm` gained
  `focusFirstError()` — `validateAll()` (on fail) and `setExternalErrors()`
  (when non-empty) now jump to the page of the first field showing an
  error and scroll it into view. Pairs with the tab `●` marker.
- **Raw JS errors leaked into the user-facing status.** A failed file
  upload put `err.message` straight into the "some values need a second
  look" line (the user saw "Buffer is not defined"). `submitForm` now
  writes a plain sentence naming the field; the real error still goes to
  the console.

**Config (`luddy-llc-event-proposal`) — corrected from the live list:**

- `poster` → `source: "virtual"` (dropped `bindTo`). The `Poster` column
  is a Thumbnail/Image column; writing the uploaded file's URL string to
  it `500`s ("General exception"). Virtual = the file still uploads to the
  library folder, it just isn't written to a column.
- `recordBeInvolvedIds` postAction: PATCH `body` key `BeInvolvedEventId` →
  `BeInvolved_x0020_Event_x0020_Id`, and the placeholder site/list ids in
  its URL filled in.

**500+ tests green**, type-check + `lint:configs` clean.

### 23d. Edit / view-mode prefill + the remaining config corrections

The comprehensive test's biggest gap: `page-scripts/form.ts` never loaded
the existing item, so `#luddy-llc-event-proposal/<itemId>` (edit) and
`…/<itemId>/view` rendered a **blank** form — editing was impossible and
the admin Approval flow's required fields all failed `validateAll()`.

- **`renderForm` gained `RenderFormOptions.initialValues`** — a value map
  applied after every field renders (so it wins over `defaultValue`) and
  written straight onto the controls, so people-picker chips and
  multi-select dropdowns show the saved data, not just plain inputs.
- **`submit/mapSharePointFieldsToValues.ts`** (new) — the inverse of the
  submit encoder. Reads only `source: "sharepoint"` fields with a
  `bindTo`; passes a person column's `{ LookupId, LookupValue }` (or its
  `<bindTo>LookupId` array) straight through; trims a SharePoint ISO
  datetime to what `<input type=date|datetime-local>` accepts; leaves a
  multi-value Choice array untouched.
- **`page-scripts/form.ts`** — for `route.mode` `edit`/`view` with an
  `itemId`, `await graph.getListItem(...)` → `mapSharePointFieldsToValues`
  → `renderForm(..., { initialValues })`, and the item's `etag` is now
  threaded into `submitForm` as `ifMatchEtag` so an edit is a real
  optimistic-concurrency write. A load failure logs and falls through to a
  blank form rather than dead-ending.
- **`resolveSiteUserId` numeric short-circuit** (real + mock) — an
  edit-mode person seed carries the already-resolved User Information List
  id; `/^\d+$/` returns it as-is instead of re-running the email/UPN scan
  (which would fail on a bare number and drop the person on re-save).
- **`normalisePeopleValue` key priority** — `LookupId` now sits ahead of
  the display name, so a seeded person with no email keys on its numeric
  id and re-saves through the short-circuit above.

**Config (`luddy-llc-event-proposal`) — remaining corrections:**

- Purchases list schema dumped from the live list. `relatedList.id` set to
  the real GUID `3ad9fead-6ec6-473b-93d3-b0aeeaef427c`; row column
  `bindTo`s corrected to SharePoint's actual internal names — `LinktoItem`
  (lowercase t) and `PriceperUnit` (lowercase p), not the camel-case
  guesses. `parentReferenceColumn` set to `k62e361189_d041078067_rlu` —
  the list has **two** auto-named lookup columns back to the Events list
  (`…_d041078067_rlu`, `…_5dc8796ea4_rlu`) and which one is the true
  parent reference still needs one live row-save to confirm (README §2
  documents the swap). `store` (Choice) still renders an empty dropdown —
  per-table-column choice loading from the related list isn't built;
  README flags adding static `options` or using `text` as the stopgap.
- **Admin overlay `decisionRecorded`** gained a `when` guard
  (`status in [Approved, Denied]`) so "Decision recorded and the host has
  been notified." no longer fires on a routine admin save; a new
  `changesSaved` message covers the other case.
- Still a placeholder: `createBeInvolvedEvent.args[0].submittedByOrganizationId: 0`.

**507 tests green** (83 `@skye/form-config` + 424 `@skye/app`),
type-check + `lint:configs` + Astro build all clean.

### 23e. Live-tenant test round 2 — findings + two more fixes

Re-ran the full headed driver against the tenant. What the run proved:

- **Edit / view-mode prefill works against a real item** (item 264):
  every text field, both datetimes (stored UTC, correctly trimmed to
  `datetime-local` format), all four multi-Choice dropdowns, `HostRole`,
  `Attire`, and person **chips** all repopulated. Multi-person
  (`Photographer(s)`) came back as the full `{LookupId, LookupValue,
  Email}` object and its chip shows the name; a **single**-person column
  (`Host`) came back as just `"14"` from Graph, so that chip's label reads
  "14" — value still correct, re-saves fine, only the label is cosmetic.
- **Person + multi-Choice encoding on create** all correct
  (`HostLookupId: 14`, `…LookupId` as `Collection(Edm.Int32)`, every
  `checkboxGroup` as `Collection(Edm.String)`).
- **Poster upload** `PUT 201` to
  `…/PHOTOS!/Event Posters/2026-2027/<templated name>.png`.
- **Page-switch validation** flags both visited-but-incomplete tabs.
- The run also **confirmed the deployed SharePoint config is the
  pre-fix version** — a create with a poster `POST 500`s (still binds the
  `Poster` image column), the Purchase row write `400`s
  (`EventProposalLookupId` — old `parentReferenceColumn`), and
  `decisionRecorded` fires on a plain submit (no `when` guard). All three
  are fixed in the local config; they need the corrected files uploaded to
  `Site Assets/skye_data/forms/luddy-llc-event-proposal/`.

**Fix — first-time popup sign-in was losing the URL.** `page-scripts/auth.ts`'s
popup branch was constructing its own `PublicClientApplication` and calling
`handleRedirectPromise()`. On a same-origin popup the **opener's** MSAL
instance reads the `#code=…` fragment straight off the popup; running MSAL
*in* the popup raced it and, when the popup won, stripped the fragment
before the opener could read it. `loginPopup` then timed out and fell back
to a full-page redirect — which, if `completeRedirectReturn()` couldn't
recover the start URL, dumped the user on the bare origin with
`siteId`/`applicationId`/the form id all gone, and the main tab never
finished authenticating. Now the popup branch does **nothing** to the URL
(just a self-close fallback), matching MSAL's "blank redirect page"
guidance. Belt-and-braces: `authProvider.ts` now `rememberRedirectReturn()`s
*before* the popup attempt (not only before the redirect fallback), clears
it on popup success (`forgetRedirectReturn`), and `auth.ts`'s non-popup
branch falls back to that stashed URL instead of `/` when there's no
fragment to process. New `getRedirectReturn` / `forgetRedirectReturn`
helpers; 2 new tests.

**Fix — a lookupTable's `select` columns rendered as empty dropdowns.**
`populateChoiceOptionsFromColumns` only ever saw the *primary* list's
columns, so a table column bound to a Choice column on the **related**
list (the Purchase Table's `Store`) got no options. `page-scripts/form.ts` now
fetches each distinct related list's column schema (in parallel, skipped
when every such column already has static `options`) and fills them —
so `Store` populates live from the Purchases list's own choices
(`In-Person: Kroger` … `Software/Digital`) regardless of what the config
says. The config also gets those choices as static `options` as a
fallback.

**508 tests green** (83 `@skye/form-config` + 425 `@skye/app`), type-check + `lint:configs` + build clean.

## 24. Parameterized custom validators (new pass, 2026-09)

Prompted by a real need on the Luddy event-proposal form: `End Time` must
be after `Start Time`. Native constraints only cover `min`/`max` against a
**fixed** number and `matchesField`'s equality check — nothing declarative
could express "greater than another field," so this needed a
customValidator. But `customValidators` was previously just `string[]` (bare
names, no parameters), which would have forced a bespoke, one-off validator
per form for something genuinely general. Generalized it instead:

- **`CustomValidatorRef` (new, `@skye/form-config`'s `schema/types.ts`)** —
  each `customValidators` entry is now `string | { name: string; args?:
  Record<string, unknown> }`. `form.config.schema.json`'s `customValidators`
  items became a two-branch `oneOf` (string / `{name, args}` object); the
  overlay schema needed no change, since it already just `$ref`s the base
  schema's `field` def. `CustomValidatorFn` (in
  `validation/customValidatorRegistry.ts`) gained an optional third `args`
  parameter; `runCustomValidators` (`validation/nativeValidators.ts`)
  normalizes a bare-name entry to `{name}` before calling the registered
  function, so an existing parameterless validator needs no changes.
- **Three general-purpose validators registered in
  `packages/app/src/features/form/customValidatorRegistry.ts`** (previously
  empty — the first real entries):
  - `compareField` — `{ field, operator, message? }`, operator drawn from
    the same vocabulary `condition.operator` already uses. Compares plain
    numbers numerically and date/datetime-local strings chronologically;
    skips the check (rather than failing) while either side is still
    empty. This is what the Luddy `endTime` field now uses against
    `startTime`.
  - `dateNotInPast` — `{ allowToday?, message? }`. Compares the value's
    calendar-day prefix (`"YYYY-MM-DD"`) directly against today's local
    date-key string rather than re-parsing through `Date`, specifically to
    avoid a UTC/local timezone bug: `new Date("2026-09-22")` is UTC
    midnight, which can register as "yesterday" in a negative-UTC-offset
    timezone if compared against a `Date` built from local `now`
    components — confirmed as a real trap while writing this, not just a
    theoretical one, given most of this app's users are in US timezones.
  - `atLeastOneOf` — `{ fields: string[], message? }`. N-ary "at least one
    of these fields must be filled" — attach to one field in the group
    (commonly the last).
- **`/builder`'s field editor**: `customValidators` no longer fits the
  plain `stringArray` control (comma-separated text) now that an entry can
  be an object — `schemaIntrospection.ts`'s `classifySchemaProperty` falls
  it through to the existing `"unknown"` shape (same raw-JSON textarea
  `visibleIf`/`condition` already uses) with no code change needed there.
  `fieldEditor.ts` adds one `customValidators`-specific override purely for
  a better placeholder/help text pointing at the new docs file — same
  narrow-override pattern already used for `bindTo`/`page`.
  `schemaControls.ts`'s `coerceUnknown`/`stringifyUnknown` were exported (were
  file-private) so that override could reuse the identical JSON coercion.
- **New reference doc**: `docs/custom-validators-authoring.md` — native
  vs. custom, the `{name, args}` syntax, each registered validator's args
  and a worked example, and the recipe for adding a new one. Follows the
  same "living author-facing reference" role `custom-views-authoring.md`
  already plays for that feature.
- **Wired**: `skye_data/forms/luddy-llc-event-proposal/form.config.json`'s
  `endTime` field now carries `customValidators: [{ name: "compareField",
  args: { field: "startTime", operator: "greaterThan", message: "End time
  must be after start time." } }]`.

## 25. File field: drag-and-drop + a small preview (new pass, 2026-09)

Prompted by a UI reference (a dashed drop zone with a title/subtitle,
"Choose File" button, and a small file preview) — the `file` controlType
was previously a bare `<input type="file">`, CSS-styled to look like a
drop zone but with no actual drag-and-drop wiring and no preview once a
file was picked (just the browser's own filename text next to its native
button).

- **New `render/fileUploadZone.ts`**, layered entirely on top of the real
  `<input type="file">` rather than replacing it — `renderForm.ts`'s
  existing file-read line (`(rendered.control as
  HTMLInputElement).files?.[0]`, unchanged) stays the single source of
  truth for what gets submitted. `wireFileDropZone(wrapper, input,
  previewEl, document)`:
  - tracks `dragenter`/`dragleave` with a depth counter (not a 1:1
    toggle, since `dragleave` also fires when the pointer crosses onto a
    child element) to drive a `.skye-file-upload--dragover` highlight
    class;
  - on `drop`, assigns the dropped `FileList` straight onto the input
    (`input.files = event.dataTransfer.files` — the standard, MDN-
    documented cross-browser way to hand a drop to a file input) inside a
    `try/catch`, then dispatches a synthetic `change` so both this
    module's own preview AND renderForm's existing read both pick it up
    automatically, with no coordination code needed;
  - on `change` (native pick OR the synthetic post-drop one), calls
    `renderFilePreview`: a thumbnail (`URL.createObjectURL`, revoking the
    previous one on swap to avoid leaking blob URLs) for an image file,
    a generic icon otherwise, plus filename/size (`formatFileSize`) and a
    "×" remove button that clears the input and re-dispatches `change`.
- **`renderField.ts`**: for `controlType: "file"` only, the control is now
  wrapped in a `.skye-file-upload` div alongside a `.skye-file-upload__preview`
  slot, instead of being appended to the field container directly — every
  other control type's rendering is unchanged. `fieldRegistry.ts` and
  `renderForm.ts` needed NO changes at all.
- **A genuine, environment-only test gap, flagged rather than hidden**:
  jsdom has no `DataTransfer`/`FileList` implementation at all (confirmed
  directly, same category as the pre-existing `ElementInternals` gap
  documented in `registerElements.ts`), so a synthetic `drop` event in a
  test can exercise the dragover-highlight state machine and the
  graceful-failure `try/catch`, but not the real `input.files =
  event.dataTransfer.files` assignment line itself — that line is
  standard, documented browser behavior, just not something jsdom can
  simulate. The native-pick path (`Object.defineProperty(input, "files",
  ...)` + dispatch `change`, the same trick already used in this
  repo's other file-related tests) IS fully covered, including the
  preview and remove-button round trip.
- New tests: `fileUploadZone.test.ts` (11) + `renderField.test.ts` (3, the
  first test file for `renderField` at all). **533 tests green** (85
  `@skye/form-config` + 448 `@skye/app` — plus the 2 pre-existing,
  unrelated `registerElements.test.ts` lookup-table failures noted at the
  end of §24, still present and still out of scope here), type-check
  clean.

## 26. Poster upload: writing the file reference back — hit a real Graph limitation

The `poster` field on the Luddy event-proposal form uploaded the file to
the document library correctly, but wrote nothing back to the "Poster"
list column itself — the field's own README (written after an earlier
live-tenant test) explained why: `source: "virtual"` was a deliberate
workaround from a previous session, after a plain URL-string write to
that column 500'd.

**First attempt (reverted, see below):** researched the two real Microsoft
Graph payload shapes a structured "Poster" column could need — a plain
`{ Url, Description }` object for a classic Hyperlink/Picture column
(`hyperlinkOrPicture`, per a Dec 2025 Microsoft Q&A claiming this works
via Graph's `/fields` endpoint with a `Prefer: apiversion=2.1` header:
[source](https://learn.microsoft.com/en-us/answers/questions/1382210/how-to-make-post-patch-request-to-add-hyperlink-pi)),
or a `{ type: "thumbnail", fileName, fieldName, serverUrl,
serverRelativeUrl }` JSON object for the newer "Image" column type
(`thumbnail` — confirmed as a real, distinct Graph column facet in
[Microsoft's own columnDefinition docs](https://learn.microsoft.com/en-us/graph/api/resources/columndefinition?view=graph-rest-1.0),
shape reconstructed from [reshmeeauckloo.com](https://reshmeeauckloo.com/posts/update-image-column-powerautomate/)
and [Ganesh Sanap's writeup](https://ganeshsanapblogs.wordpress.com/2022/10/20/update-image-in-sharepoint-microsoft-lists-image-columns-using-power-automate/),
both describing the older SharePoint REST API rather than Graph
specifically — flagged at the time as unconfirmed against Graph). Built a
column-type-detecting encoder (`encodeFileFieldValue`) so the write would
be correct regardless of which type the live column turned out to be,
bound `poster` to `source: "sharepoint"`, `bindTo: "Poster"`, and asked
the user to test it live.

**Live result: `GraphError: General exception while processing` on the
primary item write** — the exact same opaque failure the original README
already documented for a plain-string write, now also hit by the
structured JSON attempt. Further research surfaced a second, directly
relevant Microsoft Q&A —
[C# Graph API: "generalException" when updating SharePoint Hyperlink (URL) field](https://learn.microsoft.com/en-us/answers/questions/2282050/c-graph-beta-api-generalexception-when-updating-sh) —
concluding this is a **known Graph limitation, not a shape problem**:
Graph's `/fields` endpoint does not support writing Hyperlink/Picture or
Image column types at all, in any tested API version; only the older
SharePoint REST API (a different token audience SKYE doesn't use) can.
That single stray data point (an unverified "it works with the right
header" community answer) doesn't outweigh a real, reproduced live
failure plus a second, independent report of the identical symptom.

**Final fix, confirmed by the user's own live test: don't fight the
column type.** Reverted the structured-write attempt entirely —
`encodeFileFieldValue`, the `needsBetaApiVersion` /
`preferBetaApiVersion` header plumbing on `createListItem`/
`updateListItem`, the `serverRelativeUrl.ts` helper module, and the
`thumbnail` → `file` builder auto-mapping in `columnMapping.ts` were all
removed — none of it is safe to ship once the one payload shape actually
tested against a live tenant demonstrably fails. In its place:

- **`encodeSharePointFields.ts`** now detects a `file` controlType field
  bound to a `hyperlinkOrPicture` or `thumbnail` column and reports it as
  a left-unwritten field error (`unsupportedFileColumnError`) — same
  pattern already used for an unresolvable person: the submission still
  succeeds, that one field is just left unwritten, with a short,
  end-user-appropriate message ("Poster" couldn't be saved on this item
  (the file itself still uploaded) — ask whoever maintains this form to
  fix it") rather than a hard failure. The technical explanation and fix
  (bind to a plain Text/Note column instead) live in the code comment and
  the form's own README, not in the user-facing string.
- **`GraphListColumn.columnType` keeps `"thumbnail"`** (still real, useful
  metadata Graph reports) — needed so the encoder can detect and flag
  this case at all; `mapColumn` in `graphClient.ts` still recognizes the
  facet.
- **Luddy config repointed at a new plain-text column**: `poster` is
  `source: "sharepoint"`, `bindTo: "PosterUrl"` — a **new** Single line of
  text column the site owner adds to the Events list, rather than trying
  to convert the existing `Poster` Image column (SharePoint doesn't
  generally offer Image → text as a type change, so a new column is the
  reliable path). SKYE then writes the uploaded file's URL there as a
  plain string, the same write path every other field on this form
  already proves works. The old `Poster` Image column can stay or go —
  SKYE no longer touches it. A thumbnail preview in list views is still
  available as a *display* concern: SharePoint's own column formatting
  renders an `img` from the plain-text URL.
- **One footgun worth knowing**: an unknown `bindTo` (column not created
  yet, or a display name with spaces whose internal name is really
  `Poster_x0020_URL`) is NOT covered by the graceful "left unwritten"
  path above — that only covers the Image/Hyperlink types SKYE
  positively identifies. A `bindTo` naming a column that doesn't exist is
  sent to Graph as-is and fails the item write, same as any other bad
  `bindTo`. Both the form README and this entry say so explicitly; a
  possible future hardening is to skip + soft-report any `bindTo` absent
  from the live `getListColumns` schema (guarded on that schema having
  actually loaded, since it's optional in `submitForm`).
- Tests updated to match: `encodeSharePointFields.test.ts`'s file-field
  cases now assert the error-and-left-unwritten behavior for both column
  types (plus the pre-existing plain-Text-column passthrough still
  works), `submitForm.test.ts`'s poster case asserts the submission still
  succeeds with `fieldErrors.poster` set and no `Poster` in the written
  item. **537 tests green** (85 `@skye/form-config` + 452 `@skye/app`,
  plus the same 2 pre-existing unrelated `registerElements.test.ts`
  failures), type-check and `lint:configs` clean.

**Takeaway for future Graph-write work in this repo**: a single
community Q&A claiming a fix works is not enough evidence to ship against
a live tenant — this one turned out to conflict with another, equally
plausible-looking answer, and only a real live test resolved it. Worth
weighing "how many independent, mutually-agreeing sources" more heavily
than "how recent/specific one source is" before writing code against an
unconfirmed Graph behavior.

## 27. Two edit-mode prefill gaps: the poster preview, and a Person chip's "14"

Found live, after §26's fix, by opening a saved Luddy proposal in edit
mode: the Poster field showed no preview of the already-saved image, and
the single-value `Host` Person field's chip showed the raw id "14"
instead of a name.

**Poster preview — a real, structural gap, not a config issue.**
`renderForm.ts`'s edit-mode value seeding calls `writeControlValue`,
which has no branch for a `file` control's `valueAccessor: "none"` — it
silently no-ops, so an edit-mode file field never showed anything even
though `values[fieldKey]` was correctly seeded with the saved URL
internally (submission was never affected, only the visible preview).
There's also no way to fix this by writing onto the real `<input
type="file">` — browsers don't allow programmatically populating one
with a File the app never had bytes for anyway (only a URL). Fix:

- **`fileUploadZone.ts`'s `renderFilePreview`** now accepts `File |
  string | undefined` instead of just `File | undefined` — a string is
  treated as an already-saved value: shown as an `<img>` sourced directly
  from the URL (no `URL.createObjectURL`, nothing to revoke) if the
  filename extension looks like an image, a generic icon otherwise, with
  no file-size line (there's no `.size` to read from a URL).
- **`renderField.ts`**: `RenderedField` gained an optional
  `filePreviewEl` — the preview slot's own element, so a caller
  (`renderForm.ts`) can drive it directly rather than reverse-engineering
  it via a CSS-class DOM query.
- **`renderForm.ts`**: factored the per-field change listener's
  value-changed side effects (set value, recompute visibility/calculated
  fields, clear external errors, update validation display, notify
  `onChange` listeners) into one `commitFieldValue(fieldKey, value)`, so
  it can be reused outside that one listener. New
  `applyFilePreviewValue(fieldKey, entry, value)` renders (or hides) a
  file field's preview from a plain value instead of calling
  `writeControlValue` — wired into both the `initialValues` seeding loop
  and `setFieldValue`, so a draft-preview prefill or a post-action
  `setField` targeting a file field would also show correctly, not just
  the one path that was actually reported.
- **The preview's existing remove button now works for a seeded value
  too** — since `renderFilePreview` already ships one, leaving it
  non-functional for the "existing saved file" case would have been a
  worse regression than not having it. Clicking it sets the field to
  `""` (not `undefined` — `JSON.stringify` drops an `undefined`
  property entirely, so an actual save wouldn't have cleared the
  column) and hides the preview, running the same commit path a real
  edit does.
- 7 new tests across `fileUploadZone.test.ts` (string-source preview,
  non-image extension, remove wiring), `renderField.test.ts`
  (`filePreviewEl` presence), and `renderForm.test.ts` (seeded preview
  from `initialValues`, remove-clears-to-`""`, `setFieldValue` parity).
  One real bug caught by these tests before they were done, not after:
  the first version of the remove callback only called
  `commitFieldValue`, never re-rendering the preview itself, so the
  preview stayed visibly stuck after a "successful" remove — fixed by
  having the callback explicitly re-invoke `renderFilePreview` with
  `undefined` afterward.

**Person chip "14" — a genuine Graph API quirk, now confirmed via
independent sources (not guessed at, per §26's own lesson).** Multiple
Microsoft Q&A threads independently agree: a *single*-value Person/Group
column only returns its full `{LookupId, LookupValue}` object from
`$expand=fields` when that column's name is explicitly included in
`$select` — otherwise Graph falls back to just the bare `<col>LookupId`
scalar. A *multi*-value Person column doesn't have this problem (no
scalar-only shortcut exists for a collection), which is exactly why
`Cohosts`/`Photographer(s)` already worked and only the single-value
`Host` didn't. `page-scripts/form.ts`'s edit-mode `getListItem` call
passed no `select` at all (fetching "everything," which for this one
column type actually means "less").

- **New `mapSharePointFieldsToValues.ts` export,
  `selectColumnsForEditPrefill(fields)`** — every `source: "sharepoint"`
  field's `bindTo`, plus (for any `peoplePicker` field) its `<bindTo
  >LookupId` companion alongside it — both need to be present in
  `$select` for Graph to expand a single-value one; including it for
  multi-value columns too is harmless. `page-scripts/form.ts` now passes
  this as `getListItem`'s `select` argument instead of omitting it.
  `mapSharePointFieldsToValues` itself needed no change — its existing
  fallback (`itemFields[bindTo] ?? itemFields[\`${bindTo}LookupId\`]`)
  already handles a rich object once Graph actually sends one.
- 2 new tests in `mapSharePointFieldsToValues.test.ts`.

**462 tests green in `@skye/app`** (up from 452 — 10 new: across
`fileUploadZone.test.ts`/`renderField.test.ts`/`renderForm.test.ts` for
the poster preview, plus `mapSharePointFieldsToValues.test.ts` for the
Person-column fix), **547 total** with `@skye/form-config`'s 85, plus
the same 2 pre-existing unrelated `registerElements.test.ts` failures.
Type-check and `lint:configs` clean. **Both fixes are
logically sound and match independently-confirmed Graph documentation,
but — per this repo's own standing practice — genuinely unverified
against the live tenant until re-tested there**; the Luddy README notes
both as "fixed, pending live re-verification" rather than claiming more
certainty than actually exists.

**Immediate live-test result — a real, pre-existing bug the `select`
change exposed.** Opening the item now failed entirely
(`GraphError: Parsing OData Select and Expand failed`), not just the
Person-column cosmetic issue — a strictly worse regression, caught
immediately by testing rather than shipped further. Root cause:
`graphClient.ts`'s `getListItem` called `.expand()` **twice** —
unconditionally with `"fields"`, then again with `` `fields(select=...)` ``
when a `select` array was passed. The Graph JS SDK's request builder
doesn't merge two separate `.expand()` calls into one valid `$expand`
clause; the two accumulate into something Graph's OData parser rejects
outright. This bug predates this session — `getListItem`'s `select`
parameter already existed, it simply had no real caller passing a
non-empty array until `selectColumnsForEditPrefill` became the first one,
which is why it was never hit before. **`searchListItems` had the
identical two-call pattern** (`query.select`), fixed the same way even
though nothing in this repo currently drives it with a non-empty
`select` — no reason to leave a second copy of the same bug in place
once found. Fix: build the complete `$expand` string once
(`` select?.length ? `fields(select=${select.join(",")})` : "fields" ``)
and pass it to a single `.expand()` call in both methods.

No new test covers this specific fix — it's Graph SDK request-building
behavior, and `RealGraphClient` has no unit test coverage in this repo
at all (only `MockGraphClient`, which ignores `select` entirely and
so can't exercise this). Flagged as a real, known gap rather than
silently left uncovered: a future pass could stand up a fake
`@microsoft/microsoft-graph-client` `Client` (the real package is
already a dependency) to assert on the constructed request shape for
`RealGraphClient`'s methods, the same way `MockGraphClient` is already
tested for behavior. Re-test in the browser again — this was caught and
fixed in the same round-trip, not yet independently re-verified live.

**The double-`.expand()` fix above was real but NOT the actual cause of
this error — a second, genuinely separate bug was.** The user re-tested
with a private window, a `pnpm dev` restart, and a hard refresh (ruling
out every caching explanation) and got the byte-identical error. That
ruled out staleness, so the fix itself had to be re-examined — and
confirmed wrong by directly exercising the real
`@microsoft/microsoft-graph-client` package in a throwaway Node script
(`Client.init(...).api(path).expand(expand).buildFullUrl()`, no network
call needed) rather than continuing to reason about it from memory. The
built URL was `$expand=fields(select=PosterUrl,...)` — syntactically
"clean" (one `.expand()` call, no duplication) but missing a `$` before
`select`. **Nested OData system query options need their own `$` prefix**
(`fields($select=...)`, not `fields(select=...)`) — and this codebase
already had the correct form sitting right next to the broken one:
`doResolveSiteUserId` (`graphClient.ts`, the already-working
person-resolution path) uses `fields($select=${selectFields})`, while
`getListItem`/`searchListItems` used `fields(select=...)` — missing `$`,
an inconsistency that predates this session. Graph's parser reads
`fields` as one complete, valid term, then hits the unprefixed
`(select=...)` as a second, nonsensical trailing term it can't parse —
exactly matching the reported error text. Fixed both call sites to match
the working pattern; re-verified the corrected URL shape
(`$expand=fields($select=PosterUrl,Title,...,HostLookupId)`) against the
real SDK before reporting back, rather than asserting confidence from
code-reading alone a second time.

**Lesson, worth being explicit about rather than letting slide**: the
first fix was diagnosed from re-reading the SDK's source and reasoning
about what a double `.expand()` call *would* produce — plausible, and a
real bug, but never actually run against the real library. Confidence
should have been "this is A bug," not "this is THE bug," until verified
by executing the actual code path. Once the user's re-test forced that
distinction, the follow-up used the real package directly instead of
reasoning further from source-reading alone, and would have caught the
`$select` typo before ever reporting the first fix as verified, had it
been done the first time.

## 28. Poster image preview: CORS/401 on a raw SharePoint webUrl

With Host names and item loading both confirmed fixed live, the Poster
preview itself still failed:
`Access to image at 'https://indiana.sharepoint.com/.../Test Poster.png'
... has been blocked by CORS policy` plus a `401`. Expected, in
retrospect — `PosterUrl`'s saved value is a raw SharePoint site URL, and
`renderFilePreview` (§27) was setting it directly as an `<img src>`. That
needs the browser to already hold a SharePoint session cookie for
`indiana.sharepoint.com` (this app never establishes one — it only holds
a Graph API bearer token) and, separately, SharePoint doesn't send
`Access-Control-Allow-Origin` for a `localhost:4321` origin regardless.
Both are fundamental to hotlinking a SharePoint document URL cross-origin
— no amount of retrying fixes it; the image has to come through an
authenticated, CORS-enabled API instead.

**Fix, reusing an existing (if previously unverified) capability rather
than inventing a new one**: `RealGraphClient.getListItemImage(siteId,
listId, itemId, field)` already exists — reads a field's stored
reference, resolves it to a server-relative path, finds which of the
site's document libraries contains it, and downloads the raw bytes + real
`file.mimeType` via Graph (which the browser already has a valid bearer
token for, no SharePoint session cookie or cross-origin exposure
involved). `page-scripts/form.ts`'s edit-mode load now calls this for
every `file` field whose saved value looks like an image URL (checked via
`fileUploadZone.ts`'s `looksLikeImageUrl`, exported for this reuse), and
swaps `initialValues[fieldKey]` for a `URL.createObjectURL(new
Blob([bytes], {type: contentType}))` before `renderForm` ever sees it —
`renderFilePreview`/`renderForm.ts` needed **no changes at all**, since a
blob URL is exactly as valid an `<img src>` as any other string source.
Best-effort per field, inside its own `try/catch` — one broken image
doesn't blank a form whose other fields loaded fine, matching this app's
existing "load failure degrades gracefully" convention.

**Being honest about what's actually verified here**: `getListItemImage`
itself already carried a documented "⚠️ untested against a live tenant"
flag from an earlier pass (TODO/build-log, predating this session) — its
field-shape-to-drive-item resolution was written but never independently
confirmed against a real SharePoint site. This is the first real call to
it in this app's history. It's a reasonable bet (the URL shape SKYE's own
uploads produce is exactly the shape its own drive-matching logic
expects), but it's exactly the kind of claim this session's own §26/§27
mistakes argue against asserting with more confidence than earned —
report this one back once actually seen working, not assumed from code
reading.

One small, unrelated type fix needed along the way: `new Blob([bytes],
...)` didn't typecheck (`Uint8Array<ArrayBufferLike>` vs. `BlobPart`'s
narrower `ArrayBufferView<ArrayBuffer>` under this TS/DOM-lib version) —
a real TS type-strictness gap, not a runtime one (every browser accepts a
plain `Uint8Array` in `new Blob([...])`); resolved with a narrow `as
BlobPart` cast, documented inline as such rather than silently swept
past.

3 new tests for `looksLikeImageUrl` (now exported).  **550 tests green**
(85 `@skye/form-config` + 465 `@skye/app`, same 2 pre-existing unrelated
failures), type-check and `lint:configs` clean. `page-scripts/form.ts`
itself has no unit test coverage (consistent with every other page-script
entry point in this repo — tested only through what it composes), so this
one is verified by type-checking + the exercised pieces' own tests, not a
dedicated test of the new loop itself.

**Immediate live-test result — §28's own fix had a real bug, caught
before it shipped further.** The CORS/401 error was gone (confirming
`getListItemImage` itself genuinely works live — the one real unknown
from §28), but the preview showed a generic file icon labeled with a raw
GUID instead of the poster image. Cause: §28's `page-scripts/form.ts`
**overwrote `initialValues[fieldKey]`** with the fetched blob URL before
handing it to `renderForm`. A blob URL (`blob:http://localhost/<uuid>`)
has no filename or extension of its own — so `renderFilePreview`,
re-deriving "is this an image" and "what's its name" from that string
the normal way, correctly found neither (the GUID in the screenshot
*was* the blob URL's own opaque id, misread as a filename). The fix
needed to **decouple the tracked field value from what the preview
displays**, not just get the fetch right:

- `RenderFormOptions` gained `filePreviews?: Record<string, { url:
  string; name: string }>` — a `controlType: "file"` field's preview
  override, entirely separate from `initialValues[key]`, which now stays
  the REAL saved URL untouched. This matters beyond just the display bug:
  had `initialValues[fieldKey]` kept getting overwritten with a blob URL,
  an unmodified edit-mode save would have re-sent that worthless local
  blob: URL to SharePoint instead of the real one, permanently
  corrupting the column on the very first untouched save.
- `fileUploadZone.ts`'s `renderFilePreview` gained an optional 5th
  `overrides?: { name?: string; isImage?: boolean }` param — when given,
  used instead of deriving either from `source`. `fileNameFromUrl` was
  also exported (previously private) so `page-scripts/form.ts` can
  capture the ORIGINAL filename from the real SharePoint URL *before*
  replacing it with the blob URL, then pass it through explicitly.
- `page-scripts/form.ts` now populates `filePreviews[fieldKey] = { url:
  <blob url>, name: fileNameFromUrl(<original url>) }` instead of
  mutating `initialValues`; `renderForm.ts`'s `applyFilePreviewValue`
  passes `isImage: true` unconditionally for a `previewOverride` (correct
  by construction — `form.ts` only ever populates one after
  `looksLikeImageUrl` already gated the fetch).
- 3 new tests: `renderForm.test.ts` (a `filePreviews` override drives the
  shown preview while `getValues()` still returns the original URL, not
  the blob one — the exact regression this closes), `fileUploadZone.test.ts`
  ×2 (the override is honored; a blob URL *without* one falls back to
  the generic icon, demonstrating the bug the override exists to fix).
  **553 tests green** (85 `@skye/form-config` + 468 `@skye/app`, same 2
  pre-existing unrelated failures), type-check and `lint:configs` clean.
  Not yet re-verified live — waiting on confirmation the poster image
  itself now actually renders.

## 29. Purchase table: rows never restored on view; suspect write is the Hyperlink-column bug again

Reported: `purchaseTable` (a `lookupTable` backed by the Purchases
related list) lets rows be added in the UI, but submit doesn't persist
them to that list, and reopening a saved item shows an empty table
regardless.

**Restoring rows on view — confirmed as a genuine gap, not a
regression**: grepped the whole `features/form`/`page-scripts` tree for
anything that reads a lookupTable's rows back from its related list —
nothing existed. `mapSharePointFieldsToValues` only ever reads
`item.fields` (the PRIMARY item), and `purchaseTable` being `source:
"virtual"` was explicitly skipped by it regardless. Fixed:
`page-scripts/form.ts`'s edit/view-mode load now queries the related
list directly for every `parentReference`-mode lookupTable field —
`fields/{parentReferenceColumn}LookupId eq {itemId}`, `$select`ed to
just the table's own bound columns (reusing `selectColumnsForEditPrefill`,
already generic over any `Record<string, FieldConfig>`) — and maps each
match through `mapSharePointFieldsToValues(table.columns, item.fields)`
into the exact `LookupTableRow[]` shape `writeLookupTableRows` (the
existing writer) already expects back. `lookupColumn` linkMode is
explicitly out of scope here (that relationship lives on the PRIMARY
item's own lookup column, already covered by the existing read), matching
`writeLookupTableRows`'s own `if (table.linkMode !== "parentReference")
return;` scoping. Best-effort, logged and skipped on failure — one
field's rows failing to load starts that table empty rather than
blanking the whole form. The one part of this genuinely new (a
`fields/{col}LookupId eq {number}` filter, not just `fields/{col} eq
'{string}'`) — the general `fields/X eq Y` shape already has a live
precedent (`doResolveSiteUserId`'s person-resolution filter, confirmed
working), but the LookupId-numeric variant specifically doesn't yet.
Flagged, not asserted as confirmed.

**Not yet fixed — the write side, deliberately not guessed at a third
time.** `writeLookupTableRows` sends every column through
`mapValuesToSharePointFields`, which has zero column-type awareness (a
much simpler mapper than `encodeSharePointFields.ts` uses for the primary
item) — every value goes through as a plain string, unconditionally. This
form's own README documents `linkToItem` (`bindTo: LinktoItem`) as a
genuine Hyperlink column. §26–§28 this session already proved, live, that
Graph rejects a plain-string write to that column type — same
`generalException`/`invalidRequest` family of error. If that's what's
happening here too, it would explain a *silent* failure exactly as
reported: `submitForm.ts`'s lookupTable-write loop already catches and
only `console.error`s, by design (a row-write failure doesn't unwind the
already-successful primary item write) — so nothing would reach the UI.
Asked the user for that console output before implementing a fix, rather
than repeating §26/§27's mistake of shipping a plausible-but-unconfirmed
Graph write shape a third time in one session.

**Confirmed, then fixed — genuinely different from the Poster case this
time.** The actual request/response: `{"Title": "...", "Store": "...",
"LinktoItem": "https://www.kroger.com/...", ..., "...LookupId": 292}` →
`500 generalException`, same family as Poster's. The key difference:
Poster's real column type was never actually confirmed (`hyperlinkOrPicture`
vs. `thumbnail` — the user moved it to Text before that got isolated),
but `LinktoItem` **is** confirmed as a genuine Hyperlink column (this
form's own README, written from an earlier live-tenant column dump) —
meaning this is the first real, targeted test of the `{ Url, Description
}` + `Prefer: apiversion=2.1` shape a Dec 2025 Microsoft Q&A documented
for that exact column type (§26 first researched this, then it went
unused once Poster turned out not to need it). Asked the user whether to
implement that shape properly or just move `LinktoItem` to Text like
Poster — they chose to implement it.

- **`writeLookupTableRows` is now column-type-aware**, matching the
  pattern `encodeSharePointFields.ts` already uses for the primary item
  (rather than guessing from the config's `controlType: "url"` alone,
  which isn't exclusively bound to Hyperlink columns any more than `file`
  was exclusively bound to Image columns). New
  `encodeLookupTableRowFields(columns, values, relatedColumnsByName)`:
  runs the existing `mapValuesToSharePointFields` first, then overrides
  any field whose bound column is `hyperlinkOrPicture` with `{ Url:
  value, Description: value }` (no separate "link text" concept exists in
  this schema's `url` controlType, so `Description` reuses the same
  value) and reports whether it did, so the caller knows to request the
  header.
- `writeLookupTableRows` fetches the related list's columns **once per
  write pass** (not per row) via `getListColumns` — skipped entirely when
  a batch is deletions-only, and **best-effort**: a failure there falls
  back to an empty column map (no hyperlinkOrPicture encoding, same as
  before this fix existed) rather than aborting every row write in the
  batch, logged via `console.warn`.
- **`preferBetaApiVersion` is back** on `createListItem`/`updateListItem`
  (`GraphClient` interface + both implementations) — fully reverted after
  Poster turned out not to need it, now genuinely needed for a
  Hyperlink-typed lookupTable column. Passed only on the specific row
  write that actually encoded one, not blanket.
- 3 new tests in `lookupTableRows.test.ts` (the encoding + header on both
  create and update, a column-fetch failure degrading gracefully instead
  of crashing the whole batch) using a lightweight stub `GraphClient`
  rather than the fixture-driven `MockGraphClient` (whose
  `getListColumns` throws for any list id outside its fixed fixture set —
  confirmed by running the existing 5 tests first, which would otherwise
  have broken the moment `writeLookupTableRows` started calling it
  unconditionally). **556 tests green** (85 `@skye/form-config` + 471
  `@skye/app`, same 2 pre-existing unrelated failures), type-check and
  `lint:configs` clean. Not yet re-verified live — this is the real test
  of whether the Dec 2025 Q&A's shape genuinely works for a confirmed
  Hyperlink column, which §26–§28 never actually got to run.

## 30. GitHub Pages deployment

`@skye/app` is pure static output (`output: "static"`), so it hosts
directly on GitHub Pages with no server. Deploying to a **custom domain**
(`skye.reecen.dev`, served at the root) rather than a `<user>.github.io/SKYE/`
project-page subpath was a deliberate choice — several places
(`redirectUri.ts`'s `authRedirectUri()`, `auth.ts`'s `location.replace("/")`
fallback, the switcher's nav links) build root-absolute paths with no
`base`-path awareness; a subpath deployment would need all of those
patched, a root-served custom domain needs none of it.

- `astro.config.mjs` gained `site: "https://skye.reecen.dev"`. No `base`.
- `packages/app/public/CNAME` (containing `skye.reecen.dev`) — Astro copies
  `public/` verbatim into `dist/`, which is how GitHub Pages learns the
  custom domain from an Actions-based deploy.
- `.github/workflows/deploy.yml` — installs via pnpm, `pnpm build`s both
  workspace packages through Turborepo, uploads `packages/app/dist` via
  `actions/upload-pages-artifact` + `actions/deploy-pages`. `PUBLIC_DEFAULT_APPLICATION_ID`
  / `PUBLIC_DEFAULT_TENANT_ID` / `PUBLIC_AUTH_ALLOW_COMMON` are read from
  repo-level Actions **Variables** (build-time-inlined GUIDs, not secrets).
  One-time manual steps the workflow can't do itself, documented in its
  own header comment: Settings → Pages → Source: GitHub Actions; Settings
  → Pages → Custom domain + the registrar's CNAME DNS record; the Actions
  Variables above; and registering `https://skye.reecen.dev/auth` as a
  **Single-page application** redirect URI on the Entra app registration.
- Bumped `astro` `7.3.1` → `7.3.4` (still inside its existing `^7.3.1`
  range) while diagnosing the item below — confirmed harmless
  (typecheck + full suite still green).

**A local-machine-only build failure, diagnosed, not a SKYE bug.** `pnpm
build` failed here with `Named export 'parseCookie' not found... 'cookie'
is a CommonJS module`, thrown from deep inside Astro's own prerender step
(nothing SKYE-authored touches `cookie` directly). Reproduced on a full
`rm -rf node_modules && pnpm install --frozen-lockfile`, so it wasn't
local `node_modules` corruption from other tools/sessions having poked
around this checkout. Root-caused with `require.resolve('cookie', {paths:
[...]})` run from the exact failing directory
(`packages/app/dist/.prerender/`): it resolved to
**`/Users/reeceneedham/node_modules/cookie` — a stray, CommonJS,
`cookie@0.7.2` sitting directly in the user's home directory** (alongside
a large pile of other unrelated packages, `@astrojs`/`@azure`/`@fluentui`/…,
that looks like a long-past `npm install` accidentally run with the home
directory as `cwd`). Node's ESM resolver walks every ancestor directory
looking for a `node_modules` folder; since neither `packages/app/node_modules`
nor the repo root's has `cookie` (correctly — it's a transitive dep of
`astro`, not a direct dep of anything in this repo), the walk continued
all the way up past the repo and picked up that old global copy instead,
which is genuinely CJS and doesn't export `parseCookie`/`stringifySetCookie`
by those names. **This will not affect the GitHub Actions build** — a
fresh runner's `$HOME` has no such directory in the project's ancestor
chain — so the deploy workflow above is unaffected. Left `~/node_modules`
alone rather than deleting it unasked (it's outside the repo and might be
intentional), but flagged it to the user: it can just as easily shadow a
dependency for any *other* Node project run from this machine, not only
this repo.

## 31. Purchase table submit + restore — confirmed working end-to-end, live

§29's two suspects (the Hyperlink-column write, and the never-tested
`parentReferenceColumn` write) both turned out real, plus one more the
first two fixes exposed. Diagnosed and confirmed against the actual live
tenant this time — not just reasoned about — using a headed Chrome
launched via Playwright (already a dev dependency in this repo for the
Custom Views browser gate), driven directly through `chromium.connectOverCDP`
across several follow-up scripts so the session could stay open while the
user signed in and fixed unrelated validation blocks in between. Three
real bugs, found and fixed in sequence as each one's fix exposed the
next:

1. **`LinktoItem` (the Hyperlink column) rejected a plain string** —
   confirmed exactly per §29's suspicion. Fixed in §29 already
   (`encodeLookupTableRowFields`), but the fix's *trigger* needed
   correcting once live: it originally gated on `getListColumns` reporting
   `columnType: "hyperlinkOrPicture"` — live testing showed Graph's
   `/columns` endpoint (collection **and** a single-column GET, by id or
   by name) can omit that facet entirely for a real Hyperlink column, with
   no way to ask for it differently (matches a footnote in Microsoft's own
   columnDefinition docs: the type facets can be absent from this API for
   some columns). Switched the primary trigger to `field.controlType ===
   "url"` — the config's own declared intent, the same convention
   `columnMapping.ts` already uses the other direction — keeping the
   Graph-metadata check only as a secondary trigger for a column/tenant
   where it does report correctly.
2. **The parent-reference Lookup column (`k62e361189_d041078067_rluLookupId`,
   the "Master Item" link back to the Events list) rejected a JSON
   number**, failing with `"Field '...' of type 'Lookup' was not
   converted properly"` — a **different** column type from Person/Group
   (which this app's `HostLookupId`/`CohostsLookupId` already prove
   *does* want a number) despite sharing the same `<Column>LookupId`
   shadow-property naming convention. This write was genuinely never
   tested before (the form's own README already flagged it as such).
   Confirmed via two independent, consistent sources (a Microsoft Q&A and
   a third-party walkthrough) that a single-value Lookup field's LookupId
   goes in as a **string**, no `@odata.type` needed (that's only for the
   multi-value `Collection(Edm.Int32)` case) — `lookupTableRows.ts` now
   sends `parentItemId` as-is (already a string) instead of
   `Number(parentItemId)`.
3. **Once the row finally wrote successfully, reading it back showed
   `[object Object]` in the "Link to Item" cell.** `mapSharePointFieldsToValues`
   (the read-side inverse of the write) didn't know a `url` field's raw
   value could now legitimately be Fix #1's `{ Url, Description }` object
   instead of a plain string, so it passed the object straight through to
   a plain text `<input>`. Added the matching unwrap: a `url` field whose
   raw value is an object with a `Url` property extracts just that string;
   a `url` field bound to an ordinary Text column (a plain string) passes
   through unchanged, same as before.

**Verified live, the full loop, not just individually**: added a row in
the browser → Submit → `POST 201` to the Purchases list (not a 500) →
reloaded the item → the same row came back with all five columns intact,
including a real clickable-looking URL in "Link to Item" instead of
`[object Object]`. This is the first genuinely end-to-end confirmation
this session's Purchases-table work has had, closing out §19/§29's
"not yet write-tested" flag from the form's own README.

- 5 new tests: `lookupTableRows.test.ts` gained one covering the
  string-not-number LookupId shape (updating the 5 pre-existing
  assertions that had asserted a number) plus one confirming the
  controlType-based trigger fires even when `getListColumns` reports no
  useful facet at all (mirroring the exact live response captured);
  `mapSharePointFieldsToValues.test.ts` gained the object-unwrap case and
  its plain-string-passthrough counterpart. **559 tests green** (85
  `@skye/form-config` + 474 `@skye/app`), same 2 pre-existing unrelated
  `registerElements.test.ts` failures, type-check clean.
- One recurring interruption during live testing, worth noting but NOT a
  bug and not touched: the "person not a site member" validation on
  Host/Cohosts re-checks on every submit attempt (not just once), so it
  kept reappearing between test rounds even after being fixed in the
  browser. Confirmed as genuine, existing, intentional behavior — worked
  around each time by asking the user to re-enter valid people, no code
  changed for it.

## 32. Post-submit confirmation splash + a `<select>` "Select an option" placeholder

Two small, explicit follow-up requests.

- **A successful submit now replaces the whole form**, rather than just
  updating the inline status line beneath it. `pages/form.astro` gained a
  new sibling state, `#screen-submitted` (`data-slot="submitted-message"`
  + a `<menu>` of two `data-el`'d links, `fill-another-link` /
  `view-response-link`), following this repo's "every state ships as a
  sibling `<section data-state>`, the entry script only toggles/fills it"
  convention (see CLAUDE.md). `page-scripts/form.ts`'s submit handler
  still runs its existing conflict/failure/warning/success branching
  exactly as before (deciding `statusEl`'s message + level is unchanged
  logic) — the only new step is that once that branching lands on a
  genuine success (an item was actually written; conflict/failure never
  reach this), a new `showSubmittedSplash(message, level, itemId)` calls
  `showState(appRoot, "screen-submitted")` and fills the two links via
  `buildFormUrl`/`buildDraftPreviewUrl` (`shared/routing.ts`, both
  pre-existing). The splash doesn't invent its own wording — it reuses
  whatever the normal status logic already decided, including a
  postAction's own `showMessage` text, just gives it a form-replacing
  home instead of a status line easy to miss.
  - "Fill out another response" re-enters a **draft preview**
    (`buildDraftPreviewUrl`) when this submission was one (`route.draftId`
    set), so testing a draft loops back into testing the same draft
    rather than silently dropping into the live form; otherwise it's a
    plain create-mode `buildFormUrl`.
  - "View submitted response" always targets the real saved item via the
    live config (`buildFormUrl(..., "view", result.item.id)`) — the item
    itself was genuinely written either way (a draft only changes which
    config validated/rendered the submission, not where it's saved), so
    viewing it through the live form is the accurate read-back.
  - A small TS narrowing note for future reference: `route`'s
    "unresolved" early-return earlier in `main()` narrows its type for
    the rest of that function, but that narrowing doesn't carry into a
    *nested function's* body (a known TS limitation — control-flow
    analysis resets at function boundaries even for an unreassigned
    `const`). Fixed by destructuring `route`'s fields into local consts
    at the narrowed call site, before defining the nested closure, rather
    than reading `route.*` inside it.
- **Every rendered `<select>` now ships a disabled "Select an option…"
  placeholder as its first `<option>`.** Previously a `<select>` with no
  `defaultValue` silently auto-selected its first real option the moment
  it rendered (plain browser behavior for a native `<select>` with no
  option marked `selected`) — a value the user never actually chose could
  submit as if they had. `fieldRegistry.ts`'s `select` control's
  `buildChildren` now prepends a `selectPlaceholderOption()` (disabled,
  pre-selected, empty value — so it fails native `required` validation
  until a real option is picked, the same contract a required `<input>`
  already has); an explicit `defaultValue` still wins, since
  `renderField.ts` sets `.value` directly afterward, deselecting the
  placeholder in favor of the matching real option.
  - The exact same bug existed a second place, confirmed independently
    during this session's earlier live purchase-table testing
    (screenshots showed the "Store" `<select>` in a lookupTable row
    pre-selecting "In-Person: Kroger" the instant a row was added, before
    any click): `registerElements.ts`'s `SkyeLookupTable` row renderer
    builds its own per-column `<select>` for a `controlType: "select"`
    table column, independently of `fieldRegistry.ts`. Same fix applied
    there — a placeholder `<option value="">` prepended before the
    column's real options, so a row's unset value (`input.value = ""`
    for a column with nothing in `row.values[colKey]` yet) actually
    matches an option instead of falling back to the first real one.
- `astroMarkupHooks.test.ts`'s `pages/form.astro` entry gained the four
  new hooks. 4 new tests cover the select-placeholder fix directly:
  `renderField.test.ts` gained a `select control` block (placeholder is
  index 0/disabled/pre-selected; an explicit `defaultValue` still wins;
  a required select fails native `checkValidity()` until a real option is
  picked), and `registerElements.test.ts` gained one for the
  `SkyeLookupTable` select-column case, asserting a fresh row's `<select>`
  reads back `""` rather than the first real option's value. The splash
  screen itself has no new unit test — `page-scripts/form.ts` is a DOM-
  wiring entry script with no existing test harness in this repo (every
  other page-script is verified live/manually, not via vitest, per this
  session's own established pattern); `astroMarkupHooks.test.ts`'s new
  assertions are the only automated coverage of it. Full suite: **480
  `@skye/app` tests, 478 passing** (85 `@skye/form-config` unchanged),
  same 2 pre-existing unrelated `registerElements.test.ts` failures
  (confirmed again via `git stash` that they reproduce identically
  without any of this session's changes — a `"Remove"` vs `"×"` button-
  text mismatch, not investigated further as it wasn't part of what was
  asked), type-check clean. Not yet verified live against the real
  tenant/browser — the DOM-level behavior (placeholder selection, splash
  markup swap, native validity) is covered above, but the actual click-
  through UX hasn't been manually confirmed in Chrome the way this
  session's earlier fixes were.

## 33. Hash-only navigation silently doing nothing + person search missing email matches

Two follow-ups, found via the user testing §32's new splash-screen links live.

- **A hash-only URL change (same pathname/query, different fragment)
  doesn't reload the page** — this is ordinary browser behavior (changing
  only the fragment identifier never triggers a navigation/reload), but
  `/form` and `/view` treat the hash as their entire route (formId/itemId/
  mode; which view). Concretely: this broke §32's own "Fill out another
  response"/"View submitted response" splash links whenever the target
  item was on the same site (the common case — same `siteId`/
  `applicationId`/`tenantId` query string, only the hash's itemId
  differs), a `redirect` postAction targeting another item on the same
  form, and — pre-existing, not something this session introduced — the
  Custom Views host-mediated view→view navigation CLAUDE.md already
  documents (`buildViewUrl`, same-site-only). Both `page-scripts/form.ts`
  and `page-scripts/view.ts` now register `window.addEventListener
  ("hashchange", () => window.location.reload())` at the very top of
  `main()`. A full reload (rather than trying to re-run `main()` in
  place) matches how this app already works everywhere else — "no
  client-side router between pages... genuinely separate script
  executions" (see this file's Draft/publish section) — so a hash-only
  change now behaves exactly like any other route change here, and
  avoids the real risk of double-wiring event listeners / stale DOM that
  re-invoking `main()` without a full teardown would risk. `builder.ts`
  was deliberately left alone — it already uses `history.replaceState`
  (which does not fire `hashchange`) to update its own prefill hash,
  suggesting its in-page, no-reload state model there is intentional.
- **Person-picker search only matched a display name, not an email** —
  `RealGraphClient.searchPeople`'s `$search` query only searched
  `displayName`. Broadened to `"displayName:x" OR "mail:x" OR
  "userPrincipalName:x"` (Graph's documented `$search`-on-`/users`
  syntax: each property gets its own quoted term, combined with `OR`) so
  pasting a full or partial email finds the same person a name search
  would. `MockGraphClient.searchPeople` got the equivalent fix (also
  matches `p.email`) for dev/mock parity. Not yet confirmed against the
  live tenant (unlike this session's earlier Graph findings, which were
  all live-verified) — `mail`/`userPrincipalName` are Microsoft's
  documented searchable properties for this endpoint, but this
  particular change hasn't had a live round-trip test yet.
- 1 new test (`mockGraphClient.test.ts`, email search); no new test for
  the hashchange fix (a `hashchange`-triggered `window.location.reload()`
  isn't meaningfully unit-testable in jsdom — `reload()` is a no-op stub
  there and there's no separate "did it reload" signal to assert on;
  this one is a live/manual-verification item). **482 `@skye/app` tests
  total, 480 passing** (85 `@skye/form-config` unchanged), same 2
  pre-existing unrelated `registerElements.test.ts` failures, type-check
  clean.

## 34. A Custom View for the Luddy LLC Events list, with an "Add to Calendar" button

`skye_data/views/luddy-llc-events/` — a read-only Custom View (see this
file's "Custom Views" section / `docs/custom-views-authoring.md`) over
the same Events list `skye_data/forms/luddy-llc-event-proposal` writes
to. Lists every submitted event, sorted by **start time, newest first**
(`skye.list(EVENTS_LIST, { orderBy: [{ field: "StartTime", direction:
"desc" }] })`), and gives each row an "Add to Calendar" button.

- **The button can't call `window.open()` directly** — a Custom View's
  iframe is `sandbox="allow-scripts"` only (no `allow-popups`, a
  non-negotiable invariant), so a raw popup call would just be blocked by
  the browser. The correct, mediated equivalent is `await
  skye.navigate({ url })`: `navigationPolicy.ts` checks the URL's origin
  against the site's `skye.config.json` → `navigation.
  allowedExternalOrigins` allowlist and, if it's on it, opens it in a new
  tab itself (`rel="noopener noreferrer"`, so the SKYE tab itself is never
  navigated away) — functionally identical to the `window.open(url,
  "_blank")` this was modeled on, just routed through the host instead of
  a capability the sandbox doesn't grant.
- **The compose URL is built with `URLSearchParams`**, not raw template-
  literal interpolation — an event title/description containing `&`,
  `=`, or other URL-special characters would otherwise corrupt the query
  string (or, worse, let a crafted list value smuggle in extra
  parameters). Same `path=/calendar/action/compose&rru=addevent&subject=
  …&startdt=…&enddt=…&body=…&location=…` shape already used by
  `src/integrations/outlook/buildCalendarEventDeepLink.ts` (that file's
  own caveat still applies: this is a commonly-observed Outlook Web URL
  pattern, not an officially documented/stable one).
- **Row rendering uses `createElement`/`textContent` throughout, no
  `innerHTML`** — unlike the existing `calendar` demo fixture view (which
  interpolates list values straight into `innerHTML` template strings).
  That demo view is test-only fixture content; this one will hold real
  IU event data, so it deliberately doesn't repeat that pattern even
  though the sandbox's blast radius from a script running inside it is
  already small (no cookies, no parent-DOM access, opaque origin).
- **Two `skye.config.json` additions are required before this view will
  work** — both documented in the view's own `README.md`, since they're a
  site-owner action outside this repo (no `skye_data/config/` for the
  real IU site is tracked in this checkout, same reasoning as forms):
  `views.allowedLists` must include the Events list's real id
  (`62e36118-9efa-43b8-a539-18f0d73fff34`, the same value the form
  itself already uses), and `navigation.allowedExternalOrigins` must
  include exactly `https://outlook.office.com`. Without the first, every
  `skye.list()` call throws `listNotAllowed`; without the second, every
  "Add to Calendar" click throws `navBlocked`.
- Not yet verified live or via this repo's `test:views:browser` gate —
  that gate only exercises the fixture views under
  `packages/app/src/shared/sharepoint/fixtures/views/`, not a real site's
  `skye_data/views/`, so there's no automated coverage for a view meant
  to be uploaded to a live tenant. `view.js`'s syntax was checked with
  `esbuild` (confirms the top-level-`await` shape parses as the runtime's
  `AsyncFunction`-wrapped execution model expects, matching the existing
  `calendar` demo view's own pattern) but the actual query/render/compose
  round-trip hasn't been click-tested against the live Events list.

## 35. Custom Views can now be authored as a single `view.html` file

Follow-up ask: "combine the views into one html file" for §34's Luddy LLC
Events view. Custom Views has always required three separate files
(`view.html`/`view.css`/`view.js`), and `<script>` tags inside `view.html`
were explicitly documented as inert — CLAUDE.md flags that split as a
"non-negotiable invariant," so this got a clarifying question before any
code changed rather than assuming it was safe to weaken. The user's own
follow-up (`shouldn't javascript always use the skye iframe messaging we
set up?`) turned out to name the actual reasoning correctly: the real
security boundary is the sandbox attributes + CSP + the fact that author
code only ever runs via one controlled `AsyncFunction` call — NOT the
mere fact of living in a separate file. A `<script>` inserted via
`innerHTML` is inert by a hard DOM guarantee regardless of which file it
came from, so extracting its already-dead text and feeding it into that
same `AsyncFunction` call adds no new way for author code to run — it's
the same one path, just two possible sources for its input.

- **`view-runtime.js`'s `mount()`** now does, in order: (1) `innerHTML =
  html` (a `<script>` here still can never execute — unchanged, this is
  the platform's own guarantee, not something this file enforces), (2)
  `document.body.querySelectorAll("script")` to collect and `.remove()`
  each one's already-inert `textContent`, (3) concatenates those with the
  separate `js` string (`;`-joined, to avoid an ASI hazard between two
  independently-written scripts), and only THEN runs the combined source
  through the same `new AsyncFunction(...)` call that previously only
  ever saw the separate `view.js` file's contents. A `<style>` needed no
  equivalent change — a `<style>` element inserted via `innerHTML`
  already applies on its own, unlike `<script>`.
- **`RealGraphClient.getSkyeViewFiles`** (`graphClient.ts`) now treats
  `view.js` as optional too, the same `.catch(() => "")` pattern
  `view.css` already had — previously `view.js` was fetched via the same
  `Promise.all` as the required `view.html`, so a genuinely single-file
  view (no `view.js` on disk at all) would have hard-failed to load
  before ever reaching the runtime change above.
- **New fixture + Playwright case**: `fixtures/views/single-file-demo/
  view.html` (no companion `.css`/`.js` at all) wired into
  `MockGraphClient`'s `MOCK_VIEWS`, plus a new `customViews.spec.ts` case
  that asserts its inline `<script>` actually ran (writes text into a
  `<p>` using `await skye.lists()`) — the one thing that's genuinely new
  here and worth a real regression test, since a `<script>` merely
  *existing* in the rendered DOM proves nothing (it's supposed to sit
  there inert; the test has to observe an effect only the runtime's new
  extraction step could have produced).
- **Couldn't actually run `pnpm test:views:browser` to confirm the new
  Playwright case passes** — found a pre-existing, unrelated build
  failure first: `pnpm exec astro build` (which the gate's `globalSetup`
  runs before serving) currently fails with `Named export 'parseCookie'
  not found` from Astro 7.3.x's own `default-build/default-prerenderer.js`
  against the installed `cookie@2.0.1` (an apparent Astro/cookie version
  incompatibility in this checkout's lockfile). Confirmed via `git stash`
  that this reproduces identically with none of this session's changes
  present — a real, standing toolchain issue, not something introduced
  here, and out of scope to chase down as part of this ask. Everything
  else was verified: full `pnpm typecheck` clean, full `pnpm test`
  unaffected (still only the same 2 pre-existing `registerElements.test.ts`
  failures), and the `mount()` logic was traced by hand against
  `view-runtime.js`'s existing, working message-handling flow. The new
  Playwright case itself is real regression coverage and should pass once
  the build issue is fixed — it just hasn't been run end-to-end yet.
- **`skye_data/views/luddy-llc-events/`** was then rewritten as the single
  file this was all for: `view.css`/`view.js` deleted, their contents
  folded into `view.html`'s own `<style>`/`<script>`, `view.json`
  untouched. Its `README.md` and `docs/custom-views-authoring.md` (a new
  "one file vs. three files" section, plus a single-file variant of the
  existing minimal example) were updated to match; CLAUDE.md's Custom
  Views invariants section gained a clarifying note that this doesn't
  weaken the "nothing author-written in the frame's srcdoc" rule.
- **Renamed locally to `skye_data/views/add-to-calendar/`** to match the
  folder name the user actually uploaded to SharePoint (they'd renamed it
  from `luddy-llc-events` there) — the view's own content doesn't
  hardcode its folder name anywhere, so this is a pure rename, no content
  change. Surfaced a real, if narrow, gap while diagnosing why it 404'd
  live: they'd visited `/form?...#add-to-calendar` (a `/form` URL) instead
  of `/view?...#add-to-calendar` — the two routes 404 differently
  (`/form#x` looks for `skye_data/forms/x/form.config.json`, which will
  never exist for a view id), so the error correctly named "form config
  not found" rather than anything view-related, but nothing in the app
  itself steered them toward the right route. Not fixed here (a plain
  wrong-URL mixup once explained, not a code bug — `looksLikeFormLink`'s
  root-page fallback redirect, the one place a bare link's route is
  actually guessed, has always assumed `/form` and was never taught about
  views; worth a look if this recurs, but out of scope for this pass).
- **A second, real bug surfaced once the list-allowlist and route were
  both fixed and the view actually queried the live Events list**:
  sorting by `StartTime` 400'd with `"Field 'StartTime' cannot be
  referenced in filter or orderby as it is not indexed"`. This is
  SharePoint's own guard against a potentially-slow query on a large list
  against a non-indexed column (most columns, by default) — it wants a
  `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly` header before
  it'll allow the query at all. `RealGraphClient.searchListItems`
  (`graphClient.ts`) now sends that header on every call, not just the
  one that failed — it's harmless when the header isn't needed (a plain
  `search`-only call, or a request that happens to hit an indexed
  column), and this same method backs both Custom Views' `skye:list`
  (any author-chosen `orderBy`/`where` is, by design, likely to land on
  an ordinary unindexed column) and the lookupTable parentReference row
  fetch (`page-scripts/form.ts`), which filters on a Lookup column that
  could hit the identical limit as a related list grows — fixing it once,
  centrally, covers both rather than patching the one call site that
  happened to fail first. No unit test added (`RealGraphClient` has no
  existing unit coverage at all — untestable without a live Graph client,
  same as every other live-tenant-only fix this session); confirmed via
  `pnpm typecheck` and the full `pnpm test` (still only the same 2
  pre-existing `registerElements.test.ts` failures) that nothing else
  regressed. The view's own `README.md` now calls this out under "Known
  limits" — SharePoint's underlying warning is real (a **very** large
  Events list could still see a slow or occasionally-failing sort), the
  header just trades "won't run at all" for "might occasionally be slow,"
  it doesn't make the tradeoff disappear.

## 36. Recovering a lost `applicationId`/`tenantId` from this browser's last-used cache

Explicit ask: if a URL loses its `applicationId`/`tenantId` query params
(goes blank), auto-fill the last-used ones back in. tenantId already had
half of this (`getCachedTenantId`, written after a confirmed successful
sign-in) — the missing piece was applicationId, which `/form`/`/view`
treat as load-bearing for whether a route resolves AT ALL, so losing it
was a hard dead-end (bounced to `/switcher` with nothing), not a soft
degradation the way a lost tenantId alone already was. This is exactly
the failure mode `pages/auth.astro`'s own docstring already named ("every
query param lost") for an MSAL redirect round-trip that can't recover the
pre-redirect URL and falls back to the bare origin.

- **`tenantResolver.ts` gained `getCachedApplicationId`/`cacheApplicationId`/
  `backfillApplicationIdInUrl`** — the exact same three-function shape its
  existing tenantId equivalents already had, same reasoning (an Azure app
  registration's client id isn't a secret either, so `localStorage` is
  fine) — plus one new combined entry point,
  `resolveApplicationAndTenantId(search, envDefaults?)`, that resolves
  both together: URL → that page's own env-default (passed in per-caller,
  not read inside this function — see below) → this browser's cache. A
  value recovered from the cache is backfilled into the address bar
  (no navigation); the env-default case never is, since it's already
  free without the URL needing to carry it.
- **The two ids are deliberately NOT cached the same way.** A
  URL-provided `applicationId` is cached directly, immediately, right
  here — safe, since it's not a secret and a wrong one fails no worse
  than a missing one already would. A URL-provided `tenantId` is
  deliberately left uncached by this function — only a tenant id a real,
  successful MSAL sign-in actually confirmed gets remembered
  (`rememberTenantFromResult`, unchanged, elsewhere), so a wrong or
  typo'd `?tenantId=` in some copied/malformed link can never quietly
  poison this browser's cache for a later, different, legitimate visit.
  This asymmetry is the one subtlety in this change worth remembering if
  it's touched again.
- **`envDefaults` is a parameter, not read inside the function** — because
  not every page used `PUBLIC_DEFAULT_APPLICATION_ID`/
  `PUBLIC_DEFAULT_TENANT_ID` before this existed. `/form`/`/view` never
  did (a bare `/form` link is meant to be fully self-contained); only
  `/switcher`/`/builder` did. `routing.ts`'s `parseCurrentRoute()`/
  `parseCurrentViewRoute()` call the resolver with NO env defaults
  (preserving that exact split — this pass only adds the cache layer, it
  doesn't newly let `/form`/`/view` work with zero identifying
  information at all) right before re-reading `window.location.search`
  for the actual parse, so a cache-backfilled URL is picked up
  transparently; `builder.ts`/`switcher.ts` now call the same resolver
  with their existing env defaults passed through, replacing their
  previous inline `params.get(...) ?? PUBLIC_DEFAULT_...` chains — a
  genuine small bonus fix for `builder.ts`, which never consulted the
  tenantId cache at all before this (only `?tenantId=`/the env default).
- **form.ts/view.ts's own post-route tenantId fallback line simplified**
  (`route.tenantId ?? PUBLIC_DEFAULT_TENANT_ID ?? getCachedTenantId(...)`
  → `route.tenantId ?? PUBLIC_DEFAULT_TENANT_ID`) — the `getCachedTenantId`
  tail was made redundant by `parseCurrentRoute()`/`parseCurrentViewRoute()`
  now doing that recovery (with backfill) upstream, so `route.tenantId`
  is already populated by the time either page reads it if the cache had
  anything to offer. Removed rather than left as silently-dead code.
- 11 new tests: `tenantResolver.test.ts` gained coverage for the three new
  cache/backfill functions plus five cases for
  `resolveApplicationAndTenantId` itself (URL wins + applicationId gets
  cached but tenantId deliberately doesn't; env-default used but never
  backfilled; cache recovery backfills the address bar; a URL-provided
  applicationId still lets a cached tenantId fill in; both undefined with
  nothing available anywhere). `router.test.ts` gained four cases
  exercising `parseCurrentRoute()`/`parseCurrentViewRoute()` end-to-end
  (the actual window-touching wrappers, not just the pure `parseRoute`
  everything else in that file already covered) — falls back to
  unresolved exactly like before when nothing's cached, recovers +
  backfills when something is, a real URL value still wins over a stale
  cached one, and the view-route wrapper recovers the same way. Needed
  its own copy of `tenantResolver.test.ts`'s localStorage shim (each test
  file gets its own isolated jsdom environment — this jsdom build doesn't
  expose `localStorage` on jsdom's default opaque-origin `about:blank`).
  **493 `@skye/app` tests total, 491 passing** (85 `@skye/form-config`
  unchanged), same 2 pre-existing unrelated `registerElements.test.ts`
  failures, type-check clean. Not yet verified live — the recovery logic
  itself is now unit-tested end-to-end through the real window-touching
  entry points, but the actual "lose the params, reload, watch them come
  back" click-through hasn't been done against a live tenant.

## 37. A second Custom View: a monthly calendar of the Luddy LLC Events list

`skye_data/views/llc-events-calendar/` — Previous/Next-month navigation
over the same Events list `add-to-calendar` and the form itself both
already read, with a real `<table>` calendar grid, not a grid of styled
`<div>`s. Explicit ask included a reference markup pattern (an accessible
calendar table shape: `<thead>`/`<th scope="col">` per weekday,
`<tbody>`/one `<tr>` per week/one `<td>` per day, a per-day `<h2>`
summary, `<ul>`/`<li>`/`<button>` per event, `<time datetime>` on every
date/time, `aria-current="date"` on today) — implemented close to that
pattern rather than reinterpreted, including the "No events, Sunday,
August 30" / "N event(s), Weekday, Month Day[, today]" per-day heading
wording and multi-day events repeating in every day they span.

- **One file again** (`view.html` only, no `view.css`/`view.js`) — same
  single-file capability this session added earlier this pass.
- **The per-day `<h2>` is visually hidden but stays in the accessibility
  tree** (the standard clip-rect "sr-only" pattern, defined locally in
  this view's own `<style>` — nothing shared to reuse yet), with a small
  visible `aria-hidden="true"` day-of-month number for sighted users
  instead. This is a deliberate reading of the reference markup: showing
  a literal, large `<h2>` per cell (as the pasted example does verbatim)
  would look broken as a real calendar UI, but the *semantics* — a clear,
  complete per-day sentence for assistive tech — are exactly what was
  asked for, so that's what's kept; only the visual presentation of that
  one element changed.
- **"Clicking an event" opens the form, not literally a `/view` route.**
  The ask said "the `/view` page for that entry," but individual
  SharePoint list items don't have a `/view` route in this app at all —
  only Custom Views do (`/view` renders a *view*, not a single item; a
  single item's read-only rendering is `/form?...#formId/itemId/view`,
  the form in view mode — the same place `luddy-llc-event-proposal`'s own
  admin approval flow already reviews an item). Read as "take me to
  where I can look at this event," which is unambiguous, and implemented
  as `skye.navigate({ form: "luddy-llc-event-proposal", itemId, mode:
  "view" })` — an *internal* navigation target, so (unlike
  `add-to-calendar`'s external Outlook link) it needs no
  `navigation.allowedExternalOrigins` entry at all.
- **No new `skye.config.json` entry needed** — this view names the exact
  same Events list id `add-to-calendar` already required adding to
  `views.allowedLists`; if that site's already set up for the sibling
  view, this one works immediately.
- **Same "fetch once, bucket client-side" strategy as the `calendar`
  demo fixture this was modeled on** (`top: 200` once; Previous/Next
  month re-renders from memory, no re-query) — but bucketed by **local**
  calendar day, not UTC, unlike that demo. The demo's own fixture data is
  date-only (`T00:00:00Z`, no real time-of-day), so UTC vs. local never
  mattered there; it matters here because these events have real
  start/end times, and UTC-day bucketing could occasionally place a
  late-evening event under the wrong date for the viewer. Documented as
  a deliberate divergence in this view's own README, not left as a
  silent difference from the pattern it's otherwise closely modeled on.
- **Verified the date/grid math in isolation before trusting it**, since
  the async top-level `skye.list()` call and DOM construction make the
  whole file hard to unit-test directly (same situation as
  `add-to-calendar`'s view.js — no existing harness for a Custom View's
  own script): extracted `buildWeeks`/`buildEventsByDay`/`dayKey` into a
  throwaway Node script and asserted against the reference example's own
  numbers — a September-2026 grid produces exactly 5 weeks running
  2026-08-30 through 2026-10-03 (matching the pasted reference exactly),
  a same-day timed event buckets under one day, and a Sept-28–29
  multi-day event buckets under both and only those two days. Syntax of
  the final inline `<script>` also re-checked with `esbuild` after
  trimming an unused `EventDescription` field out of the `select` list
  (present in an earlier draft, never actually read anywhere in this
  view — `add-to-calendar` uses it for the Outlook body, this one
  doesn't need it). Not yet verified live/in a real browser — this is
  hand-verified logic plus a syntax check, the same honest limitation
  `add-to-calendar`'s own build-log entry already flagged, and the same
  pre-existing, unrelated `cookie`/Astro build failure (§35) still blocks
  running this repo's Playwright Custom Views gate locally to get any
  closer than that right now.

**Follow-up, same day, from live testing**: the calendar rendered a
perfectly correct grid (verified via a temporary console diagnostic —
confirmed "Loaded 200 item(s), 200 with a usable StartTime") but showed
every day as empty, including September 2026, which the user knew should
have real events. Two real, distinct issues, found in sequence:

1. **The calendar opened on "today's month," and a real event over a
   year before today existed** (confirmed live: an August 2025 proposal).
   "Earlier events"/"Later events" originally stepped exactly one
   calendar month per click — reaching a genuinely-populated month a
   dozen-plus months away would've taken a dozen-plus clicks. Fixed by
   computing the sorted set of distinct months that actually have an
   event (once, from the full fetch) and having both buttons — and the
   initial month shown on load — jump directly to the nearest one in
   that set, in the requested direction, rather than stepping blindly.
   Buttons renamed "Earlier events"/"Later events" to match what they
   now actually do.
2. **The real bug**: a single `top: 200` fetch sorted **ascending** by
   `StartTime` returns the *oldest* 200 rows — once this Events list grew
   past 200 total items, everything from "now" onward (including the
   September 2026 events the user expected to see) fell off the end of
   that one page and was never fetched at all, regardless of what the
   calendar UI did with whatever it received. This is the exact "known
   limit" the view's own README had flagged as a *future* concern
   ("fine for this form's expected volume") — turned out to already be
   live. Fixed with real pagination: `fetchAllEvents()` now follows the
   result's `cursor` across up to 10 pages (2000 events) instead of
   trusting a single page, so the full list is fetched regardless of how
   large it's grown. `add-to-calendar`'s own single `top: 200` (sorted
   descending, so it keeps the newest 200 rather than the oldest) doesn't
   have this exact failure mode but shares the same root cause and is
   flagged in this view's README as worth the same fix if it's ever
   actually hit.
- Verified the new jump-to-nearest-month logic in the same throwaway-
  Node-script style as the grid math earlier in this section (today
  empty → nearest month by absolute distance; at the earliest/latest
  event → `null`, surfaced as "No earlier/later events." rather than
  silently doing nothing); re-syntax-checked the full script with
  `esbuild` after both changes. The temporary diagnostic status message
  added mid-debugging was replaced with the permanent "today's month has
  no events — showing the nearest month that does" message rather than
  left in place or silently removed.

**Second follow-up, same day**: confirmed working live, then a visual
polish request — restructure each event button into two visible lines
(a small bold time range, an ellipsis-truncated single-line title)
instead of one long comma-separated run of text. `renderEventButton` now
builds three `<span>`s: `.event-time` (small, bold — `<time datetime>`
start/end, or "All day, …" for a multi-day event), `.event-title`
(`overflow: hidden; white-space: nowrap; text-overflow: ellipsis`, so a
long title truncates instead of wrapping the button onto a second line
and blowing out the day cell's height), and a third, `.sr-only` span
carrying the location + full date — context that no longer appears in
either VISIBLE span now that they're trimmed to "time + title," but
still read by a screen reader (`sr-only` hides visually, not from the
accessibility tree), so the compact visual doesn't quietly lose the
richer per-event context the original denser button text stated
directly. The existing day-heading visual-hiding rule was generalized
from a one-off `.calendar-day__label` selector into a reusable `.sr-only`
utility class, now shared by both the day `<h2>` and this new detail
span, rather than duplicating the same clip-rect block twice.
Re-syntax-checked with `esbuild`; no date/navigation logic touched by
this pass, so the earlier Node-script verification still applies as-is.

**Third follow-up**: a "New Event" button added directly to the toolbar
markup (a `<nav><ul>` restructure of what had been a `<menu>`, and the
shared `view.css` gained real `--primary-*`/`--border*` design tokens and
a `button.primary`/`a.btn.primary` variant, both someone else's edits
picked up from disk) came in with its id copy-pasted from the "Later
events" button (`id="next-month"`, duplicated) and no click handler.
Gave it its own id (`new-event`) and wired it to `skye.navigate({ form:
FORM_ID })` — no `itemId`, `skye.navigate`'s own default for create mode
— rather than hand-building the literal
`/form?siteId=...&applicationId=...#luddy-llc-event-proposal/new` URL
this was requested against: the raw URL was useful for confirming the
intended target, but a Custom View has no way to navigate to an
arbitrary URL string at all (no `allow-popups`, no `location` access —
navigation only happens through the host-mediated `skye.navigate`
message), and the internal `{ form }` target already resolves against
this exact site without the view needing to carry or hardcode its
siteId/applicationId/tenantId itself. Re-syntax-checked with `esbuild`.

## 38. Button fields — a form field that runs its own action chain on click

New feature: `controlType: "button"`, a real `<button>` in the form with
its own, self-contained flow of actions (`field.actions`), independent of
Submit. Explicitly scoped up front via 4 clarifying questions before any
code changed (see CLAUDE.md's new "Button fields" section for the full
design writeup — this entry covers what got built and how, not the
reasoning already written there): Builder support included in this same
pass (not deferred); validation configurable per-button, default on;
button actions allowed to write the primary item directly, no
restriction; an optional per-button confirm dialog.

- **Schema** (`form.config.schema.json`/`types.ts`): `"button"` added to
  the `controlType` enum; `"onClick"` added to `PostActionTrigger`
  (alongside the 4 submit-lifecycle phases); three new field properties —
  `actions: Record<string, postAction>` (reuses the existing `$defs/postAction`
  `$ref` directly, zero schema duplication — every entry just happens to
  use `trigger: "onClick"`), `validate?: boolean`, `confirm?: {title,
  body}`. `required: ["actions", "label"]` when `controlType` is
  `"button"`; added to the existing "must be `source: virtual`"
  conditional alongside heading/paragraph/divider. 2 new schema tests
  (accepts a valid button field; rejects one missing `actions`/`label`).
- **Runtime engine** (`runButtonActions.ts`, new): a ~15-line wrapper
  around `@skye/form-config`'s existing `runTriggerPhase`/
  `createDefaultHandlerRegistry`/`buildActionExecutionContext` — the
  EXACT same call shape `submitForm.ts` already uses for one phase, just
  scoped to `field.actions` and hardcoded to trigger `"onClick"`. No new
  engine code needed in `@skye/form-config` at all — `runTriggerPhase`
  already filters by trigger internally, and since every button action
  uses the same trigger value, that filter is a no-op that happens to do
  exactly the right thing (scope to this one field's dict). 4 new tests
  (`runButtonActions.test.ts`): runs a `dependsOn` chain with `{{item.x}}`/
  `{{fields.x}}` resolved and a `redirect` firing; reports a failure
  without throwing and cascade-skips the dependent; tolerates a
  button with no `actions` at all; a `script` action reaches
  `ctx.scriptActions` with `item`/`fields`/`results` all in scope.
- **Rendering**: `fieldRegistry.ts` gained a `button` entry (mostly for
  registry completeness — `renderField.ts` gives it a bespoke branch,
  same idea as the existing heading/paragraph/divider content-only
  branch, but WITH its own status slot: a real `<button>` whose text is
  the field's `label`, no label-for/validation-message chrome, plus a new
  `buttonStatusEl` (`<output>`) for click feedback, kept separate per
  button so multiple buttons on one form never stomp on each other's
  status text. `validateFormValues.ts`'s `CONTENT_ONLY_CONTROL_TYPES` set
  gained `"button"` (nothing to validate on the button field itself —
  unrelated to the SEPARATE `rendered.validateAll()` call clicking it can
  trigger against the REST of the form). `renderForm.ts` returns a new
  `buttons: Record<fieldKey, {button, statusEl, field}>` — same
  "renderForm builds the DOM, the caller wires real behavior" split
  `submitButton` already established. A button never appears in
  `getValues()` — it has no `changeEvents`/`defaultValue` path to ever
  populate `values[key]`, so this needed no explicit skip, just fell out
  of the existing design already treating "nothing writes to this key"
  as "this key doesn't exist in values."
- **Orchestration** (`page-scripts/form.ts`): wires every button field's
  click (validate → confirm → `runButtonActions` → status message),
  unconditionally — including view mode, per the "stays clickable in
  view mode" design decision (see CLAUDE.md). Two small supporting
  changes: the existing view-mode "force every field readonly" loop now
  skips `controlType: "button"` (readonly has no meaning for a control
  with no value to protect); a new `loadedItemFields`/`itemForTemplates`
  pair keeps the edit-mode item's RAW SharePoint fields around after the
  load try-block (previously only the field-key-mapped `initialValues`
  survived it), so a button's `{{item.x}}` templates use the exact same
  real-column-name convention submitForm.ts's own postActions already
  established, not a second, field-key-based one that would silently
  mean something different depending on which action chain you're
  writing. 8 new tests across `renderField.test.ts` (button markup/
  status-output/helpText) and `renderForm.test.ts` (buttons collection,
  excluded from getValues/validateAll).
- **Builder UI** (included in this pass, not deferred): `"button"` needed
  zero new code to appear in the `+ Add field` controlType dropdown — it's
  schema-derived already (`page-scripts/builder.ts`'s `CONTROL_TYPES`).
  `features/builder/buttonActionsEditor.ts` (new) is a parallel,
  simplified `formSettingsEditor.ts` Post Actions editor — same
  wave-grouped, dependsOn-checkbox-list, `functionName`-dropdown card UI,
  minus the 4-way trigger-phase grouping a button doesn't need (its
  `actions` dict is already scoped to one field by construction, so
  there's no phase to choose/move between, and `trigger` is fixed,
  never an editable control). Reuses `formSettingsEditor.ts`'s
  `computeWaves`/`renderFunctionNameControl` directly (both newly
  exported — genuinely phase-agnostic already, no adaptation needed);
  wrote an adapted `renderDependsOnControl` (the one piece that
  legitimately differs — no phase filter, every dict entry is already a
  valid dependency candidate). `fieldEditor.ts` overrides `actions`
  specifically for `controlType: "button"` — shown directly (not the
  generic presence-toggled dictionary every OTHER controlType still
  falls back to for this same property, unused — matching the existing
  `fileStorage`/`table`/`calculatedDisplay` precedent exactly), with
  `field.actions` initialized to `{}` the moment the editor renders
  rather than left undefined, since it's functionally required for a
  button to do anything. `builderPreview.ts` needed NO changes at all —
  its existing delegated click listener already treats a click on any
  `[data-field-key]` element as "select this field for editing" rather
  than running it, which is already exactly the right behavior for a
  button clicked inside the live preview (it never gets a real click
  handler there, since only `form.ts` wires one). 12 new tests across
  `buttonActionsEditor.test.ts` (empty state, auto-set trigger, duplicate/
  invalid key rejection, script functionName dropdown, dependsOn +
  waves, remove-prunes-siblings-dependsOn) and `fieldEditor.test.ts`
  (button gets the dedicated editor + auto-inits `actions: {}`; a
  non-button field still gets the generic fallback, confirming the
  override is genuinely controlType-scoped and not a blanket replacement).
- **512 `@skye/app` tests total, 510 passing** (87 `@skye/form-config`,
  up from 85), same 2 pre-existing unrelated `registerElements.test.ts`
  failures, type-check clean across both packages throughout. Not yet
  verified live — every layer is unit-tested (schema validation, the
  runtime engine end-to-end with real `{{...}}` interpolation, rendering,
  and both new/adapted Builder editors), but the actual "author a button
  in `/builder`, save, click it on a live form, watch its actions run
  against real Graph/Teams/etc." round-trip hasn't been done against a
  live tenant.

## 39. First real-world use of button fields: Luddy LLC's "Approve Event"

The button feature's first real config, not a synthetic example —
replaces a legacy KWizCom-custom-JS approve button (a raw script
attached to a SharePoint form) with a config-only `controlType: "button"`
field on the admin overlay's Approval page, doing all 6 of its original
steps (set Status, create-or-update the BeInvolved event, save the
resulting id/access code back onto the item immediately, open a Teams
chat, send an Adaptive Card) through the existing action-chain engine —
no custom JS at all, per explicit instruction. Two real engine gaps and
one real design mistake were found and fixed along the way, not papered
over:

1. **`engage.createEvent`/`engage.updateEvent` never actually returned
   the attendance-scanner access code** — a genuinely live, pre-existing
   gap (the Luddy README already flagged it: "the config already wires
   `{{results.createBeInvolvedEvent.accessCode}}`... no config change
   needed" once the field was added — it hadn't been). Confirmed the
   real field name (`accessCode`) by downloading Engage's live OpenAPI
   spec directly (`https://engage-api.campuslabs.com/swagger/swagger.json`)
   and grepping its `3.0-Event-PostPutResponse` schema — `WebFetch`'s own
   page-summarization step twice failed to surface it from a spec that
   size, so this needed a raw `curl`-and-`python3`-parse pass instead
   (same "pull the raw spec, don't trust a summarized read" discipline
   this integration's very first build already established). Both
   actions now return `accessCode` alongside the existing
   `eventId`/`name`/`startsOn`/`endsOn`. 4 new tests in
   `engageActions.test.ts` (accessCode pass-through for both actions;
   confirmed `engage.updateEvent` also accepts a STRING `eventId` without
   breaking the request URL, since a `{{fields.x}}` template placeholder
   always produces a string even for a field whose TS type says
   `number`).
2. **The templating engine couldn't express "pass a multi-value field
   into a Teams member list"** — every `peoplePicker` field's value is
   `string[]` (even a single person is a 1-element array; confirmed via
   `SkyePeoplePicker`'s own `.value` getter), and the existing (never
   actually confirmed working) `openTeamsChatApproved` postAction's
   `"{{fields.host}}"` only "worked" by coincidence — `String(["x"])`
   happens to equal `"x"` for a 1-element array, but `String(["a","b"])`
   produces one broken comma-joined string, not two real chat members.
   Fixed at the engine level, not worked around per-config:
   `@skye/form-config`'s `interpolate()` now spreads an array element
   that's EXACTLY one whole placeholder resolving to an array, instead
   of stringifying it — see CLAUDE.md's "Button fields" section for the
   exact scoping (narrow: only array elements, not a general
   type-preservation change). 7 new tests in `templating.test.ts`.
3. **A real correctness bug, caught by testing the actual failure path,
   not just the happy path**: the first draft had create/update's
   mutually-exclusive branches share ONE downstream chain (save fields →
   open chat → send card) via `dependsOn` on both branches plus
   `runIfDependencySkipped: true` to bypass the always-one-of-them-was-
   skipped cascade. A test that specifically made the ACTIVE branch
   FAIL (not just left the inactive one skipped) caught that this
   design bypasses failure the exact same way it bypasses an ordinary
   skip — the shared downstream chain ran anyway, which for the
   SharePoint-save step would have written blank Status/id/code over
   whatever was there before, and for the Teams step would have sent an
   approval notification for an approval that didn't actually happen.
   Fixed by giving each branch its OWN fully independent downstream
   chain (`setBeInvolvedEventIdFromCreate`/`FromUpdate`,
   `setAttendanceCodeFromCreate`/`FromUpdate`,
   `saveApprovalFieldsFromCreate`/`FromUpdate`,
   `openApprovalChatFromCreate`/`FromUpdate`,
   `sendApprovalCardFromCreate`/`FromUpdate` — 10 actions instead of 5
   shared ones) with NO `runIfDependencySkipped` override anywhere, so
   each one only runs if every action in its own branch genuinely ran.
   Documented as a general lesson in CLAUDE.md's "Button fields" section
   (this exact trap will recur for any future mutually-exclusive branch
   with shared downstream steps) — this is exactly why the regression
   test below was worth writing before calling this done.
- **Explicit design decision, confirmed with the user before writing any
  JSON**: the button REPLACES the old Approved-branch postActions
  (`createBeInvolvedEvent`/`recordBeInvolvedIds`/`openTeamsChatApproved`/
  `sendApprovalMessage`, all removed from `postActions`) rather than
  coexisting with them — using both would risk creating a second
  BeInvolved event and sending a duplicate Teams notification if an
  admin used the button and then also hit the regular Submit. The
  Denied-branch postActions and both `showMessage` confirmations are
  untouched — this button doesn't replace denial.
- **`packages/app/src/__tests__/luddyApproveButton.test.ts`** (new) runs
  the REAL config file (`skye_data/forms/luddy-llc-event-proposal/admin/
  form.config.json`, imported directly, not retyped as a synthetic
  example) through `runButtonActions` end-to-end: first-time approval
  (create branch, full chain, array-spread member list verified
  host+both cohosts+reviewer, Adaptive Card contents verified),
  re-approval (update branch, PATCHes the existing event), and the two
  failure-path tests described above (§3) that specifically caught and
  then confirmed the fix for the shared-downstream-chain bug. This
  means a future edit to this exact config that breaks the branching,
  the array-spread trick, or a field binding fails a test, not just a
  live click.
- **519 `@skye/app` tests total, 517 passing** (94 `@skye/form-config`,
  up from 87), same 2 pre-existing unrelated `registerElements.test.ts`
  failures, type-check clean, `pnpm lint:configs` clean against the real
  `skye_data/forms/` checkout. Not yet verified against the live
  tenant/Teams/BeInvolved — the whole chain is proven against the real
  engine with mocked Graph/Engage/Teams responses, not against the
  actual APIs.

## 40. `_server/` — a real BeInvolved proxy Worker, replacing an ad-hoc one

New, standalone piece of infrastructure: a Cloudflare Worker at
`_server/` that proxies the Campus Labs Engage (BeInvolved) API,
injecting the real `X-Engage-Api-Key` server-side and gating every
request by Engage organization id. Given a real, working prior version
as reference (a Cloudflare Worker previously deployed outside this repo
entirely, covering just `/event` create and `/attendance` read, with a
hardcoded API key and a "little evil" SharePoint-URL-as-shared-secret
check) — asked to generalize it to cover every `engage.*` operation this
app's client-side actions already support, with a simpler org-id-only
gate. Scoped with 3 clarifying questions before writing any code
(platform, route shape, trust model for existing-event operations — all
3 answered with the recommended option).

- **`_server/` is a standalone project, not a workspace member** —
  `pnpm-workspace.yaml`'s `packages: - "packages/*"` glob doesn't match
  it, and it's listed in the root `.gitignore` (already present,
  alongside `skye_data`, before this pass started) — its own release
  lifecycle, independent of the Astro app's. `pnpm install` from inside
  it needs `--ignore-workspace` (confirmed live: without it, pnpm
  silently treats the whole install as a workspace no-op instead of
  installing `_server`'s own deps — a real, non-obvious trap, now
  documented in `_server/README.md`). Uses its own `tsconfig.json`/
  `vitest.config.ts`/`package.json` — completely invisible to the root
  `turbo run typecheck`/`turbo run test` (confirmed: running those from
  the repo root touches only `@skye/app`/`@skye/form-config`, unaffected
  by anything under `_server/`).
- **A transparent, drop-in proxy, not a redesigned API shape** — exposes
  the exact same 8 real Engage paths
  (`packages/app/src/integrations/engage/*.ts` already builds:
  `POST /v3.0/events/event`, `PATCH .../event/{id}`,
  `POST .../event/{id}/cancel`, `POST .../event/{id}/rsvp`,
  `PATCH .../event/{id}/rsvp/{id}`, `POST .../event/{id}/attendance`,
  `PATCH .../event/{id}/attendance/{id}`,
  `DELETE .../event/{id}/attendance/{id}`), gated + key-injected, via
  `src/router.ts`'s explicit route table (method + exact-shape regex per
  path) — an unmatched path 404s before ever reaching Engage, unlike a
  generic "forward any path" design (the option NOT chosen, per the
  clarifying question). This means pointing a form config's `baseUrl` at
  this Worker instead of the real Engage host needs ZERO other
  client-side code changes — the existing, already-tested `engage.*`
  actions already build these exact paths/bodies.
- **The org-id gate is client-declared, not verified against a live
  Engage lookup** (confirmed as the intended trust model via the
  clarifying question, matching the reference's own approach) — every
  request carries `X-Skye-Organization-Id` (`src/gate.ts`), checked
  against `ALLOWED_ORGANIZATION_IDS`. Event CREATION gets a SECOND,
  independent check on top of the header
  (`requireEventBodyMatchesAllowlist`): the request body's own
  `submittedByOrganizationId`/`organizationIds` must ALSO be
  allowlisted — the one route where Engage's real body carries
  organization ids of its own, so it's checked directly rather than
  only trusted via the header. CORS is origin-allowlisted, never a
  wildcard (`src/cors.ts`), matching the reference's own origin-check
  intent but reflecting a real header, not a hand-rolled string compare.
- **The real API key is a Worker secret, never hardcoded in source** —
  a deliberate departure from the reference (`beInvolvedAPIKey =
  "esk_live_c********"` as a plain source constant). `wrangler secret
  put ENGAGE_API_KEY`; the Worker reads `env.ENGAGE_API_KEY` and 500s
  loudly (never silently omits the header) if it's unset.
- **A real bug caught by the test suite before this ever shipped**: the
  first draft always constructed `new Response(responseBody, {status,
  ...})` regardless of status code — `engage.deleteAttendance`'s real
  response is a bare 204 (Attendance genuinely supports a true DELETE,
  unlike Events), and the Fetch spec's `Response` constructor THROWS if
  given ANY body (even `""`) alongside a null-body status (204/205/304).
  A dedicated test for the DELETE-with-no-body case caught this
  immediately; fixed by passing `null` instead of an empty string body.
- **30 new tests** across `_server/test/gate.test.ts` (allowlist
  parsing, header validation, the body cross-check for event creation,
  including "a caller can't smuggle in an extra org via the
  `organizationIds` array even if `submittedByOrganizationId` itself is
  fine"), `router.test.ts` (all 8 real paths match; an unknown path,
  wrong method, or non-numeric id segment doesn't; case-insensitive
  method matching), and `index.test.ts` (the full `fetch(request, env)`
  handler end-to-end, plain Node-environment vitest with a stubbed
  outbound `fetch` — CORS reflection, 404 on an unmatched route with
  zero calls to Engage, 403 on every gate-failure shape with zero calls
  to Engage, the real API key actually reaching the outbound request
  and never leaking into a rejection response, a 502 — not a raw
  exception — when the outbound Engage call itself throws, a 500 with
  zero calls to Engage when `ENGAGE_API_KEY` isn't configured, and the
  204-body fix above). Deliberately NOT using
  `@cloudflare/vitest-pool-workers` (a full Workers-runtime test
  harness) — an explicit effort/coverage tradeoff: the Worker's actual
  logic (`gate.ts`/`router.ts`/`index.ts`'s `fetch` handler) is plain
  TypeScript operating on standard `Request`/`Response`/`fetch` globals
  Node already provides, so a real Workers runtime isn't needed to
  exercise it meaningfully.
- **Known gap at the time, closed in §41 below**: `engageFetch` didn't
  yet send `X-Skye-Organization-Id`, so the app's own `engage.*` actions
  couldn't successfully call this proxy — left for a separate pass per
  the user's own "for now" framing of this request, and closed as soon
  as the Worker had a real deployed URL to wire in.

## 41. Wiring the deployed `_server` proxy into the client and the Luddy config

The `_server` Worker from §40 got a real deployment URL
(`https://skye-beinvolved-proxy.agua-melaza-0h.workers.dev`). Closing
the "known gap" §40 flagged — the client never actually sent the header
the Worker's gate requires — and pointing the Luddy LLC approve button
at the real proxy instead of a stub/placeholder.

- **`engageFetch` (`packages/app/src/integrations/engage/client.ts`)
  gained a 6th, optional `organizationId?: number` parameter**, sent as
  `X-Skye-Organization-Id: String(organizationId)` when supplied and
  omitted entirely otherwise — harmless against the real Engage API
  (which ignores unknown headers), required against `_server`'s gate.
  Every one of the 8 `engage.*` actions
  (`createEvent`/`updateEvent`/`cancelEvent`/`rsvpToEvent`/
  `updateRsvp`/`recordAttendance`/`updateAttendance`/`deleteAttendance`)
  gained the matching `organizationId?: number` field on its own options
  interface and threads it through to `engageFetch` unchanged — a
  mechanical, one-line-per-file change repeated identically across all
  8, each documented with the same one-line doc comment pointing back at
  `client.ts`'s fuller explanation rather than repeating it 8 times.
- **The Luddy LLC admin config's Approve button** (`createBeInvolvedEvent`/
  `updateBeInvolvedEvent` actions in
  `skye_data/forms/luddy-llc-event-proposal/admin/form.config.json`) now
  sets `"baseUrl": "https://skye-beinvolved-proxy.agua-melaza-0h.workers.dev"`
  and `"organizationId": 388096` (Luddy LLC's real BeInvolved
  organization id — confirmed from `_server/`'s own reference
  implementation, whose hardcoded allowlist comment named `388096`/
  `186922` as "LLC and ResLife") on both actions, and deliberately omits
  `apiKey` — the proxy injects the real one server-side. **Also fixed a
  real, separate bug found while doing this**: the event body's own
  `"submittedByOrganizationId"` was still the `0` placeholder from
  §39/§40's first draft (never actually set to a real org id) — now
  `388096`, with `"organizationIds": [388096]` added too, satisfying
  `_server`'s independent body-level allowlist check for event creation
  (`gate.ts`'s `requireEventBodyMatchesAllowlist`, §40) as well as the
  header-level one.
- **3 new tests** in `engageActions.test.ts` (`organizationId ->
  X-Skye-Organization-Id header` describe block): the header is sent
  when `organizationId` is supplied (via `createEvent`), omitted
  entirely when it isn't (via `cancelEvent`, confirming the real-API
  direct-call path is unaffected), and works identically for an
  existing-event operation (`cancelEvent` with `organizationId` set).
- **Docs updated to match**: `_server/README.md`'s "Client-side wiring
  is done" note replaces the old "known gap" language, and its top
  section now states the real deployed URL and that the Luddy config
  already points at it. `skye_data/forms/luddy-llc-event-proposal/README.md`'s
  "Fill in the placeholders" table now shows `submittedByOrganizationId`
  as ✅ set (`388096`) rather than a placeholder, corrects two rows whose
  "Where" column still named `recordBeInvolvedIds` — a postAction the
  §39 button rewrite removed entirely — to point at the button's actual
  `saveApprovalFieldsFromCreate`/`FromUpdate` actions instead, and
  replaces the old "optional, add apiKey/baseUrl" framing with a
  statement of what's already configured (proxy `baseUrl` +
  `organizationId`) and why `apiKey` is deliberately absent.
- Verified: `pnpm typecheck` clean across both packages;
  `pnpm test` green (the same 2 pre-existing, unrelated
  `registerElements.test.ts` failures from before this pass, confirmed
  via `git stash` back in §38, are still the only failures); the Luddy
  config still passes `pnpm lint:configs`. **Still not done**: the
  actual live round-trip (a real browser hitting the real deployed
  Worker, which reaches the real Engage API) — `_server/README.md`'s
  "What's deliberately not built yet" section already names this and
  remains accurate.

## 42. Fixed a real live-tenant bug: Site Assets resolution's fallback was dead code

First real-tenant bug report of the whole session: `/form` failed with
`SkyeNotConfiguredError: This site's Site Assets library has no
skye_data/config/skye.config.json — SKYE isn't set up here yet`, even
though the user could show `skye.config.json`'s exact contents pulled
straight from that SharePoint site — the file genuinely existed.

- **Root cause**: `graphClient.ts`'s `findSiteAssetsListId` — the
  documented 3-tier fallback (direct `GET .../lists/SiteAssets`, then a
  paginated `/lists` scan, then a `/drives` scan) for tenants where the
  fast-path `$filter=displayName eq 'Site Assets'` query doesn't surface
  the hidden system list — had its entire real body commented out and
  replaced with a bare `return null`, with 3 leftover `console.log`
  debug statements still in `resolveSiteAssetsDrive` around it. This was
  already sitting in `main` (confirmed via `git blame`, predating this
  entire session — not something introduced by any change in this log),
  evidently a leftover from an earlier live-debugging pass against this
  exact resolution path that got committed before being restored.
- **Effect**: on a site/tenant where the fast path alone doesn't find
  Site Assets, `resolveSiteAssetsDrive` unconditionally returned `null`,
  so every `skyeItemPath()` call (which every Graph read/write under
  `skye_data/` goes through) threw `SkyeNotConfiguredError` — a
  misleading "not set up" error on a site that actually was, with no way
  to distinguish it from a genuinely-unconfigured site.
- **Why the test suite never caught it**: `mockGraphClient.ts` simulates
  SKYE's own data layer directly and has no notion of "hidden system
  list resolution via `/lists` `$filter`/`/drives` fallback" at all —
  that dance is inherent to real Graph/SharePoint's specific hidden-list
  behavior, so this class of bug is structurally invisible to any
  mock-backed or jsdom test. CLAUDE.md's own "Untested against a live
  tenant" note already flagged this exact area as unverified; this is
  the first concrete case of that gap actually manifesting.
- **Fix**: restored `findSiteAssetsListId`'s real 3-tier body (uncommented,
  unchanged from what CLAUDE.md's own "SKYE data lives in a `skye_data`
  folder…" section already documented as the intended behavior) and
  removed the 3 debug `console.log`s in `resolveSiteAssetsDrive`. No
  logic changed beyond restoring what was already documented as the
  design — this was a "dead code left in by accident" bug, not a design
  gap.
- Verified: `pnpm typecheck` clean, `pnpm test` still 520/522 (same 2
  pre-existing, unrelated `registerElements.test.ts` failures). Cannot
  be verified further without live tenant access to confirm the
  fallback tiers themselves still behave as documented — flagged
  honestly rather than assumed.
- **This alone did NOT fix the user's live repro** — same error,
  same site, after the fix above. Root cause turned out to be one
  layer deeper: `siteAssetsDriveId` (the session-cached wrapper around
  `resolveSiteAssetsDrive`) had `.catch(() => null)` on the whole
  resolution — so a REAL Graph error (403 Forbidden, most plausibly:
  this app's `Sites.Selected` grant hasn't been extended to cover that
  particular site — a per-site grant, confirmed as a still-open item in
  CLAUDE.md's own "Real-tenant Graph permissions" section) got
  silently turned into `null` too, indistinguishable from "genuinely no
  Site Assets library." `hasSkyeConfig`, a few lines below in the same
  file, already had the right instinct for this exact situation (its
  own comment: "a 403 here is a real access problem, not 'no config' —
  let it surface") — `siteAssetsDriveId` just never followed the same
  rule.
- **Fix, part 2**: removed the blanket `.catch(() => null)` from
  `siteAssetsDriveId` so a real error now propagates all the way to
  `skyeItemPath`'s caller instead of being reported as
  `SkyeNotConfiguredError`. `form.ts`'s existing `main().catch((err) =>
  console.error("entry-form failed:", err))` already logs the full
  error object, so the real cause (e.g. a Graph 403 with its own
  message) is now visible in the console instead of being masked.
  `installSkyeSiteConfig`'s direct call to `siteAssetsDriveId` (the one
  call site that ISN'T through `skyeItemPath`) now wraps it in its own
  try/catch, converting a 403 into the function's existing
  `SkyeInstallError("forbidden", …)` — consistent with how every other
  failure in that function is already handled. `hasSkyeConfig` needed
  no change; it already let this propagate correctly.
- Re-verified: `pnpm typecheck` clean, `pnpm test` still 520/522 (same
  2 pre-existing failures). **Next step is the user's own**: reload and
  check the browser console for the actual underlying error this now
  surfaces — if it's a 403, the fix here is complete and the real
  remaining problem is a tenant-side permission grant, not app code.
- **Turned out to be neither** — the real underlying error the fix
  above successfully surfaced was `GraphError: timed_out` from
  `@azure/msal-browser`, not a Graph 403 at all. This was actually
  useful confirmation that the Site Assets resolution fixes above were
  correct and complete — the failure had moved from "SKYE isn't set up
  here" (masking the real cause) to a genuine, different, real cause
  one layer up in auth, exactly as intended.
- **Root cause**: `authProvider.ts`'s `initAndTrySilent` only treated
  `InteractionRequiredAuthError` as "fall through to interactive
  sign-in (popup)." `acquireTokenSilent`'s hidden-iframe silent-renewal
  path can time out for reasons that never reach that clean signal — a
  slow network, or (a well-documented, increasingly common cause as
  browsers restrict third-party cookies) the authority's session cookie
  being unreadable inside the iframe — surfacing instead as a
  `BrowserAuthError` with `errorCode: "timed_out"`. The old code treated
  that as fatal and rethrew it straight to the page's generic error
  state, never giving the user the popup that would have worked fine.
- **Fix**: broadened `initAndTrySilent`'s fallback condition to also
  catch `BrowserAuthError` with `errorCode === BrowserAuthErrorCodes.timedOut`
  (both now imported from `@azure/msal-browser`), falling through to the
  existing popup/redirect flow exactly like `InteractionRequiredAuthError`
  already did. No other logic changed — the rest of `acquireWithTenant`'s
  popup → redirect fallback chain was already correct and untouched.
- **3 new tests**, `src/__tests__/authProvider.test.ts` (new file):
  falls through to `loginPopup` on `InteractionRequiredAuthError`
  (baseline, already-working behavior); falls through to `loginPopup` on
  a `timed_out` `BrowserAuthError` (the actual bug, now fixed); does NOT
  fall through for an unrelated error, confirming the broadened check
  stayed narrow rather than swallowing everything. Mocks only
  `PublicClientApplication` (via `vi.importActual` for the real error
  classes, so `instanceof` checks inside `authProvider.ts` see genuine
  MSAL error instances) — found and fixed a real mocking gotcha along
  the way: `vi.fn().mockImplementation(() => mockInstance)` fails with
  "is not a constructor" when called via `new` (as `getMsalInstance`
  does), because an arrow function can never be a constructor; fixed by
  using a plain `function () { return mockInstance; }` instead.
- Verified: `pnpm typecheck` clean, `pnpm test` now 523/525 (the 3 new
  tests pass; same 2 pre-existing, unrelated `registerElements.test.ts`
  failures as every prior entry in this log). Not yet confirmed against
  the real live tenant that this specific fix resolves the user's
  original repro end-to-end — the next reload is the real test.

## 44. Two more real bugs surfaced clicking the Luddy approve button live: a view-mode readonly gap, and a CORS gap

Auth was fixed (§43) and the button's create-event action actually ran
against real IU data, surfacing two more genuine issues in quick
succession.

**Bug 1 — `hostEmail` (and `reviewer`) were readonly in view mode,
silently blocking the approve flow.** The first failure was
`engine.createEvent requires "submittedById" with at least one
identifier field set` — `hostEmail` was empty because the admin was
viewing (not editing) the record, and `page-scripts/form.ts`'s view-mode
loop force-readonlys every field except `controlType: "button"`. But
`hostEmail`/`reviewer` are virtual fields that exist ONLY to feed the
approve button's own `actions` (the host's email for `submittedById`,
the reviewer's id for the Teams chat's `memberUserIds`) — never
persisted themselves — so an approver genuinely needs to type/pick them
while otherwise just viewing the record, the exact situation
`controlType: "button"` was already carved out for.

- **Fix**: new `field.alwaysEditable?: boolean` (default `false`) —
  added to both the JSON schema (`form.config.schema.json`) and the
  `FieldConfig` TS type (`schema/types.ts`), and `form.ts`'s view-mode
  loop now also excludes any field with it set:
  `if (field.controlType !== "button" && !field.alwaysEditable) field.readonly = true;`.
  Set on both `hostEmail` and `reviewer` in the Luddy admin config. No
  new UI needed in the builder — `alwaysEditable` is picked up
  automatically the same way `actions`/`validate`/`confirm` already are
  (a plain top-level schema property, not gated behind a discriminator),
  per this repo's whole "the property editor comes from the schema
  itself" design.
- Verified: `pnpm typecheck` clean, `pnpm lint:configs` clean on the
  Luddy config, `pnpm test` still 523/525 (same 2 pre-existing
  failures). No dedicated test added for `form.ts`'s view-mode loop
  itself — consistent with the rest of that file, which is page
  orchestration wired live rather than unit-tested (see the button
  fields section's own note on `submitButton` being handled the same
  way).

**Bug 2 — the deployed `_server` proxy's CORS allowlist didn't cover
local dev, surfacing as a content-free `TypeError: Failed to fetch`.**
Past the readonly fix, `createBeInvolvedEvent` failed again, this time
with a bare `TypeError: Failed to fetch` and no further detail — no
CORS wording anywhere in the console, because that's genuinely all a
browser's `fetch()` ever reports when a response has no matching
`Access-Control-Allow-Origin` header (confirmed directly in `_server/src/cors.ts`'s
own doc comment: an unrecognized origin gets NO CORS header at all —
the browser blocks the response client-side, same effective result as a
403 but with none of a 403's diagnostic detail reaching JS). Root
cause: `_server/wrangler.toml`'s `ALLOWED_ORIGINS` only listed
`https://indiana.sharepoint.com` — the production SharePoint origin —
and the button was being tested from `pnpm dev` (`http://localhost:4321`).

- **Fix**: added `http://localhost:4321` to `ALLOWED_ORIGINS`
  (`_server/wrangler.toml`), with a comment explaining why and how to
  remove it for a prod-only deploy. Documented in `_server/README.md`'s
  "Deploying" section and CLAUDE.md's `_server/` entry so this specific
  "Failed to fetch means check ALLOWED_ORIGINS first" lesson isn't
  re-derived from scratch next time.
- **Not yet deployed** — this is a `wrangler.toml` edit only; it needs a
  `wrangler deploy` from `_server/` to actually take effect on the live
  Worker, deliberately left for the user to run (or confirm) rather than
  run autonomously against a live, shared Cloudflare deployment.

## 45. Real bug: edit/view mode showed the wrong time for a `dateTime` field — UTC digits shown as if local

User report: an event entered as 18:00 (America/Indiana/Indianapolis)
showed as 22:00 in `/form`'s edit/view mode, for the SAME stored item
the Custom Views calendar correctly showed as 18:00.

- **Root cause**: `mapSharePointFieldsToValues.ts`'s `trimDateForControl`
  — the function that seeds a `date`/`datetime-local` control from a
  loaded item's raw Graph `fields` payload — used a regex to slice the
  UTC digits straight out of Graph's ISO string
  (`"2026-10-01T22:00:00Z"` → `"2026-10-01T22:00"`) with no timezone
  conversion at all. A `datetime-local` control always interprets
  whatever string it's given as the viewer's OWN local time, so the raw
  UTC hour displayed as if it were already local — exactly a 4-hour
  offset for an EDT (UTC-4) viewer. The Custom Views calendar
  (`skye_data/views/*/view.html`) never had this bug because it always
  parses with `new Date(f.StartTime)` and reads back local
  getters for display, which is the correct approach.
- **Fix**: `trimDateForControl` now does `new Date(value)` and builds the
  control's string from that object's local getters
  (`getFullYear`/`getMonth`/`getDate`/`getHours`/`getMinutes`) — the
  same approach the calendar view already used, just applied here too.
  Falls back to the original raw value unchanged if `Date` can't parse
  it (`Number.isNaN(date.getTime())`), rather than throwing.
- **The write side was deliberately left untouched** — confirmed it's
  already correct (the calendar, reading the same stored value, already
  showed the right local time), but ONLY because Graph/SharePoint
  apparently interprets an offset-less `dateTime` write using the site's
  own regional-settings timezone, not this app's code doing any explicit
  conversion. Flagged in CLAUDE.md as a real but unverified assumption
  this app currently relies on rather than controls — not "fixed"
  without evidence it's actually broken.
- **1 new test**, `mapSharePointFieldsToValues.test.ts`: pins
  `process.env.TZ = "America/Indiana/Indianapolis"` for the exact live
  repro (22:00 UTC must read back as 18:00), with `afterEach` restoring
  the original `TZ` immediately — necessary because
  `vitest.config.ts`'s `pool: "threads"` shares one process across test
  files, so an unrestored env mutation could otherwise leak into
  unrelated tests. The pre-existing "trims a SharePoint ISO datetime"
  test was rewritten too — it previously hardcoded an assumption of
  naive slicing (`"...21:30:00Z"` → `"...21:30"`, implicitly only
  correct if the test machine itself runs in UTC) — now derives its
  expected value from `new Date(...)`'s own local getters, so it's
  correct on any machine's timezone, not just a UTC one.
- Verified: `pnpm typecheck` clean, `pnpm test` now 524/526 (the new
  test passes; same 2 pre-existing, unrelated `registerElements.test.ts`
  failures as every prior entry in this log) — confirms the TZ
  mutation didn't leak into any other test file.

## 46. Real bug: an untouched people-picker field false-positived "not a member of this site" on submit

User report (with a screenshot): editing an existing item and submitting
WITHOUT touching its Host/Cohosts fields failed with "Cloteaux, Lison is
not a member of this site" (Host) and "[object Object] is not a member
of this site" (Cohosts) — for people who plainly were real, already-saved
site members. Re-picking the exact same person from the search dropdown
and resubmitting worked.

- **Root mechanism**: `skye-people-picker`'s `.value` getter returns
  whatever raw shape it was last SET to. Re-picking a person calls
  `commit()`, which overwrites the value with a clean `string[]` of
  resolvable keys. An UNTOUCHED edit-mode field's value is still exactly
  whatever raw Graph shape `mapSharePointFieldsToValues` originally
  seeded it with — nothing ever called `commit()` on it.
- **Bug 1**: `checkPersonFieldsResolve.ts` (pre-submit membership check)
  and `encodeSharePointFields.ts`'s `personOrGroup` write branch both did
  a naive `.map(String)` on the raw value instead of extracting a
  resolvable identifier — a raw SharePoint person object stringifies to
  literally `"[object Object]"`. Fixed with a new shared
  `features/form/submit/personIdentifier.ts`, reused by both those files
  AND `registerElements.ts`'s `normalisePeopleValue` (which already had
  the CORRECT priority logic for chip rendering — the two had drifted
  apart; now there's one source of truth). Found and fixed a second,
  subtler bug while writing this: the priority chain's `??` doesn't skip
  a PRESENT-but-blank string, and `graphClient.ts`'s own
  `doResolveSiteUserId` comment already documents `EMail` as "often
  blank" on this tenant — `personIdentifier` now explicitly skips an
  empty string and falls through to the next candidate (LookupId).
- **Bug 2**: `mapSharePointFieldsToValues.ts`'s own doc comment was
  simply WRONG about Graph's real behavior for a SINGLE-value
  `personOrGroup` column — it assumed the full `{LookupId, LookupValue}`
  object (true for multi-value), but a real tenant response gave just
  the bare display-name STRING (`"Cloteaux, Lison"`), with the resolvable
  `HostLookupId` sitting unused in a separately-selected companion field.
  Fixed by rebuilding a bare-string single-value person into
  `{LookupId, LookupValue: <string>}` using that companion, giving Bug
  1's fix something to actually extract.
- **4 new tests** (`checkPersonFields.test.ts`,
  `encodeSharePointFields.test.ts`, `mapSharePointFieldsToValues.test.ts`
  ×2) reproduce the exact repro values from the screenshot, including the
  empty-string `Email` case. Both test files' `GraphClient` stubs were
  also fixed to model the real client's numeric-identifier fast path
  (`resolveSiteUserId` resolves a purely-numeric id to itself, no
  lookup — previously only modeled a known-email map).
- Verified: `pnpm typecheck` clean, `pnpm test` now 528/530 (4 new tests
  pass; same 2 pre-existing, unrelated `registerElements.test.ts`
  failures as every prior entry in this log).

## 47. Three more real bugs clicking the Luddy approve button live: a `.value` getter that lied, and a stale etag

User report, two issues: (1) approving an event failed with `Graph
request to "/chats" failed: 400 Bad Request`; (2) clicking the regular
Submit button right after (even after fixing #1) failed with "Someone
else changed this item since you opened it."

**Bug 1 — `skye-people-picker`'s `.value` returned raw, unnormalised
data for any field never re-picked since load, and a button's own
action templating has no normalisation layer of its own.**
`runButtonActions.ts` reads `rendered.getValues()` directly — unlike
`submitForm`'s pipeline (§46), nothing routes a button's `{{fields.x}}`
through `personIdentifier`. The approve button's `teams.createChat`
action template-stringified an untouched Host/Cohosts value (still the
raw SharePoint object §46 made `mapSharePointFieldsToValues` produce)
straight into a Graph `user@odata.bind` URL as `"[object Object]"` —
Graph's 400 was entirely correct given what it received.

- **Fix**: `SkyePeoplePicker` now overrides `get value()` to always
  return `this.picked.map(p => p.key)` — the already-normalised chip
  keys — never the raw `_value` the base class would otherwise hand
  back. Had to override `set value()` too in the same change: a
  subclass defining only a getter silently shadows the inherited
  setter as well (one property descriptor per accessor pair), so
  `.value = x` would throw in strict mode (ES modules always are)
  without it.
- **Bug 1b, found WHILE verifying bug 1's fix**: the new getter
  initially returned `[]` for a freshly-seeded single-value field. Root
  cause: `render()` had its own "re-sync `picked` from an
  externally-set `_value`" heuristic comparing `picked`'s keys against
  `_value` cast AS a `string[]` — for a non-array single-value seed
  (an object, not wrapped in an array), `Array.isArray(_value)` is
  false, so the comparison fell back to `[]` on both sides and
  `arraysShallowEqual([], [])` reported "equal," skipping the resync
  entirely even though `picked` was still genuinely empty. Fixed by
  having the new `set value()` override recompute `picked` directly
  and unconditionally instead of trusting that heuristic — removed the
  now provably-wrong, now-dead `arraysShallowEqual` helper rather than
  leaving it around unused.
- **1 new test** in `registerElements.test.ts` reproducing the exact
  live values (`"Cloteaux, Lison"` single-value, a blank-`Email`
  multi-value cohost) and asserting `.value` resolves correctly with
  zero interaction — the real regression this whole bug was.

**Bug 2 — the primary item's etag went stale mid-session, and nothing
refreshed it.** The approve button's `saveApprovalFieldsFromCreate`
action is a `graphRequest` PATCH straight to the item's `/fields`, with
no `If-Match` of its own (by design — see CLAUDE.md's "Button fields":
a button's actions can write the primary item with no restriction, and
aren't `submitForm`'s etag-aware path). That PATCH succeeds and changes
the item's server-side etag; `editEtag` (captured once at page load)
never updates, so a later Submit click's `updateListItem` call sends
the now-stale etag and gets a real, correctly-reported
`EtagConflictError`.

- **Fix, `page-scripts/form.ts`'s button-click handler**: after
  `runButtonActions` resolves, if `route.itemId` is set, re-fetch the
  item (same `$select` as the initial load) and refresh `editEtag` +
  `itemForTemplates` in place. Deliberately **unconditional**, not
  gated on the button reporting success — a button's actions run in
  `dependsOn` order, so the item-PATCH action can have already
  succeeded before a LATER, unrelated action in the same chain fails
  (exactly what the user's own two-part report showed: the PATCH
  landed, then `openApprovalChatFromCreate` failed on Bug 1 above —
  the user saw the chat failure first, but the etag had already gone
  stale by then regardless). Generic — not specific to the Luddy
  config or to approve buttons; any future button whose actions write
  the primary item gets a fresh etag for free. The refetch itself is
  best-effort (a failure here is swallowed, not surfaced), so a later
  Submit still reports its OWN real etag/network error rather than
  this silently eating the button's actual result.
- No dedicated test — `page-scripts/form.ts` is page orchestration
  wired live, not unit-tested, consistent with every other fix in this
  file (e.g. §44's `alwaysEditable` view-mode loop).
- Verified: `pnpm typecheck` clean, `pnpm test` now 529/531 (1 new
  test passes; same 2 pre-existing, unrelated
  `registerElements.test.ts` failures as every prior entry in this
  log), `pnpm lint:configs` clean on the Luddy config (unchanged by
  this pass — both fixes are app code, not config).

## 48. `/form` gets a top-of-page nav: Back / Edit Entry / Edit Form in Builder

Feature request: add nav links at the top of the form page — "Back" to
a predetermined view, "Edit Entry" (view → edit mode for the same
item), and "Edit Form in Builder" (only for a site owner/editor — this
one already existed as a lone "Edit in Builder" link, now folded into
the same nav).

- **New top-level `FormConfig` property: `backView?: string`** — a
  `skye_data/views/` Custom View id. Added to both
  `form.config.schema.json` and `form.config.overlay.schema.json`
  (plain scalar, same pattern as `title`/`mode` — an overlay can set/
  override it, last-wins via the existing JSON Merge Patch merge, no
  special-casing needed) and both `FormConfig`/`FormConfigOverlay` TS
  types. Omitted entirely means no Back link — there's no generic
  "previous page" to default to, since `/form` can be reached directly.
- **`pages/form.astro`**: the old lone `<a data-el="edit-link">`
  became `<nav data-slot="form-nav">` wrapping three links —
  `back-link`, `edit-entry-link`, and `edit-builder-link` (renamed from
  `edit-link` for consistency with the two new ones). New
  `.skye-form__nav`/`.skye-form__nav-link` CSS (flex row, wraps on
  narrow viewports) replaces the old single-link style.
- **`page-scripts/form.ts`**: each link wired independently — `back-link`
  shown only when `merged.backView` is set (`buildViewUrl`);
  `edit-entry-link` shown only in `route.mode === "view"`
  (`buildFormUrl(..., "edit", itemId)`), not permission-gated at the
  app level (SharePoint's own ACLs decide whether the edit actually
  succeeds, same as everywhere else in this repo); `edit-builder-link`
  is the pre-existing `canEditFormConfig`-gated logic, unchanged except
  for the renamed hook and label ("Edit Form in Builder").
  `astroMarkupHooks.test.ts`'s `pages/form.astro` entry updated to
  match the new/renamed hooks (this is the drift guard that would have
  caught a hook rename on only one side).
- **Builder support for `backView` follows this repo's "surface real
  selectable data, don't make an author hand-type an id" rule**
  (matches how the list picker and script-action `functionName` picker
  already work): `formSettingsEditor.ts`'s new `renderBackViewControl`
  renders a `<select>` of the site's real Custom Views
  (`graph.listSkyeViews`, fetched once into the builder's own state
  alongside `listColumns`) instead of a free-text box. Falls back to
  the generic text control when the site has no views yet; a current
  value the listing doesn't contain is shown flagged `"<id> (not
  found)"` rather than silently dropped, same pattern as an
  unregistered `functionName`. No other wiring needed — `backView` is
  a plain top-level schema property, so the settings editor's existing
  schema-driven rendering already surfaces it automatically; only the
  override (for the dropdown instead of free text) was new.
- **3 new tests** in `formSettingsEditor.test.ts` (dropdown renders +
  writes back on select; falls back to free text with no views
  available; an unlisted current value shown flagged, not dropped).
- Verified: `pnpm typecheck` clean, `pnpm test` now 532/534 (3 new
  tests pass; same 2 pre-existing, unrelated `registerElements.test.ts`
  failures as every prior entry in this log), `pnpm lint:configs`
  clean. `pnpm build` still fails on the same pre-existing, unrelated
  `cookie`/`parseCookie` CJS/ESM issue (confirmed via `git stash` much
  earlier in this session, not something this change touches) — could
  not visually verify the rendered nav in a real browser (no browser
  automation tool available in this environment); verified instead via
  typecheck, the markup-hooks drift guard, and the new builder tests.

## 49. Diagnosed (not a bug): the Engage API key can create events but isn't authorized to update them

User report: re-approving an already-approved Luddy LLC event failed at
`updateBeInvolvedEvent` with a 403 from `engageFetch`.

- Traced the error body — `{"error":"The specified API key is not
  authorized to use this endpoint.", "version":"v3.0", "method":"PATCH",
  "endpoint":"/events/event/<id>", "ip":"<cloudflare-edge-ip>"}` — and
  confirmed it's genuinely Campus Labs Engage's OWN rejection, not
  `_server`'s gate: the gate's own 403 body is just `{"error":
  "<message>"}`, with none of Engage's `version`/`method`/`endpoint`/`ip`
  fields. Cross-checked `updateEvent.ts`'s actual request (`PATCH
  /v3.0/events/event/{id}`, RFC 6902 patch body) against the error's own
  reported `method`/`endpoint` — they match exactly, ruling out a
  shape/encoding bug on SKYE's side.
- **Conclusion: this is an Engage-account-side API key scoping gap, not
  an app bug.** Campus Labs Engage API keys are authorized per-endpoint
  by whoever issues them; this key evidently has Create but not Update
  on the Events endpoint. `engage.createEvent` (first-time approval) has
  been working; `engage.updateEvent` (re-approving an item that already
  has a BeInvolved event id) cannot work until that key's permissions
  are widened on Campus Labs' side.
- No code change — documented in CLAUDE.md's Campus Labs Engage section
  so this isn't re-diagnosed as a bug if hit again. Next step is
  account-side: whoever manages the Engage integration needs to grant
  this key Update permission on Events.

## 50. Real gap found chasing the next error: `graphJson.ts` discarded Graph's actual error body

After §49's 403 was fixed, the Luddy approve button's re-approval path
hit a NEW failure: `openApprovalChatFromUpdate` — `Graph request to
"/chats" failed: 400 Bad Request`, with nothing more. Tried to diagnose
it the same way §49's Engage 403 was diagnosed (read the real response
body for Graph's own `error.code`/`error.message`) and found a real gap
instead: `graphJson.ts` (shared by every Graph-backed `script` action,
including `teams.createChat`) only ever reported `response.status` +
`response.statusText` — it never read the response BODY at all, where
Graph's actual diagnostic detail lives. `engage/client.ts`'s
`engageFetch` already did this correctly (confirmed directly useful in
§49 — its full body is exactly what made that 403 diagnosable at all);
`graphJson.ts` was the one Graph-side helper that never got the same
treatment.

- **Fix**: `graphJson.ts` now reads `response.text()` on a non-ok
  response and includes it (truncated to 300 chars) in the thrown
  error, mirroring `engageFetch`'s existing pattern exactly — same
  truncation length, same "body only, never echo the request" comment.
- **4 new tests**, `graphJson.test.ts` (new file): resolves the parsed
  body on 2xx; resolves `undefined` for a 2xx with no body (e.g.
  `sendMail`'s 202); includes the real error body in a thrown error
  (not just the status line) — the actual regression; truncates an
  oversized body to 300 characters.
- Verified: `pnpm typecheck` clean, `pnpm test` now 536/538 (4 new
  tests pass; same 2 pre-existing, unrelated
  `registerElements.test.ts` failures as every prior entry in this
  log).
- **Still waiting on**: the actual cause of the `/chats` 400 itself —
  this pass only fixed the diagnosability gap that was blocking seeing
  it. Next retry will surface Graph's real `error.code`/`error.message`
  in the console instead of a bare status line.

## 51. §50's diagnosability fix paid off immediately: real bug was duplicate chat members

The retry surfaced Graph's actual reason: `"Duplicate chat members is
specified in the request body."` — `teams.createChat`'s `memberUserIds`
had the same person listed more than once.

- **Root cause**: the Luddy approve button's `memberUserIds` is built
  by combining THREE separate people-picker fields —
  `["{{fields.host}}", "{{fields.cohosts}}", "{{fields.reviewer}}"]` —
  and the reviewer field's own helpText literally says "pick yourself."
  Overlap between host/cohosts/reviewer (the same person filling more
  than one role on an event, or a reviewer who's also the host) is a
  real, expected scenario, not a config-authoring mistake to avoid.
  Graph's `/chats` POST flatly rejects any duplicate member, and
  `createChat.ts` never deduplicated before sending.
- **Fix**: `teams.createChat` now deduplicates `memberUserIds`
  case-insensitively (email/UPN identifiers aren't case-sensitive)
  before building the Graph request, keeping the first occurrence of
  each. `chatType`'s own auto-detection (`"oneOnOne"` for exactly 2,
  `"group"` otherwise, when a config doesn't set `chatType` explicitly)
  now reads the DEDUPLICATED count too, not the raw one — 3 raw ids
  collapsing to 2 unique people should still auto-pick `"oneOnOne"`.
- **2 new tests** in `teamsActions.test.ts`: deduplicates a
  same-email-different-case repeat before building the request (the
  exact live bug); picks `chatType` from the deduplicated count, not
  the raw one.
- Verified: `pnpm typecheck` clean, `pnpm test` now 538/540 (2 new
  tests pass; same 2 pre-existing, unrelated
  `registerElements.test.ts` failures as every prior entry in this
  log).
- This closes out the Luddy approve button's full chain of real bugs
  hit across §44–§51 (view-mode readonly gap, CORS, a `.value` getter
  that lied, a stale etag, an Engage API key permission gap, a
  diagnosability gap, and now this) — next retry should be a clean
  end-to-end approve.

## 52. §51's dedup fix was real but not the whole story: `renderForm.ts`'s own value cache was still stale

§51's prediction was wrong — the very next retry hit a NEW error:
`TypeError: id.toLowerCase is not a function` inside the dedup code
§51 just added. This forced a deeper look, and found the actual root
cause §44–§51's fixes had all been dancing around without quite
reaching.

- **The real root cause, found this time**: `renderForm.ts`'s
  `getValues()` does NOT read live `.value` off each control — it
  returns a snapshot of an internal `values` cache object, updated only
  on an explicit `skye-change` event (the user actually interacting
  with that field) or an explicit `setFieldValue` call. The edit-mode
  seeding loop (`if (options.initialValues) { ... }`) used to set
  `values[fieldKey] = value` directly from the RAW seed — the actual
  SharePoint `{LookupId, LookupValue, Email}` shape for a peoplePicker
  — then separately called `writeControlValue(...)` to push that same
  raw value onto the control, where the control's OWN `set value()`
  normalises it internally. The cache and the control silently diverged
  right there: the control's internal state became correct (and,
  thanks to §47's `.value` getter fix, the control's own `.value` would
  report it correctly if read directly), but the cache kept the raw,
  un-normalised shape forever — until the user happened to re-pick the
  same person, refreshing the cache via the `skye-change` listener.
  This is EXACTLY why the user's original report (several sessions
  back) was "if you re-enter the names again it works": every fix since
  then (§46's `personIdentifier`, §47's `.value` getter override) fixed
  real bugs in how a VALUE gets normalised once read, but none of them
  touched the fact that `rendered.getValues()` — what a button's own
  `{{fields.x}}` action templating actually reads — was reading the
  cache, not the control, so an untouched field's cached value was
  never going through any of those fixes at all.
- **Fix**: the seeding loop now calls `writeControlValue` first, then
  — for a CUSTOM element specifically (`tagName.includes("-")`, the
  exact same distinction `writeControlValue` already draws) — reads the
  control's own value BACK via `readControlValue` and stores THAT in
  the cache, instead of trusting the raw seed. Deliberately scoped to
  custom elements only, not every control: a plain native `<input>`'s
  `.value` is always a string, so blindly reading it back for a NUMBER/
  Currency-bound field would have silently turned a cached JS number
  into a string — a real regression risk that was caught and avoided
  before it shipped, not hit live. `file` fields keep their own
  pre-existing special case (a file input can't be seeded
  programmatically at all, and `values[fieldKey]` staying the original
  saved URL is what an unmodified submit is supposed to re-send) — see
  `RenderFormOptions.filePreviews`'s own doc comment, unchanged.
- **2 new tests** in `renderForm.test.ts` (new describe block, with its
  own `registerElements()` `beforeAll` since this is the first test in
  that file to need real custom elements active): an untouched
  single-value peoplePicker's `getValues()` reads back as a resolvable
  `string[]`, not the raw seeded object; same for a multi-value field,
  including the blank-`Email`-falls-through-to-`LookupId` case.
- Verified: `pnpm typecheck` clean, `pnpm test` now 540/542 (2 new
  tests pass, the existing 32 `renderForm.test.ts` tests still green —
  confirming the native-input exclusion didn't regress anything; same 2
  pre-existing, unrelated `registerElements.test.ts` failures as every
  prior entry in this log).
- **Lesson for next time a "stale until re-interacted" bug shows up in
  this codebase**: check whether the value is being read from a LIVE
  control getter or from `renderForm.ts`'s own cached `values` object
  first — §46/§47 both correctly fixed normalisation logic but missed
  that the cache, not the control, is what most real callers
  (`getValues()`, and therefore `checkPersonFieldsResolve`/the submit
  encoder/button templating) actually read.

## 53. A third, deeper bug in the same chain: `{{fields.host}}` was never Graph-identifier-safe

§51's dedup fix was necessary but not sufficient — the next retry got
past it and hit a new 403: Graph's own `"OperationFailed ... One or
more members cannot be added to the thread roster,"` naming no
specific id.

- **Root cause**: `{{fields.host}}` (still used in `memberUserIds` at
  that point) resolves to the Host people-picker's value, which falls
  back to its SharePoint `personOrGroup` column's own numeric
  `LookupId` whenever that column's cached `Email` is blank — a real,
  documented SharePoint quirk this repo already knew about (see §46).
  A SharePoint LookupId is a COMPLETELY different id space from a
  Microsoft Graph user id: valid for writing `<col>LookupId` on a
  SharePoint item, meaningless to Graph's `/users/{id}` lookup Teams
  chat creation depends on. The Luddy admin config already had the fix
  for exactly this sitting unused: `hostEmail`, a manually-entered
  field whose own helpText already says "the people picker on Metrics
  stores a directory ID, not an email address" — already used
  correctly for Engage's `submittedById`, but never actually switched
  over for `memberUserIds`. The form's own README even already claimed
  "the Teams chat members are read from explicit fields (hostEmail,
  reviewer)" — a real, live drift between documented intent and actual
  config that had gone undetected until now.
- **Fix, two parts**:
  1. `teams.createChat` now validates every `memberUserIds` entry looks
     like a real Graph identifier (contains `@`, or matches a GUID
     pattern) BEFORE sending, throwing a specific error naming the bad
     value instead of letting Graph's opaque roster-rejection 403
     surface with zero diagnostic detail. This generically protects
     every future config against the same mistake, not just Luddy's.
  2. `skye_data/forms/luddy-llc-event-proposal/admin/form.config.json`:
     all 3 `memberUserIds` lists (both approve branches + the
     deny-branch chat) now read `{{fields.hostEmail}}` instead of
     `{{fields.host}}`, matching what the README already (incorrectly)
     claimed was already true.
- **3 pre-existing tests used fake non-email/non-GUID ids ("u1"/"u2"/
  "u3") and correctly broke under the new validation** —
  `teamsActions.test.ts` (×3) and `teamsActionChaining.test.ts` (×1)
  updated to use plausible UPN-shaped ids, since they were never
  actually testing "an implausible identifier" (a NEW, dedicated test
  now covers that case explicitly).
- **`luddyApproveButton.test.ts`'s mock data was strengthened, not just
  left passing by coincidence**: its `host`/`hostEmail` mock values
  happened to be identical strings before this pass, so the test would
  have kept passing even if `memberUserIds` had still read the wrong
  field. `host` is now deliberately `["42"]` (standing in for a
  fallen-back-to-LookupId shape) while `hostEmail` stays a real email
  — now the test actually proves `memberUserIds` reads `hostEmail`, not
  `host`.
- **2 new tests** in `teamsActions.test.ts`: accepts a bare GUID as
  well as a UPN/email; rejects a LookupId-shaped entry with a specific,
  named error (the actual regression guard for this bug).
- Verified: `pnpm typecheck` clean, `pnpm test` now 542/544 (same 2
  pre-existing, unrelated `registerElements.test.ts` failures as every
  prior entry in this log), `pnpm lint:configs` clean on the updated
  Luddy config.
- **General lesson, written into CLAUDE.md**: a SharePoint
  `personOrGroup` field's own value should never be trusted as a
  Microsoft Graph user identifier directly — bind to a field guaranteed
  to carry a real email/UPN instead. This is the fourth real bug the
  Luddy approve button's Teams chat has surfaced (§47 the `.value`
  getter, §51 duplicate members, §52 the stale cache, now this) — all
  genuinely different root causes, not the same bug resurfacing.

## 54. §53's validation worked as designed — and immediately caught the next instance: a cohost, not the host

The very next retry hit `teams.createChat`'s new validation again, this
time on `"1012"` — a cohost, not the host. `hostEmail` only covers the
single `host` field; there's no equivalent manual field a multi-value
`cohosts` picker can be swapped for, so §53's config fix didn't (and
structurally couldn't) cover this case.

Asked the user how to close this gap for good — three options: add a
manual `cohostEmails` field (mirrors `hostEmail`, low effort); drop
cohosts from the Teams chat entirely (simplest, but cohosts stop being
notified); or resolve a real email via an extra Graph lookup when the
cached one is blank (no new field, more engineering, can't be verified
against the live tenant from here). **User chose the Graph lookup.**

- **New `GraphClient.resolveSiteUserEmail(siteId, lookupId)`**
  (`graphClient.ts`) — the inverse of the existing `resolveSiteUserId`:
  given the numeric User Information List id, fetches that list item
  directly (`/sites/{siteId}/lists/User Information List/items/{id}`)
  and pulls a usable email out of `EMail` first, then `UserName` if
  it's already email-shaped, then `Name`'s claims-login format
  (`i:0#.f|membership|<upn>`) — the same three fields
  `resolveSiteUserId`'s own matching logic already treats as reliable
  enough to search on, so trusting them here is consistent with
  existing, already-verified behavior, not a new assumption. Cached per
  site per lookupId per session, same pattern as `resolveSiteUserId`'s
  own cache.
- **New `features/form/submit/backfillPersonEmails.ts`** — pure except
  for an injected `resolveEmail` callback (matching
  `mapSharePointFieldsToValues.ts`'s own no-Graph-access contract, so
  it stays unit-testable without a real/mocked GraphClient). Walks
  every peoplePicker field's seeded value (single object or array of
  them) and, for any entry with a blank/missing `Email`, resolves and
  fills one in; leaves an entry with a real Email, a plain string value
  (already a resolvable key from a fresh pick), or a non-peoplePicker
  field completely untouched.
- **Wired into `page-scripts/form.ts`** right after
  `mapSharePointFieldsToValues` in the edit/view-mode item-load path —
  so by the time ANY downstream code (`personIdentifier`, a button's
  own `{{fields.x}}` action templating, `teams.createChat`'s §53
  validation) sees the seeded value, it already has a real
  Graph-compatible email whenever one was resolvable. Required a small
  refactor to avoid a `tsc` narrowing gap: TS can't carry a `let`
  variable's "definitely defined" narrowing across an `await`, so the
  backfilled value is held in a local `const seeded` for the rest of
  that block's synchronous work (two later `initialValues[...]`
  accesses switched to `seeded[...]`, same underlying object) instead
  of needing non-null assertions.
- **`MockGraphClient.resolveSiteUserEmail`** — the inverse of its own
  existing `resolveSiteUserId` fixture-derived numbering (finds the
  fixture person whose `"person-N"` id matches, returns their email).
- **8 new tests**: `backfillPersonEmails.test.ts` (new file, 6 tests —
  single-value resolve, multi-value resolves each entry independently
  and only calls the resolver for blank ones, leaves an
  already-populated Email alone, leaves a value unchanged when nothing
  resolves, leaves a plain string key alone, ignores non-peoplePicker
  fields) and 2 in `mockGraphClient.test.ts` (round-trips through the
  real `resolveSiteUserId`/`resolveSiteUserEmail` pair; returns null
  for an unknown id).
- Verified: `pnpm typecheck` clean, `pnpm test` now 550/552 (8 new
  tests pass; same 2 pre-existing, unrelated
  `registerElements.test.ts` failures as every prior entry in this
  log), `pnpm lint:configs` clean (unaffected — this pass is entirely
  app code, no config change).
- `hostEmail` was deliberately left in place in the Luddy config, not
  reverted — it's still needed for Engage's `submittedById` and remains
  a reasonable belt-and-braces override for the one field it already
  covers; this pass's fix is what now additionally covers `cohosts`
  (and `reviewer`, and any future peoplePicker binding) without needing
  a parallel manual field for each one.

## 55. The approve button works end-to-end — now a feature request: date-prefixed chat topics

With §54's fix in place, the approve button ran clean end to end.
Follow-up ask: change the approval Teams chat's topic from
`"{{fields.eventTitle}} — approved"` to `"YYYY.MM.DD {{fields.eventTitle}}"`
(date first, no "approved" wording).

- **The templating engine has no date-formatting/transform syntax** —
  `{{namespace.path}}` only substitutes a value's raw stored form (see
  `post-actions/templating.ts`), so reformatting a date needs an actual
  computation step, not a cleverer template string.
- **New `util.formatDateYMD`** script action
  (`src/integrations/util/formatDateYMD.ts`, a new `util/` service
  folder — first action that's pure computation, no
  `ctx.graphFetch`/`ctx.httpFetch` at all) takes `{ date }` and returns
  `{ ymd: "2026.10.30" }`. Uses `Date`'s LOCAL getters, not UTC — the
  `startTime` field feeding it is a `datetime-local` control's own
  value (no timezone suffix), so this reads back the date it actually
  displays, consistent with `mapSharePointFieldsToValues.ts`'s own
  established date handling.
- **Luddy admin config**: new `formatApprovalChatTopic` action inside
  `approveButton.actions` (no `when` gate — runs unconditionally, so
  both the create and update branches can safely depend on it with no
  risk of the documented "shared conditional downstream" skip/failure
  ambiguity trap, since there's no condition to create that ambiguity
  here). Both `openApprovalChatFromCreate`/`FromUpdate` now
  `dependsOn` it too, and their `topic` is
  `"{{results.formatApprovalChatTopic.ymd}} {{fields.eventTitle}}"`.
  The denial-branch chat's topic (`"{{fields.eventTitle}} — not
  approved"`, a separate `postActions` entry in a different trigger
  phase) was deliberately left untouched — the user's request named
  the approved-chat topic specifically, and arguably the "not approved"
  wording carries useful information the date-only format would lose;
  can revisit if asked.
- **5 new tests** in `utilActions.test.ts` (new file): formats a
  datetime-local value; doesn't throw on a bare date-only value;
  zero-pads single-digit month/day; requires `date`; rejects an
  unparseable date. `actionsRegistry.test.ts`'s full-registry-listing
  test updated to include the new action.
  `luddyApproveButton.test.ts` updated: its `teams.createChat`
  assertion now expects `"2026.04.10 Spring Hackathon"` (from the
  test's own `startTime: "2026-04-10T18:00"` mock value), and its
  `stubCallbacks()` now wires in the REAL `formatDateYMD` (not a
  stub — it's pure, so there's no reason to fake it, and doing so is
  what actually exercises the new dependency end to end).
- Verified: `pnpm typecheck` clean, `pnpm test` now 555/557 (5 new
  tests pass; same 2 pre-existing, unrelated
  `registerElements.test.ts` failures as every prior entry in this
  log), `pnpm lint:configs` clean.

## 56. Real bug: "Fill out another response" did literally nothing after a create-mode submit

User report: clicking "Fill out another response" on the post-submit
splash screen did nothing at all — no URL change, no reload. Asked a
clarifying question to narrow down which of several possible symptoms
("nothing at all" vs "hash changes but page doesn't update" vs "reloads
to a broken page") it actually was, since each points to a different
bug; the answer ("literally nothing — no URL change, no reload")
pinpointed it immediately.

- **Root cause**: after a CREATE-mode submit, the address bar never
  updates — `showSubmittedSplash` is a pure JS state swap, no
  navigation happens. The URL stays on `#formId/new`, and "Fill out
  another response" ALSO targets `#formId/new`. Clicking a plain `<a>`
  whose href is byte-identical to the current URL isn't a navigation
  at all from the browser's own perspective — the hash genuinely isn't
  changing, so not even a `hashchange` event fires, meaning this app's
  own `hashchange -> reload()` mechanism (added much earlier this
  session for exactly this class of same-page-hash-link problem) never
  gets triggered. The link "did nothing" because, by that point, it
  genuinely had nothing left to do.
- **Fix, two parts** (the first alone isn't sufficient — it just moves
  the exact same problem onto the OTHER splash link):
  1. `showSubmittedSplash` now calls `history.replaceState(...)` to
     point the address bar at the just-saved item in view mode (the
     same URL "View submitted response" already links to) — both more
     accurate (the user really is now looking at a saved item) and
     makes "Fill out another response" target a genuinely different
     hash again.
  2. A new `forceReloadIfAlreadyThere(link)` helper is attached to
     BOTH splash links unconditionally — on click, if `link.href ===
     window.location.href`, it prevents the default (no-op) navigation
     and calls `window.location.reload()` directly, bypassing the
     `hashchange` mechanism entirely since it's already known not to
     fire in that exact case. Making this unconditional on both links,
     rather than guessing which one needs it, is what actually makes
     it robust — after the `replaceState` fix, "View submitted
     response" is now the one that CAN coincide with the current URL.
- Scoped deliberately narrow: the 3 `/form` top-of-page nav links
  added in §48 don't need the same guard — `/view`/`/builder` are
  different pages entirely (always a real cross-page navigation), and
  "Edit Entry"'s target hash can never equal view mode's own.
- No dedicated test — `page-scripts/form.ts` is page orchestration
  wired live, not unit-tested, consistent with every other fix in this
  file.
- Verified: `pnpm typecheck` clean, `pnpm test` still 555/557 (same 2
  pre-existing, unrelated `registerElements.test.ts` failures as every
  prior entry in this log — this pass touched no code any existing
  test exercises).

## 57. "Back" also added to the post-submit splash screen

Follow-up: the §48 top-of-page "Back" link didn't carry over to the
post-submit confirmation screen, since `showState` fully hides
`#screen-form` (and its nav) when `#screen-submitted` takes over — the
original element is genuinely gone, not just visually covered.

- Added a second `data-el="submitted-back-link"` inside
  `#screen-submitted`'s own `.skye-form__submitted-actions`, alongside
  "Fill out another response"/"View submitted response" — same
  `.skye-form__submitted-action` class, so it's styled consistently
  with no new CSS needed. `showSubmittedSplash` wires it with the
  identical `buildViewUrl(..., merged.backView)` href the main nav's
  back-link already uses; hidden (omitted) when the form has no
  `backView` set, same as the main one.
- **Real `tsc` catch while building this**: TS doesn't carry an outer
  `const`'s narrowing (`if (merged.backView)`) into a NESTED function
  body — `showSubmittedSplash` needed its own local `const backView =
  merged.backView;` before the check. Made the identical mistake a
  second time in the same edit, using `route.siteId`/`route.applicationId`
  directly instead of `showSubmittedSplash`'s own already-destructured
  `siteId`/`applicationId` locals (the whole reason those locals exist,
  per that function's own pre-existing comment) — caught immediately by
  the same typecheck pass, fixed by using the destructured locals.
- `astroMarkupHooks.test.ts`'s `pages/form.astro` entry updated with
  the new hook.
- No dedicated test — `page-scripts/form.ts` is page orchestration
  wired live, not unit-tested, consistent with every other fix in this
  file.
- Verified: `pnpm typecheck` clean, `pnpm test` still 555/557 (same 2
  pre-existing, unrelated `registerElements.test.ts` failures as every
  prior entry in this log).

## 58. Header logo: clipping on small viewports, and invisible on white

- **Clipping**: `#skye-logo` is `position: fixed` (bootstrap.css) so it
  floats over the page background on wide screens. On narrow screens the
  page background becomes white and the fixed logo overlapped the top of
  the content. In `form.css`'s `max-width: 700px` block the logo is now
  `position: static; display: block` with a 1rem gutter, so it sits in
  normal flow above the content instead.
- **Colour**: the SVG's three fills are a hard-coded pale blue (`#ddebfa`),
  which is invisible on white. Added `public/assets/skye_logo_light_grey.svg`
  (same file, fills `#e5e5e5`). `BaseLayout.astro` wraps the `<img>` in a
  `<picture>` whose `<source media="(max-width: 700px)">` swaps to the grey
  variant. A `<picture>` source is used rather than a CSS change because an
  `<img>`'s fill can't be recoloured from CSS.
- Verified: `pnpm typecheck` clean; tests 555/557 (same two pre-existing
  `registerElements.test.ts` failures). **Not verified visually** — the
  Chrome extension wasn't connected, so the rendered result at narrow and
  wide widths still needs a look.

## 59. Logo overlapping the container at mid-width viewports

- The logo is `position: fixed` above 700px, but the content container
  started only the body's 2rem margin below the top edge, so between the
  desktop and mobile breakpoints the logo overlapped the container's
  top-left corner. Fix: `form.css`'s base `body` top margin is now
  `5rem` (was `2rem`), reserving room for the fixed logo at every width
  above the small-viewport breakpoint. The narrow-screen static logo
  (§58) is unaffected.
- Verified: typecheck clean; tests unchanged (same two pre-existing
  `registerElements.test.ts` failures). Not verified visually — the Chrome
  extension wasn't connected.

## 60. Admin approval page: prefilled Host email and Teams members

- **Field defaults can now contain placeholders.** `defaultValue` may
  reference `{{currentUser.email}}` (the signed-in viewer) or other fields'
  loaded values (`{{fields.host}}`, `{{fields.cohosts}}`). `form.ts` pulls
  such defaults out before `renderForm` (so the raw placeholder text is
  never shown), renders the form, then resolves each one with the same
  `interpolate` the button actions use and sets it via `setFieldValue`.
  A value already seeded from a saved item always wins; an unresolvable
  default is left empty.
- `TemplateContext` gained an optional `currentUser` namespace.
- New `GraphClient.getCurrentUser()` (Graph `/me`, `mail` falling back to
  `userPrincipalName`); mocked for `PUBLIC_MOCK_GRAPH`.
- Admin config: `hostEmail` defaults to `{{currentUser.email}}`; `reviewer`
  defaults to `["{{currentUser.email}}", "{{fields.host}}", "{{fields.cohosts}}"]`.
  Both stay editable.
- Tests: `luddyAdminDefaults.test.ts` runs the real config's defaults through
  the templating engine.
- Caveats: resolving defaults happens once at load, so later edits to host or
  cohosts don't update reviewer. `/me` with `User.ReadBasic.All` returning a
  mail/UPN hasn't been checked against the live tenant.
- Deploy note: the admin config copy in SharePoint was stale (still
  `{{fields.host}}` in `memberUserIds`, old chat topic). Re-upload
  `admin/form.config.json` from the repo.

## 61. Approval comments shown on the approve card

- Both approve adaptive cards (`sendApprovalCardFromCreate` and
  `sendApprovalCardFromUpdate` in the Luddy admin config) gained a final
  `TextBlock` with `{{fields.approvalComments}}`, wrapped, below the facts.
- Verified: `pnpm lint:configs` clean.
- Caveat: the config was re-serialised with `json.dumps` to make this edit,
  which re-indents the whole file, so the diff is much larger than the change.
  The previous hand-formatting isn't recoverable from git (the local copy had
  uncommitted changes), so the file's formatting should be re-tidied by hand
  if that matters.
- Deploy note: re-upload `admin/form.config.json` to SharePoint for this to
  take effect.

## 62. Approval card: start and end times in en-US, Eastern time

- New `util.formatDateTime` action (`integrations/util/formatDateTime.ts`).
  It formats with `Intl` for `en-US` in `America/Indiana/Indianapolis` by
  default, e.g. "Oct 6, 2026, 7:00 PM EDT".
- The `datetime-local` input has no timezone, so the value is read as
  Indianapolis wall-clock time. It is converted to the real instant using
  the zone's offset at that moment, so the result doesn't depend on the
  browser's or server's timezone. Values that already carry an offset are
  left as given.
- Admin config: `formatCardStart`/`formatCardEnd` actions feed both approve
  cards' Starts/Ends facts, and each card now depends on them.
- Tests: four new `utilActions.test.ts` cases, including one that sets
  `TZ=Asia/Tokyo` to show the result doesn't depend on the process timezone.
  The registry test lists the new action.
- Verified: typecheck and `lint:configs` clean; app suite passes apart from the
  two long-standing `registerElements.test.ts` failures.
- Deploy note: re-upload `admin/form.config.json` to SharePoint.

## 63. Page titles: "SKYE: <form or view name>"

- Forms: `page-scripts/form.ts` sets `document.title` to `SKYE: <merged
  title>` right after the config merges, falling back to the form id.
- Views: `page-scripts/view.ts` looks up the view's `title` from its
  `view.json` via `graph.listSkyeViews`, falling back to the view id. The
  lookup is best-effort, so a listing failure only leaves the id in the
  title and doesn't block the view.
- Verified: typecheck clean; app suite at the two long-standing
  `registerElements.test.ts` failures only. Not checked in a browser.

## 64. Deployment to openskye.app via GitHub Pages

- **Domain**: `packages/app/public/CNAME` and `astro.config.mjs`'s `site` now
  use `openskye.app` (both were `skye.reecen.dev`). The workflow comments in
  `.github/workflows/deploy.yml` reflect the new domain, and the DNS note now
  says apex domains need A records, not a CNAME.
- **Build fix (blocked deploys)**: `astro build` failed with "Named export
  'parseCookie' not found ... 'cookie' is a CommonJS module". Root cause:
  the prerender bundle imports `cookie` as a bare specifier, but pnpm doesn't
  hoist astro's transitive `cookie` dependency where that bundle resolves it.
  On this machine it fell through to a stray `~/node_modules/cookie` (CJS);
  in CI there is no such file. Fix: `cookie@^2.0.1` declared as a direct
  devDependency of `@skye/app`. The same failure occurred on Node 22, so the
  Node version wasn't the cause.
- **Stale lockfile fixed**: `packages/app/package.json` asked for
  `astro ^7.3.4` while `pnpm-lock.yaml` pinned 7.3.1, so
  `pnpm install --frozen-lockfile` (what CI runs) would have failed. The
  lockfile is now regenerated and `--frozen-lockfile` passes.
- Verified locally: `pnpm build` completes, and `dist/` contains `CNAME`
  (`openskye.app`), `404.html`, and static `auth/`, `form/`, `view/`,
  `switcher/` routes. Typecheck and tests unchanged (two long-standing
  `registerElements.test.ts` failures).
- Still to do outside the repo: set the `PUBLIC_DEFAULT_APPLICATION_ID` and
  `PUBLIC_DEFAULT_TENANT_ID` repository variables, and register
  `https://openskye.app/auth` as an Entra SPA redirect URI.
- Open decision: `/test` and `/diag` are built and would be published
  publicly. `test.astro` is a static debugging dump and `diag.astro` is an
  internal tool; neither was removed.

## 65. View loader uses the shared spinner

- The status line shown while a Custom View's files load was plain text
  ("Loading view…") set from `features/custom-views/viewHost.ts`. It now uses
  the same `Loading` component as the other loaders. `view.astro` holds it in
  `<template data-tpl="view-loading">`, and `mountView` clones it. A missing
  template throws. The element keeps the `skye-view__status` class, so the
  error and warning colours still apply, and error text replaces the spinner
  as before.
- `astroMarkupHooks.test.ts` gained the new hook for `pages/view.astro`.
- Verified: typecheck clean; `pnpm build` succeeds and the view page output
  contains the template.
- **Test failures caused by the admin config on disk**: `skye_data/forms/
  luddy-llc-event-proposal/admin/form.config.json` no longer contains the
  approve-button field or the defaults, comments, and format actions from
  §§60–62 (it is the pre-§39 revision). Six Luddy tests (`luddyApproveButton`,
  `luddyAdminDefaults`) fail for that reason. Not restored, since it was
  changed on disk after the earlier edits; confirm which version is intended.
