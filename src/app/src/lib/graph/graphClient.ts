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
  SkyeSiteConfigFile,
  SkyeViewFiles,
  SkyeViewSummary,
  UploadedFile,
} from "./types.js";
import { EtagConflictError } from "./types.js";
import { SkyeNotConfiguredError } from "../views/viewConfig.js";

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
    choices: (raw.choice as { choices?: string[] } | undefined)?.choices,
  };
}

export class RealGraphClient implements GraphClient {
  private client: Client;

  constructor(authProvider: AuthenticationProvider) {
    this.client = Client.initWithMiddleware({ authProvider });
  }

  async getListColumns(siteId: string, listId: string): Promise<GraphListColumn[]> {
    const res = await withRetry(() => this.client.api(`/sites/${siteId}/lists/${listId}/columns`).get());
    return (res.value as Record<string, unknown>[]).map(mapColumn);
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
    const basePath = `skye_data/forms/${formId}`;

    const fetchJsonFile = async (path: string): Promise<unknown> => {
      const res = await withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/${path}:/content`).get());
      return res; // Graph SDK parses JSON content-type responses automatically
    };

    const base = await fetchJsonFile(`${basePath}/form.config.json`);
    const files: SkyeFormConfigFile[] = [{ source: "base", config: base }];

    // Lists subfolders under the form's directory — Graph only returns folders the signed-in user can see
    // (see TODO §5 for the still-open verification of that assumption in a real tenant). Folders starting
    // with "_" are SKYE-reserved (currently just "_drafts", see saveFormDraft/listFormDrafts below) and are
    // never treated as a [permission] overlay — a live form render must never accidentally merge in draft data.
    const children = await withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/${basePath}:/children`).get());
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
    const path = source === "base" ? `skye_data/forms/${formId}/form.config.json` : `skye_data/forms/${formId}/${source}/form.config.json`;
    await withRetry(() =>
      this.client.api(`/sites/${siteId}/drive/root:/${path}:/content`).header("Content-Type", "application/json").put(JSON.stringify(config, null, 2))
    );
  }

  async listFormDrafts(siteId: string, formId: string): Promise<SkyeFormDraftSummary[]> {
    let children: { value: Array<{ name: string; folder?: unknown }> };
    try {
      children = await withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/skye_data/forms/${formId}/_drafts:/children`).get());
    } catch {
      return []; // no _drafts folder at all yet — not an error, just "no drafts"
    }
    const draftFolders = children.value.filter((c) => c.folder).map((c) => c.name);

    const drafts: SkyeFormDraftSummary[] = [];
    for (const draftId of draftFolders.sort()) {
      try {
        const config = (await withRetry(() =>
          this.client.api(`/sites/${siteId}/drive/root:/skye_data/forms/${formId}/_drafts/${draftId}/form.config.json:/content`).get()
        )) as { title?: string };
        drafts.push({ draftId, title: config.title ?? draftId });
      } catch {
        // Can list the folder but can't read its config — skip rather than fail the whole listing.
      }
    }
    return drafts;
  }

  async getFormDraft(siteId: string, formId: string, draftId: string): Promise<unknown> {
    return withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/skye_data/forms/${formId}/_drafts/${draftId}/form.config.json:/content`).get());
  }

  async saveFormDraft(siteId: string, formId: string, draftId: string, config: unknown): Promise<void> {
    await withRetry(() =>
      this.client
        .api(`/sites/${siteId}/drive/root:/skye_data/forms/${formId}/_drafts/${draftId}/form.config.json:/content`)
        .header("Content-Type", "application/json")
        .put(JSON.stringify(config, null, 2))
    );
  }

  async publishFormDraft(siteId: string, formId: string, draftId: string): Promise<void> {
    const config = await this.getFormDraft(siteId, formId, draftId);
    await this.saveSkyeFormConfigFile(siteId, formId, "base", config);
  }

  /**
   * Tenant-wide search for `skye_data` folders via Graph's /search/query
   * (entityType driveItem), per the original directory-structure notes.
   * Only hits that are an EXACT folder named "skye_data" count — the search
   * API can return fuzzy/partial matches, so a plain substring match would
   * risk pulling in unrelated sites. Deduplicates by siteId (a site could
   * theoretically surface more than once) and resolves each to a
   * displayName/webUrl via a follow-up /sites/{siteId} call. A site that
   * search finds but the signed-in user can no longer actually read (e.g.
   * permissions changed since indexing) is skipped rather than failing the
   * whole switcher.
   */
  async searchSitesWithSkyeData(): Promise<SiteResult[]> {
    const res = await withRetry(() =>
      this.client.api("/search/query").post({
        requests: [{ entityTypes: ["driveItem"], query: { queryString: "skye_data" }, from: 0, size: 25 }],
      })
    );

    const hits = (res.value?.[0]?.hitsContainers?.[0]?.hits ?? []) as Array<{ resource?: Record<string, unknown> }>;
    const siteIds = new Set<string>();

    for (const hit of hits) {
      const resource = hit.resource;
      const isExactSkyeDataFolder = resource?.name === "skye_data" && "folder" in (resource ?? {});
      const siteId = (resource?.parentReference as { siteId?: string } | undefined)?.siteId;
      if (isExactSkyeDataFolder && siteId) siteIds.add(siteId);
    }

    const sites: SiteResult[] = [];
    for (const siteId of siteIds) {
      try {
        const site = await withRetry(() => this.client.api(`/sites/${siteId}`).get());
        sites.push({ siteId, displayName: (site.displayName as string) ?? (site.name as string) ?? siteId, webUrl: site.webUrl as string });
      } catch {
        // Search found it, but we can no longer read the site itself — skip rather than fail the whole switcher.
      }
    }

    return sites;
  }

  /**
   * Lists the formId subfolders under skye_data/forms/ (mirroring the
   * [permission]-subfolder listing pattern in getSkyeFormConfigFiles above),
   * reading each one's base form.config.json just far enough to get its
   * title. A folder that can be listed but not read (e.g. broken/partial
   * setup) is skipped rather than failing the whole listing.
   */
  async listSkyeForms(siteId: string): Promise<SkyeFormSummary[]> {
    const children = await withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/skye_data/forms:/children`).get());
    const formFolders = (children.value as Array<{ name: string; folder?: unknown }>).filter((c) => c.folder).map((c) => c.name);

    const forms: SkyeFormSummary[] = [];
    for (const formId of formFolders.sort()) {
      try {
        const base = await withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/skye_data/forms/${formId}/form.config.json:/content`).get());
        forms.push({ formId, title: (base as { title?: string }).title ?? formId });
      } catch {
        // Can list the folder but can't read its base config — skip rather than fail the whole listing.
      }
    }
    return forms;
  }

  async getSkyeViewFiles(siteId: string, viewId: string): Promise<SkyeViewFiles> {
    const base = `skye_data/views/${viewId}`;
    // Read as TEXT — these are html/css/js, not JSON, so the SDK's automatic JSON parse doesn't apply.
    const readText = (path: string): Promise<string> =>
      withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/${path}:/content`).responseType(ResponseType.TEXT).get()) as Promise<string>;

    const [html, js] = await Promise.all([readText(`${base}/view.html`), readText(`${base}/view.js`)]);
    // A view.css is optional — a view may style entirely from view.html or rely on SKYE's shared stylesheet.
    const css = await readText(`${base}/view.css`).catch(() => "");
    return { html, css, js };
  }

  async getSkyeSiteConfigFiles(siteId: string): Promise<SkyeSiteConfigFile[]> {
    const basePath = "skye_data/config";
    const fetchJsonFile = (path: string): Promise<unknown> =>
      withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/${path}:/content`).get());

    let base: unknown;
    try {
      base = await fetchJsonFile(`${basePath}/skye.config.json`);
    } catch {
      // No site-wide config file at all — the caller renders a "SKYE isn't set up yet" page.
      throw new SkyeNotConfiguredError();
    }
    const files: SkyeSiteConfigFile[] = [{ source: "base", config: base }];

    // `[permission]` overlay folders — Graph only returns folders the signed-in user can see (see TODO §5).
    try {
      const children = await withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/${basePath}:/children`).get());
      const permissionFolders = (children.value as Array<{ name: string; folder?: unknown }>).filter((c) => c.folder).map((c) => c.name);
      for (const permission of permissionFolders.sort()) {
        try {
          files.push({ source: permission, config: await fetchJsonFile(`${basePath}/${permission}/skye.config.json`) });
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
    const children = await withRetry(() => this.client.api(`/sites/${siteId}/drive/root:/skye_data/views:/children`).get());
    const viewFolders = (children.value as Array<{ name: string; folder?: unknown }>).filter((c) => c.folder).map((c) => c.name);

    const views: SkyeViewSummary[] = [];
    for (const viewId of viewFolders.sort()) {
      let title = viewId;
      try {
        // Optional per-view manifest — just for a friendlier switcher label.
        const manifest = (await withRetry(() =>
          this.client.api(`/sites/${siteId}/drive/root:/skye_data/views/${viewId}/view.json:/content`).get()
        )) as { title?: string };
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
