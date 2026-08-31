# SKYE — Pre-Scaffolding TODO

Consolidated from architecture discussion, before writing any code. Organized so decisions already locked in aren't reopened, and open items don't get lost once implementation starts.

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
- [x] **Required-column coverage.** New form: `openBuilder` seeds a bound
  field per required column right after `getListColumns`. Existing
  base/draft: `renderFormSettingsEditor` shows a top "N required SharePoint
  columns have no field" panel with per-column "Add field" + "Add all"
  (new options `{ listColumns, defaultPageKey, requiredColumnCheck,
  onFieldsChanged }`) — surfaced, not silently mutated. Not shown for an
  additive overlay view. `formSettingsEditor.test.ts` +5.
- [x] **`GraphListColumn.readOnly`** added and captured in `mapColumn`, so
  computed/system required columns (Created/Modified/…) are excluded from
  the bind-to list, the new-form seed, and the missing-columns panel.
- **461 tests** (82 `@skye/config` + 379 `@skye/app`), type-check clean,
  Astro build verified, real-Chrome smoke: picking a `dateTime` column set
  Type→`date` + key→`eventStartTime`; a new form against the `Events` list
  seeded its required `Title` field (panel stayed hidden); deleting that
  field made the panel appear ("1 required SharePoint column has no
  field…"), and its "Add field" restored it.

---

**Status:** Everything through §12 is now done except the items explicitly called out as open below — schema, `packages/skye-config`, `MOCK_GRAPH` fixtures, the `packages/app` render layer, the submit/postAction pipeline, real Web Component implementations, `calculatedDisplay` reactivity, etag-conflict UX, lookupTable row deletion, the site switcher (Graph `/search/query`, exact-match filtering to `skye_data` folders), file uploads (`library` mode; `attachment` mode deliberately unimplemented with an honest explanation), and Turborepo task orchestration (§15) — **97 tests passing across both packages** (40 in `@skye/config`, 57 in `@skye/app`), both type-check clean, and a full Astro production build succeeds, all runnable via `turbo run <task>` with confirmed caching. `skye-richtext` was deliberately simplified to a minimal HTML/CSS-only placeholder (no `execCommand`, no formatting logic) per explicit instruction, replacing an earlier toolbar implementation. **Remaining open items** (see §13 and "Newly discovered gaps" above): an ARIA pass on the now-functional components, choosing and integrating a real editor library for `skye-richtext`, MSAL redirect-fallback state recovery, and verifying `searchSitesWithSkyeData`/list-column caching/etc. against a real tenant. See `CLAUDE.md` for the running summary and repo conventions.
