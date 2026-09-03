import { Client, ResponseType } from "@microsoft/microsoft-graph-client";
import type { AuthenticationProvider } from "@microsoft/microsoft-graph-client";
import type {
  GraphClient,
  GraphListColumn,
  GraphListItem,
  ListItemImage,
  ListItemPage,
  ListItemQuery,
  LookupItemResult,
  PersonResult,
  SiteResult,
  SkyeFormConfigFile,
  SkyeFormDraftSummary,
  SkyeFormSummary,
  SkyeInstallResult,
  SkyeListSummary,
  SkyeSiteConfigFile,
  SkyeViewFiles,
  SkyeViewSummary,
  UploadedFile,
} from "./types.js";
import { EtagConflictError, SkyeInstallError } from "./types.js";
import { isSiteAssetsList, parsePastedSiteUrl } from "./siteUrl.js";
import { DEFAULT_SITE_CONFIG, SkyeNotConfiguredError } from "../site-config.js";

/** Best-effort MIME type from a file extension, for the rare case Graph's driveItem metadata omits `file.mimeType`. */
function guessMimeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" };
  return map[ext] ?? "application/octet-stream";
}

/** Pulls a URL out of the many shapes a SharePoint picture/image field can hold (plain string, {Url}, Image-column JSON, server-relative path). */
function normalizeImageRef(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    if (s.startsWith("{")) {
      try {
        return normalizeImageRef(JSON.parse(s));
      } catch {
        return null;
      }
    }
    return s;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const candidate = o.Url ?? o.url ?? o.serverRelativeUrl ?? o.serverUrl;
    return typeof candidate === "string" ? candidate : null;
  }
  return null;
}

/** Decodes any URL (absolute or already server-relative) to a decoded server-relative path with a leading slash. */
function toServerRelativePath(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return decodeURIComponent(url.startsWith("/") ? url : `/${url}`);
  }
}

/** The server-relative root path of a drive, from its webUrl (e.g. "/sites/Team/Shared Documents"). */
function driveRootServerRelative(webUrl: string | undefined): string | null {
  if (!webUrl) return null;
  try {
    return decodeURIComponent(new URL(webUrl).pathname).replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Re-encodes each path segment for use in a Graph `root:/…` addressing string. */
function encodeDrivePath(rel: string): string {
  return rel.split("/").map(encodeURIComponent).join("/");
}

/** Basic 429 retry: honors Retry-After, caps attempts so a persistent outage doesn't retry forever. See TODO §11. */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const status = (err as { statusCode?: number })?.statusCode;
      if (status !== 429 || attempt >= maxAttempts) throw err;
      const retryAfterHeader = (err as { responseHeaders?: Record<string, string> })?.responseHeaders?.["retry-after"];
      const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 500 * attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/** Maps a Graph column-definition payload to our simplified GraphListColumn shape. */
function mapColumn(raw: Record<string, unknown>): GraphListColumn {
  const columnType = (["text", "note", "number", "currency", "boolean", "dateTime", "choice", "lookup", "personOrGroup", "hyperlinkOrPicture"] as const).find(
    (t) => t in raw
  );
  return {
    name: raw.name as string,
    displayName: (raw.displayName as string) ?? (raw.name as string),
    columnType: columnType ?? "text",
    required: raw.required as boolean | undefined,
    readOnly: raw.readOnly as boolean | undefined,
    choices: (raw.choice as { choices?: string[] } | undefined)?.choices,
  };
}

/**
 * SKYE stores all its data in a `skye_data` folder inside the site's
 * **Site Assets** library — deliberately NOT the default "Documents"
 * library, so it's out of users' way and its permissions can be managed
 * separately. Site Assets is an ordinary document library, so creating
 * folders/files in it only needs the app's `write` grant. SKYE can't
 * create the Site Assets library itself (that needs a `manage` grant), so
 * if the site doesn't have one yet the user creates it in SharePoint and
 * retries — see installSkyeSiteConfig.
 */
const SKYE_ROOT_FOLDER = "skye_data";

export class RealGraphClient implements GraphClient {
  private client: Client;
  /** siteId -> driveId of the site's Site Assets library, or null if the site has none. Resolved once per site per session; busted by installSkyeSiteConfig so a just-created library is picked up. */
  private siteAssetsDriveCache = new Map<string, Promise<string | null>>();

  constructor(authProvider: AuthenticationProvider) {
    this.client = Client.initWithMiddleware({ authProvider });
  }

  /** driveId of the site's Site Assets library, or null if it doesn't exist yet. */
  private siteAssetsDriveId(siteId: string): Promise<string | null> {
    let cached = this.siteAssetsDriveCache.get(siteId);
    if (!cached) {
      cached = this.resolveSiteAssetsDrive(siteId).catch(() => null);
      this.siteAssetsDriveCache.set(siteId, cached);
    }
    return cached;
  }

  private async resolveSiteAssetsDrive(siteId: string): Promise<string | null> {
    // Fast path: the $filter that works on this tenant, WITH $expand=drive — one call gets the driveId.
    try {
      const res = await withRetry(() =>
        this.client.api(`/sites/${siteId}/lists`).filter("displayName eq 'Site Assets'").select("id,name,displayName,webUrl").expand("drive").get()
      );
      const list = (res.value as Array<{ id: string; name?: string; displayName?: string; webUrl?: string; drive?: { id?: string } }> | undefined)?.find(
        isSiteAssetsList
      ) ?? (res.value as Array<{ id: string; drive?: { id?: string } }> | undefined)?.[0];
      if (list?.drive?.id) {
        console.log(list.id, 153);
        return list.drive.id
      };
      if (list?.id) {
        console.log(list.id, 157);
        const drive = await withRetry(() => this.client.api(`/sites/${siteId}/lists/${list.id}/drive`).select("id").get());
        return (drive?.id as string) ?? null;
      }
    } catch (err) {
      console.log("err", 162);
      if (![400, 404].includes((err as { statusCode?: number })?.statusCode ?? 0)) throw err;
    }

    // Slow path: other ways to find the list (a differently-provisioned / non-hidden Site Assets).
    const listId = await this.findSiteAssetsListId(siteId);
    if (!listId) return null;
    const drive = await withRetry(() => this.client.api(`/sites/${siteId}/lists/${listId}/drive`).select("id").get());
    return (drive?.id as string) ?? null;
  }

  /**
   * Fallback list-id lookup for Site Assets, when the primary
   * `$filter=displayName eq 'Site Assets'` (in resolveSiteAssetsDrive)
   * turns up nothing — e.g. a non-hidden or differently-named Site Assets.
   * Site Assets is a HIDDEN system list on Teams-provisioned sites, so it's
   * absent from a plain `GET /sites/{id}/lists` AND `/drives`. Tries:
   *   1. a direct `GET /sites/{id}/lists/SiteAssets` (works on some tenants);
   *   2. a paginated `/lists` scan, then a `/drives` scan.
   */
  private async findSiteAssetsListId(siteId: string): Promise<string | null> {
    // type ListRow = { id: string; name?: string; displayName?: string; webUrl?: string };
    // const ignore4xx = (err: unknown): null => {
    //   const status = (err as { statusCode?: number })?.statusCode ?? 0;
    //   if (status === 400 || status === 404) return null;
    //   throw err;
    // };
    // console.log('direct lookup ',siteId,189);
    // // 1. Direct addressing by the URL name.
    // const direct = await withRetry(() => this.client.api(`/sites/${siteId}/lists/SiteAssets`).select("id").get()).catch(ignore4xx);
    // if (direct?.id) return direct.id as string;

    // // 3a. Plain paginated /lists scan (a non-hidden Site Assets, localized name, etc.).
    // let nextUrl = `/sites/${siteId}/lists?$select=id,name,displayName,webUrl&$top=100`;
    // while (nextUrl) {
    //   const page: { value: ListRow[]; "@odata.nextLink"?: string } = await withRetry(() => this.client.api(nextUrl).get());
    //   const match = page.value.find(isSiteAssetsList);
    //   if (match) return match.id;
    //   nextUrl = page["@odata.nextLink"] ?? "";
    // }

    // // 3b. /drives scan — the drive may be listed even when the list isn't. Return its associated list id.
    // const drives = await withRetry(() => this.client.api(`/sites/${siteId}/drives`).select("id,name,webUrl").get()).catch(ignore4xx);
    // const driveMatch = (drives?.value as ListRow[] | undefined)?.find(isSiteAssetsList);
    // if (driveMatch) {
    //   const list = await withRetry(() => this.client.api(`/drives/${driveMatch.id}/list`).select("id").get()).catch(ignore4xx);
    //   return (list?.id as string) ?? null;
    // }
    // return null;
    return null;
  }

  /**
   * Builds a Graph item path under `skye_data/…` in the site's Site Assets
   * library. Throws SkyeNotConfiguredError if the site has no Site Assets
   * library at all (there's nowhere for SKYE's data to be, so the site
   * isn't set up).
   */
  private async skyeItemPath(siteId: string, relativePath: string): Promise<string> {
    const driveId = await this.siteAssetsDriveId(siteId);
    if (!driveId) throw new SkyeNotConfiguredError();
    return `/sites/${siteId}/drives/${driveId}/root:/${SKYE_ROOT_FOLDER}/${relativePath}`;
  }

  async getListColumns(siteId: string, listId: string): Promise<GraphListColumn[]> {
    const res = await withRetry(() => this.client.api(`/sites/${siteId}/lists/${listId}/columns`).get());
    return (res.value as Record<string, unknown>[]).map(mapColumn);
  }

  /**
   * The site's user-facing lists, for the builder's "start a new form" list
   * picker — paginated so a big site is fully covered, `$select`ed down to
   * the few fields the picker needs, and filtered to drop hidden system
   * lists (`list.hidden`) so catalogs / Form Templates / Site Assets / etc.
   * don't clutter the dropdown. Sorted by display name.
   */
  async listSiteLists(siteId: string): Promise<SkyeListSummary[]> {
    type Row = { id: string; displayName?: string; name?: string; webUrl?: string; list?: { hidden?: boolean } };
    const out: SkyeListSummary[] = [];
    let nextUrl = `/sites/${siteId}/lists?$select=id,displayName,name,webUrl,list&$top=100`;
    while (nextUrl) {
      const page: { value: Row[]; "@odata.nextLink"?: string } = await withRetry(() => this.client.api(nextUrl).get());
      for (const l of page.value) {
        if (l.list?.hidden) continue;
        out.push({ id: l.id, displayName: l.displayName || l.name || l.id, webUrl: l.webUrl });
      }
      nextUrl = page["@odata.nextLink"] ?? "";
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async getListItem(siteId: string, listId: string, itemId: string, select?: string[]): Promise<GraphListItem> {
    let request = this.client.api(`/sites/${siteId}/lists/${listId}/items/${itemId}`).expand("fields");
    if (select?.length) request = request.expand(`fields(select=${select.join(",")})`);
    const res = await withRetry(() => request.get());
    return { id: res.id, fields: res.fields, etag: res["@odata.etag"] };
  }

  async createListItem(siteId: string, listId: string, fields: Record<string, unknown>): Promise<GraphListItem> {
    const res = await withRetry(() => this.client.api(`/sites/${siteId}/lists/${listId}/items`).post({ fields }));
    return { id: res.id, fields: res.fields, etag: res["@odata.etag"] };
  }

  async updateListItem(siteId: string, listId: string, itemId: string, fields: Record<string, unknown>, ifMatchEtag?: string): Promise<GraphListItem> {
    let request = this.client.api(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`);
    if (ifMatchEtag) request = request.header("If-Match", ifMatchEtag);
    try {
      const res = await withRetry(() => request.patch(fields));
      return { id: itemId, fields: res, etag: res["@odata.etag"] };
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 412) throw new EtagConflictError();
      throw err;
    }
  }

  async searchPeople(query: string): Promise<PersonResult[]> {
    // ConsistencyLevel: eventual + $count is required for $search on /users — see Graph's advanced query parameters docs.
    // An empty/whitespace query can't use $search at all — Graph rejects `"displayName:"` (empty
    // value) as malformed syntax, a real gap found via diag.astro's searchPeople('') check. Mirrors
    // MockGraphClient's existing "no query -> just list some users" contract instead of erroring.
    const needle = query.trim();
    let request = this.client.api("/users").header("ConsistencyLevel", "eventual").query({ $count: "true", $top: "10" });
    if (needle) request = request.query({ $search: `"displayName:${needle}"` });
    const res = await withRetry(() => request.get());
    return (res.value as Array<Record<string, unknown>>).map((u) => ({
      id: u.id as string,
      displayName: u.displayName as string,
      email: u.mail as string | undefined,
    }));
  }

  async searchLookupItems(siteId: string, listId: string, displayField: string, query: string): Promise<LookupItemResult[]> {
    const page = await this.searchListItems(siteId, listId, { search: query, top: 10, select: [displayField] });
    return page.items.map((item) => ({ id: item.id, label: String(item.fields[displayField] ?? item.id) }));
  }

  async deleteListItem(siteId: string, listId: string, itemId: string): Promise<void> {
    await withRetry(() => this.client.api(`/sites/${siteId}/lists/${listId}/items/${itemId}`).delete());
  }

  async searchListItems(siteId: string, listId: string, query: ListItemQuery): Promise<ListItemPage> {
    // A cursor is an opaque `@odata.nextLink` from a previous page — follow it directly, ignore everything else.
    let request = query.cursor
      ? this.client.api(query.cursor)
      : this.client.api(`/sites/${siteId}/lists/${listId}/items`).expand("fields").top(query.top ?? 25);

    if (!query.cursor) {
      if (query.filter) request = request.filter(query.filter);
      if (query.search) request = request.search(query.search);
      if (query.orderby) request = request.orderby(query.orderby);
      if (query.skip !== undefined) request = request.skip(query.skip);
      if (query.count) request = request.query({ $count: "true" });
      if (query.select?.length) request = request.expand(`fields(select=${query.select.join(",")})`);
    }

    const res = await withRetry(() => request.get());
    return {
      items: (res.value as Array<Record<string, unknown>>).map((raw) => ({ id: raw.id as string, fields: raw.fields as Record<string, unknown>, etag: raw["@odata.etag"] as string | undefined })),
      nextLink: res["@odata.nextLink"] as string | undefined,
      totalCount: res["@odata.count"] as number | undefined,
    };
  }

  async getSkyeFormConfigFiles(siteId: string, formId: string): Promise<SkyeFormConfigFile[]> {
    const basePath = `forms/${formId}`;

    const fetchJsonFile = async (relativePath: string): Promise<unknown> => {
      const apiPath = `${await this.skyeItemPath(siteId, relativePath)}:/content`;
      return withRetry(() => this.client.api(apiPath).get()); // Graph SDK parses JSON content-type responses automatically
    };

    const base = await fetchJsonFile(`${basePath}/form.config.json`);
    const files: SkyeFormConfigFile[] = [{ source: "base", config: base }];

    // Lists subfolders under the form's directory — Graph only returns folders the signed-in user can see
    // (see TODO §5 for the still-open verification of that assumption in a real tenant). Folders starting
    // with "_" are SKYE-reserved (currently just "_drafts", see saveFormDraft/listFormDrafts below) and are
    // never treated as a [permission] overlay — a live form render must never accidentally merge in draft data.
    const childrenPath = `${await this.skyeItemPath(siteId, basePath)}:/children`;
    const children = await withRetry(() => this.client.api(childrenPath).get());
    const permissionFolders = (children.value as Array<{ name: string; folder?: unknown }>)
      .filter((c) => c.folder && !c.name.startsWith("_"))
      .map((c) => c.name);

    for (const permission of permissionFolders.sort()) {
      try {
        const overlay = await fetchJsonFile(`${basePath}/${permission}/form.config.json`);
        files.push({ source: permission, config: overlay });
      } catch {
        // A folder we can list but can't actually read content from (edge case depending on inheritance
        // break granularity) — skip rather than fail the whole form load.
      }
    }

    return files;
  }

  /**
   * Writes a form.config.json back via Graph's simple-upload PUT endpoint —
   * same `:/content:` addressing as uploadToLibrary below, just with a
   * JSON string body and an explicit Content-Type instead of raw file
   * bytes. Graph creates any missing intermediate folder in the path
   * itself (this is how a brand-new `[permission]` overlay folder first
   * comes into existence), so no separate "create folder" call is needed.
   */
  async saveSkyeFormConfigFile(siteId: string, formId: string, source: "base" | string, config: unknown): Promise<void> {
    const rel = source === "base" ? `forms/${formId}/form.config.json` : `forms/${formId}/${source}/form.config.json`;
    const apiPath = `${await this.skyeItemPath(siteId, rel)}:/content`;
    await withRetry(() => this.client.api(apiPath).header("Content-Type", "application/json").put(JSON.stringify(config, null, 2)));
  }

  async listFormDrafts(siteId: string, formId: string): Promise<SkyeFormDraftSummary[]> {
    let children: { value: Array<{ name: string; folder?: unknown }> };
    try {
      const childrenPath = `${await this.skyeItemPath(siteId, `forms/${formId}/_drafts`)}:/children`;
      children = await withRetry(() => this.client.api(childrenPath).get());
    } catch {
      return []; // no _drafts folder at all yet (or no SKYE library) — not an error, just "no drafts"
    }
    const draftFolders = children.value.filter((c) => c.folder).map((c) => c.name);

    const drafts: SkyeFormDraftSummary[] = [];
    for (const draftId of draftFolders.sort()) {
      try {
        const apiPath = `${await this.skyeItemPath(siteId, `forms/${formId}/_drafts/${draftId}/form.config.json`)}:/content`;
        const config = (await withRetry(() => this.client.api(apiPath).get())) as { title?: string };
        drafts.push({ draftId, title: config.title ?? draftId });
      } catch {
        // Can list the folder but can't read its config — skip rather than fail the whole listing.
      }
    }
    return drafts;
  }

  async getFormDraft(siteId: string, formId: string, draftId: string): Promise<unknown> {
    const apiPath = `${await this.skyeItemPath(siteId, `forms/${formId}/_drafts/${draftId}/form.config.json`)}:/content`;
    return withRetry(() => this.client.api(apiPath).get());
  }

  async saveFormDraft(siteId: string, formId: string, draftId: string, config: unknown): Promise<void> {
    const apiPath = `${await this.skyeItemPath(siteId, `forms/${formId}/_drafts/${draftId}/form.config.json`)}:/content`;
    await withRetry(() => this.client.api(apiPath).header("Content-Type", "application/json").put(JSON.stringify(config, null, 2)));
  }

  async publishFormDraft(siteId: string, formId: string, draftId: string): Promise<void> {
    const config = await this.getFormDraft(siteId, formId, draftId);
    await this.saveSkyeFormConfigFile(siteId, formId, "base", config);
  }

  /**
   * Sites that ACTUALLY have SKYE set up (a `skye_data` folder in Site
   * Assets), for the switcher's step-1 list. Sources, unioned:
   *
   *  1. **Search** — Graph `/search/query` for a `skye_data` folder. A hit
   *     is only trusted when its `webUrl` is `.../SiteAssets/skye_data`
   *     (case-insensitive) — that path IS the proof, so no extra call is
   *     needed. A `skye_data` hit that's NOT clearly in Site Assets (a
   *     stale index entry, an old copy in Documents, or a hit with no
   *     usable `webUrl`) is verified with `hasSkyeConfig` and dropped if it
   *     comes back false. Search is eventually consistent, so a just-set-up
   *     site may be missing here (→ the paste box).
   *
   *  2. **Followed sites** — `GET /me/followedSites`, each verified with
   *     `hasSkyeConfig`. NOTE: `/me/followedSites` needs `Sites.Read.All`,
   *     NOT in the `Sites.Selected`-only GRAPH_SCOPES — today it 403s and
   *     this source is a graceful no-op.
   *
   * Every candidate is resolved/verified in PARALLEL.
   */
  async searchSitesWithSkyeData(): Promise<SiteResult[]> {
    type Candidate = { siteId?: string; webUrl?: string; trusted: boolean };
    const candidates: Candidate[] = [];

    // --- source 1: tenant search for a `skye_data` folder ---
    try {
      const res = await withRetry(() =>
        this.client.api("/search/query").post({
          requests: [{ entityTypes: ["driveItem"], query: { queryString: "skye_data" }, from: 0, size: 50 }],
        })
      );
      const hits = (res.value?.[0]?.hitsContainers?.[0]?.hits ?? []) as Array<{ resource?: Record<string, unknown> }>;
      for (const { resource } of hits) {
        const webUrl = String(resource?.webUrl ?? "");
        const isSkyeDataHit = resource?.name === "skye_data" || /\/skye_data\/?$/i.test(webUrl); // `folder` facet is often absent from trimmed search resources
        if (!isSkyeDataHit) continue;
        const siteId = (resource?.parentReference as { siteId?: string } | undefined)?.siteId;
        // The webUrl path proves the folder is in Site Assets — trust it, skip the verify call.
        const trusted = /\/SiteAssets\/skye_data\/?$/i.test(webUrl);
        candidates.push({ siteId, webUrl: webUrl || undefined, trusted });
      }
    } catch {
      // search unavailable — followed-sites source still runs
    }

    // --- source 2: followed sites (needs Sites.Read.All; no-ops on Sites.Selected) ---
    try {
      const followed = await withRetry(() => this.client.api("/me/followedSites").select("id,webUrl").get());
      for (const s of ((followed.value as Array<{ id?: string; webUrl?: string }>) ?? []).slice(0, 20)) {
        if (s.id) candidates.push({ siteId: s.id, webUrl: s.webUrl, trusted: false });
      }
    } catch {
      // no followedSites access
    }

    // --- resolve + verify every candidate in parallel; dedupe by siteId ---
    const resolved = await Promise.allSettled(
      candidates.map(async (c): Promise<SiteResult | null> => {
        const site = c.siteId ? await this.readSite(c.siteId) : c.webUrl ? await this.resolveSiteByUrl(c.webUrl).catch(() => null) : null;
        if (!site) return null;
        if (c.trusted) return site;
        return (await this.hasSkyeConfig(site.siteId).catch(() => false)) ? site : null;
      })
    );

    const bySiteId = new Map<string, SiteResult>();
    for (const r of resolved) {
      if (r.status === "fulfilled" && r.value) bySiteId.set(r.value.siteId, r.value);
    }
    return [...bySiteId.values()];
  }

  /** siteId -> { siteId, displayName, webUrl }, or null if unreadable. */
  private async readSite(siteId: string): Promise<SiteResult | null> {
    try {
      const site = await withRetry(() => this.client.api(`/sites/${siteId}`).get());
      return { siteId, displayName: (site.displayName as string) ?? (site.name as string) ?? siteId, webUrl: site.webUrl as string };
    } catch {
      return null;
    }
  }

  async resolveSiteByUrl(pasted: string): Promise<SiteResult | null> {
    const ref = parsePastedSiteUrl(pasted);
    if (!ref) return null;

    // A Teams link resolves via the backing M365 group. NOTE: `/groups/{id}/sites/root`
    // needs `Sites.Read.All` (or a Group.* scope) — NOT in the current `Sites.Selected`-only
    // GRAPH_SCOPES, so this will 403 until such a scope is added. It fails gracefully to
    // null and the user falls back to pasting the SharePoint URL.
    const apiPath =
      ref.kind === "groupId"
        ? `/groups/${ref.groupId}/sites/root`
        : ref.sitePath
          ? `/sites/${ref.hostname}:/${ref.sitePath}`
          : `/sites/${ref.hostname}`;

    try {
      const site = await withRetry(() => this.client.api(apiPath).get());
      return {
        siteId: site.id as string,
        displayName: (site.displayName as string) ?? (site.name as string) ?? (site.id as string),
        webUrl: site.webUrl as string,
      };
    } catch {
      // 404 (bad/typo'd URL), 403 (no access / grant doesn't cover it / missing scope for a Teams link)
      // — the switcher shows one "couldn't reach that site" message covering all of them.
      return null;
    }
  }

  async hasSkyeConfig(siteId: string): Promise<boolean> {
    const driveId = await this.siteAssetsDriveId(siteId);
    if (!driveId) return false; // no Site Assets library -> definitely not set up
    try {
      await withRetry(() =>
        this.client.api(`/sites/${siteId}/drives/${driveId}/root:/${SKYE_ROOT_FOLDER}/config/skye.config.json`).get()
      );
      return true;
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 404) return false;
      throw err; // a 403 here is a real access problem, not "no config" — let it surface
    }
  }

  /**
   * Functional write probe for `skye_data` — see the GraphClient interface
   * docstring for why it's a probe and not a permissions read. Uploads a
   * tiny marker file into `skye_data/` and deletes it; a 2xx on the upload
   * means the user can write (so could create a new form config). Every
   * failure path — 403 (read-only), no Site Assets library, name rejected,
   * network — resolves to `false`, since the callers are UI gates that
   * should hide the affordance when unsure rather than dead-end later.
   */
  async canWriteSkyeData(siteId: string): Promise<boolean> {
    let probePath: string;
    try {
      // Plain name + extension (no leading dot) so a filename-validation 400 can't masquerade as "no access".
      probePath = await this.skyeItemPath(siteId, "skye-write-check.tmp");
    } catch {
      return false; // SkyeNotConfiguredError — no Site Assets library, so nothing to write into
    }
    try {
      await withRetry(() => this.client.api(`${probePath}:/content`).header("Content-Type", "text/plain").put(""));
    } catch {
      return false; // 403 read-only, or any other write failure
    }
    // Best-effort cleanup — a stray marker is harmless and the next probe overwrites it.
    await withRetry(() => this.client.api(probePath).delete()).catch(() => {});
    return true;
  }

  private static readonly INSTALL_FORBIDDEN_MSG =
    "SKYE couldn't be set up on this site. Either you don't have permission to add files here, or SKYE's app access hasn't been granted for this site yet — a SharePoint admin can grant it.";

  async installSkyeSiteConfig(siteId: string): Promise<SkyeInstallResult> {
    // SKYE's data lives in the Site Assets library. If the site doesn't have one, we can't
    // create it (needs a `manage` grant) — the caller shows a "create it in SharePoint, then
    // retry" step. Bust the cache first so a library the user just made is picked up.
    this.siteAssetsDriveCache.delete(siteId);
    const driveId = await this.siteAssetsDriveId(siteId);
    if (!driveId) {
      throw new SkyeInstallError(
        "siteAssetsMissing",
        "This site has no Site Assets library yet — SKYE stores its data there. Create one in SharePoint (adding any page does it), then try again."
      );
    }
    const basePath = `/sites/${siteId}/drives/${driveId}/root:/${SKYE_ROOT_FOLDER}`;

    // Write the default config — this PUT creates skye_data/ and skye_data/config/ implicitly.
    try {
      await withRetry(() =>
        this.client.api(`${basePath}/config/skye.config.json:/content`).header("Content-Type", "application/json").put(JSON.stringify(DEFAULT_SITE_CONFIG, null, 2))
      );
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 403) throw new SkyeInstallError("forbidden", RealGraphClient.INSTALL_FORBIDDEN_MSG);
      throw new SkyeInstallError("unknown", "Couldn't write SKYE's starter config on this site. Check the console for details.");
    }

    // Best-effort empty structure so an owner browsing SharePoint sees where forms/views go.
    for (const folder of ["forms", "views"]) {
      try {
        await withRetry(() =>
          this.client.api(`${basePath}:/children`).post({ name: folder, folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
        );
      } catch {
        // Already exists, or a transient failure — the config file is what actually matters.
      }
    }

    // The skye_data FOLDER's SharePoint ids, so the switcher's "manage permissions" link can
    // target that folder specifically (a LISTITEM), not the whole Site Assets library.
    let libraryListId: string | null = null;
    let skyeDataItemId: string | null = null;
    try {
      const folder = (await withRetry(() => this.client.api(`${basePath}`).select("sharepointIds").get())) as {
        sharepointIds?: { listId?: string; listItemId?: string };
      };
      libraryListId = folder.sharepointIds?.listId ?? null;
      skyeDataItemId = folder.sharepointIds?.listItemId ?? null;
    } catch {
      // Non-fatal — the step falls back to a library-level link, or omits it.
    }

    return { libraryListId, skyeDataItemId, libraryName: "Site Assets" };
  }

  /**
   * Lists the formId subfolders under skye_data/forms/ (mirroring the
   * [permission]-subfolder listing pattern in getSkyeFormConfigFiles above),
   * reading each one's base form.config.json just far enough to get its
   * title. A folder that can be listed but not read (e.g. broken/partial
   * setup) is skipped rather than failing the whole listing.
   */
  async listSkyeForms(siteId: string): Promise<SkyeFormSummary[]> {
    const childrenPath = `${await this.skyeItemPath(siteId, "forms")}:/children`;
    // A site may have skye_data/config but no skye_data/forms folder yet (fresh install, or the
    // best-effort folder creation didn't run) — that's "no forms", not an error.
    const children = await withRetry(() => this.client.api(childrenPath).get()).catch((err) => {
      if ((err as { statusCode?: number })?.statusCode === 404) return { value: [] as Array<{ name: string; folder?: unknown }> };
      throw err;
    });
    const formFolders = (children.value as Array<{ name: string; folder?: unknown }>).filter((c) => c.folder).map((c) => c.name);

    const forms: SkyeFormSummary[] = [];
    for (const formId of formFolders.sort()) {
      try {
        const apiPath = `${await this.skyeItemPath(siteId, `forms/${formId}/form.config.json`)}:/content`;
        const base = await withRetry(() => this.client.api(apiPath).get());
        forms.push({ formId, title: (base as { title?: string }).title ?? formId });
      } catch {
        // Can list the folder but can't read its base config — skip rather than fail the whole listing.
      }
    }
    return forms;
  }

  async getSkyeViewFiles(siteId: string, viewId: string): Promise<SkyeViewFiles> {
    // Read as TEXT — these are html/css/js, not JSON, so the SDK's automatic JSON parse doesn't apply.
    const readText = async (file: string): Promise<string> => {
      const apiPath = `${await this.skyeItemPath(siteId, `views/${viewId}/${file}`)}:/content`;
      return (await withRetry(() => this.client.api(apiPath).responseType(ResponseType.TEXT).get())) as string;
    };

    const [html, js] = await Promise.all([readText("view.html"), readText("view.js")]);
    // A view.css is optional — a view may style entirely from view.html or rely on SKYE's shared stylesheet.
    const css = await readText("view.css").catch(() => "");
    return { html, css, js };
  }

  async getSkyeSiteConfigFiles(siteId: string): Promise<SkyeSiteConfigFile[]> {
    const fetchJsonFile = async (relativePath: string): Promise<unknown> => {
      const apiPath = `${await this.skyeItemPath(siteId, relativePath)}:/content`;
      return withRetry(() => this.client.api(apiPath).get());
    };

    let base: unknown;
    try {
      base = await fetchJsonFile("config/skye.config.json");
    } catch {
      // No SKYE library / no site-wide config file — the caller renders a "SKYE isn't set up yet" page.
      throw new SkyeNotConfiguredError();
    }
    const files: SkyeSiteConfigFile[] = [{ source: "base", config: base }];

    // `[permission]` overlay folders — Graph only returns folders the signed-in user can see (see TODO §5).
    try {
      const childrenPath = `${await this.skyeItemPath(siteId, "config")}:/children`;
      const children = await withRetry(() => this.client.api(childrenPath).get());
      const permissionFolders = (children.value as Array<{ name: string; folder?: unknown }>).filter((c) => c.folder).map((c) => c.name);
      for (const permission of permissionFolders.sort()) {
        try {
          files.push({ source: permission, config: await fetchJsonFile(`config/${permission}/skye.config.json`) });
        } catch {
          // Folder listed but its overlay isn't readable — skip, don't fail the whole load.
        }
      }
    } catch {
      // No children listing (e.g. no overlay folders) — the base file alone is fine.
    }

    return files;
  }

  async listSkyeViews(siteId: string): Promise<SkyeViewSummary[]> {
    const childrenPath = `${await this.skyeItemPath(siteId, "views")}:/children`;
    // No skye_data/views folder yet -> "no views", not an error (see listSkyeForms).
    const children = await withRetry(() => this.client.api(childrenPath).get()).catch((err) => {
      if ((err as { statusCode?: number })?.statusCode === 404) return { value: [] as Array<{ name: string; folder?: unknown }> };
      throw err;
    });
    const viewFolders = (children.value as Array<{ name: string; folder?: unknown }>).filter((c) => c.folder).map((c) => c.name);

    const views: SkyeViewSummary[] = [];
    for (const viewId of viewFolders.sort()) {
      let title = viewId;
      try {
        // Optional per-view manifest — just for a friendlier switcher label.
        const apiPath = `${await this.skyeItemPath(siteId, `views/${viewId}/view.json`)}:/content`;
        const manifest = (await withRetry(() => this.client.api(apiPath).get())) as { title?: string };
        if (manifest?.title) title = manifest.title;
      } catch {
        // No view.json — fall back to the folder id as the label.
      }
      views.push({ viewId, title });
    }
    return views;
  }

  async getListItemImage(siteId: string, listId: string, itemId: string, field: string): Promise<ListItemImage> {
    // 1. Read the field and pull a URL out of whatever shape it's stored in.
    const item = await this.getListItem(siteId, listId, itemId, [field]);
    const ref = normalizeImageRef(item.fields[field]);
    if (!ref) throw new Error(`Field "${field}" on item ${itemId} has no image URL to resolve.`);
    const serverRelativePath = toServerRelativePath(ref);

    // 2. Find which of the site's document libraries contains that path, then read the file's bytes + mime type.
    const drives = await withRetry(() => this.client.api(`/sites/${siteId}/drives`).get());
    for (const drive of (drives.value as Array<Record<string, unknown>>) ?? []) {
      const driveId = drive.id as string;
      const root = driveRootServerRelative(drive.webUrl as string | undefined);
      if (!root || !serverRelativePath.toLowerCase().startsWith(`${root.toLowerCase()}/`)) continue;

      const rel = encodeDrivePath(serverRelativePath.slice(root.length + 1));
      try {
        const meta = (await withRetry(() => this.client.api(`/drives/${driveId}/root:/${rel}`).select("file,name").get())) as {
          file?: { mimeType?: string };
        };
        const buffer = (await withRetry(() =>
          this.client.api(`/drives/${driveId}/root:/${rel}:/content`).responseType(ResponseType.ARRAYBUFFER).get()
        )) as ArrayBuffer;
        return { contentType: meta.file?.mimeType ?? guessMimeFromPath(serverRelativePath), bytes: new Uint8Array(buffer) };
      } catch {
        // Not in this drive after all (or unreadable) — try the next.
      }
    }
    throw new Error(`Couldn't resolve "${field}" (${serverRelativePath}) to a file in any document library on this site.`);
  }

  async uploadToLibrary(siteId: string, driveId: string, folderPath: string | undefined, fileName: string, data: ArrayBuffer): Promise<UploadedFile> {
    const path = folderPath ? `${folderPath}/${fileName}` : fileName;
    const res = await withRetry(() => this.client.api(`/sites/${siteId}/drives/${driveId}/root:/${path}:/content`).put(data));
    return { driveItemId: res.id as string, webUrl: res.webUrl as string };
  }
}
