// The seam between "how we talk to SharePoint/Graph" and everything else.
// Both the real client (graphClient.ts, backed by MSAL + fetch) and the
// mock client (mock-graph/mockGraphClient.ts, backed by local fixtures)
// implement this same interface, so rendering/validation/action code never
// needs to know which one it's talking to.

export interface GraphListColumn {
  /** Internal SharePoint column name (e.g. "Favourite_x0020_Campus") — what a field's `bindTo` targets. */
  name: string;
  displayName: string;
  columnType: "text" | "note" | "number" | "currency" | "boolean" | "dateTime" | "choice" | "lookup" | "personOrGroup" | "hyperlinkOrPicture";
  required?: boolean;
  /** Populated for columnType "choice". */
  choices?: string[];
}

export interface GraphListItem {
  id: string;
  /** Field internal-name -> value, as returned by Graph's `fields` expansion. */
  fields: Record<string, unknown>;
  /** Used for optimistic-concurrency PATCHes (`If-Match`) — see TODO §9. */
  etag?: string;
}

export interface ListItemQuery {
  /**
   * OData $filter, e.g. "fields/Campus eq 'Bloomington'". Internal callers
   * (pickers, submit) may pass this directly. The Custom Views path never
   * does — it hands users a structured query that lib/views/compileQueryToOData.ts
   * turns into this string, so no author input ever reaches Graph unvalidated.
   */
  filter?: string;
  /** Free-text $search, used by peoplePicker/lookupPicker as the user types. */
  search?: string;
  /** OData $orderby, e.g. "fields/Start desc,fields/Title asc". */
  orderby?: string;
  /** Page size — keep small; see TODO §11 on never fetching a full list. */
  top?: number;
  /** OData $skip (offset paging). Cursor paging via `cursor`/`nextLink` is preferred where the backend supports it. */
  skip?: number;
  /** When true, ask the backend for the total match count (`@odata.count`), surfaced as ListItemPage.totalCount. */
  count?: boolean;
  /** An opaque continuation token (a previous page's `nextLink`) — when set, the backend continues that result set and ignores the other query fields. */
  cursor?: string;
  /** $select — only the fields actually needed. */
  select?: string[];
}

export interface ListItemPage {
  items: GraphListItem[];
  /** Present when there's another page; pass back as `cursor` on a follow-up call to continue. */
  nextLink?: string;
  /** Total number of matching items, only populated when the query asked for `count`. */
  totalCount?: number;
}

/** The three source files that make up one Custom View, read from `skye_data/views/<id>/`. */
export interface SkyeViewFiles {
  html: string;
  css: string;
  js: string;
}

/** One `skye_data/config/...` file — the site-wide base or a `[permission]` overlay. Mirrors SkyeFormConfigFile. */
export interface SkyeSiteConfigFile {
  /** "base" for the top-level file, or the `[permission]` folder name for an overlay. */
  source: "base" | string;
  config: unknown; // validated/normalized by lib/views/viewConfig.ts, not re-typed here
}

/** One entry under a site's `skye_data/views/` directory — backs the switcher's view list. */
export interface SkyeViewSummary {
  viewId: string;
  /** From an optional `view.json` `{ "title": ... }`, falling back to the folder id. */
  title: string;
}

/** Raw bytes of a list item's image/file field, for `skye.image()` — the host base64-encodes this into a `data:` URI. */
export interface ListItemImage {
  contentType: string;
  bytes: Uint8Array;
}

/** One skye_data/forms/[id]/... config file, either the base or a permission overlay. */
export interface SkyeFormConfigFile {
  /** "base" for the top-level file, or the [permission] folder name for an overlay. */
  source: "base" | string;
  config: unknown; // validated by @skye/config's schema, not re-typed here
}

export interface PersonResult {
  id: string;
  displayName: string;
  email?: string;
}

export interface LookupItemResult {
  id: string;
  /** The related list's `displayField` column value, shown as this result's label — see the field's `relatedList.displayField`. */
  label: string;
}

/**
 * Thrown by updateListItem when an If-Match etag check fails (real 412
 * Precondition Failed, or the mock's simulated equivalent) — distinguished
 * from a generic write failure so callers (submitForm.ts) can show a
 * specific "someone else changed this" message instead of a generic error.
 */
export class EtagConflictError extends Error {
  constructor(message = "This item was changed by someone else since it was loaded (etag mismatch).") {
    super(message);
    this.name = "EtagConflictError";
  }
}

export interface SiteResult {
  siteId: string;
  displayName: string;
  webUrl: string;
}

/** One entry under a site's skye_data/forms/ directory — backs the switcher's "pick a form" step. */
export interface SkyeFormSummary {
  formId: string;
  /** The form's own `title` from its base config, falling back to the formId if the config has none. */
  title: string;
}

/**
 * One draft under `skye_data/forms/[formId]/_drafts/` — a full alternate
 * FormConfig a form owner is iterating on/sharing for testing, kept
 * deliberately separate from the live base and its `[permission]`
 * overlays: never merged into what a normal `/form` visit resolves, and
 * never listed by `listSkyeForms` (the switcher only enumerates
 * `skye_data/forms/`'s own immediate children, so anything nested one
 * level deeper under `_drafts/` is invisible to it by construction, not by
 * extra filtering). See CLAUDE.md's "Form Config Builder" section.
 */
export interface SkyeFormDraftSummary {
  draftId: string;
  /** The draft's own `title`, falling back to the draftId if its config has none. */
  title: string;
}

export interface UploadedFile {
  driveItemId: string;
  webUrl: string;
}

export interface GraphClient {
  getListColumns(siteId: string, listId: string): Promise<GraphListColumn[]>;
  getListItem(siteId: string, listId: string, itemId: string, select?: string[]): Promise<GraphListItem>;
  createListItem(siteId: string, listId: string, fields: Record<string, unknown>): Promise<GraphListItem>;
  /** `ifMatchEtag` enables optimistic concurrency — omit only for a first-time create-then-immediately-edit flow. Throws EtagConflictError on mismatch. */
  updateListItem(siteId: string, listId: string, itemId: string, fields: Record<string, unknown>, ifMatchEtag?: string): Promise<GraphListItem>;
  deleteListItem(siteId: string, listId: string, itemId: string): Promise<void>;
  searchListItems(siteId: string, listId: string, query: ListItemQuery): Promise<ListItemPage>;

  /** Backs the peoplePicker control — searches the tenant directory by display name. */
  searchPeople(query: string): Promise<PersonResult[]>;
  /** Backs the lookupPicker control — searches a specific related list's items, using `displayField` as each result's label. */
  searchLookupItems(siteId: string, listId: string, displayField: string, query: string): Promise<LookupItemResult[]>;

  /** Reads the base config plus every [permission] overlay the caller can currently see (see TODO §5: directory-ACL based, no app-level role logic). */
  getSkyeFormConfigFiles(siteId: string, formId: string): Promise<SkyeFormConfigFile[]>;

  /**
   * Writes one form.config.json file back to SharePoint — `source: "base"`
   * writes `skye_data/forms/[formId]/form.config.json`; any other `source`
   * writes `skye_data/forms/[formId]/[source]/form.config.json` (creating
   * that permission-overlay folder implicitly, the same way Graph's simple
   * PUT-to-`:/content:` endpoint creates any missing intermediate folder in
   * the path). Backs `/builder`'s Save — see TODO §17/CLAUDE.md. Callers are
   * expected to have already validated `config` (schema + additive-only
   * lint for an overlay) before calling this; it performs no validation of
   * its own, matching the "no code ever loaded from SharePoint" posture —
   * this only ever WRITES a plain data file, never reads one back as code.
   */
  saveSkyeFormConfigFile(siteId: string, formId: string, source: "base" | string, config: unknown): Promise<void>;

  /**
   * Lists the drafts under `skye_data/forms/[formId]/_drafts/` — a form
   * owner's in-progress/beta alternate configs. Deliberately a SEPARATE
   * method from `getSkyeFormConfigFiles` (not another `source` value there)
   * so the live-form-loading path can never accidentally pick one up: a
   * caller has to explicitly ask for drafts to ever see them.
   */
  listFormDrafts(siteId: string, formId: string): Promise<SkyeFormDraftSummary[]>;

  /** Reads one draft's full config — used both by `/builder` (to edit it) and by `/form`'s draft-preview mode (`?draft=`, see router.ts) to render it as if it were the live base. */
  getFormDraft(siteId: string, formId: string, draftId: string): Promise<unknown>;

  /** Writes `skye_data/forms/[formId]/_drafts/[draftId]/form.config.json` — creates the draft if it doesn't exist yet. */
  saveFormDraft(siteId: string, formId: string, draftId: string, config: unknown): Promise<void>;

  /**
   * "Publishes" a draft: reads its current config and writes it as the
   * form's new live base (`saveSkyeFormConfigFile(..., "base", ...)`).
   * Deliberately non-destructive — the draft itself is left in place
   * afterward (not deleted), so it stays editable and re-publishable
   * rather than being a one-shot action; a form owner who wants a clean
   * slate can always start a new draft with a different id.
   */
  publishFormDraft(siteId: string, formId: string, draftId: string): Promise<void>;

  /**
   * Powers the site switcher (shown on a 404/missing-siteId route): searches
   * the whole tenant for `skye_data` folders via Graph's /search/query
   * endpoint, and returns only the sites that actually have one — a site
   * with no SKYE configuration never shows up, by construction rather than
   * by client-side filtering after the fact.
   */
  searchSitesWithSkyeData(): Promise<SiteResult[]>;

  /**
   * Lists the forms configured on an already-chosen site — the subfolders
   * of its skye_data/forms/ directory, each read just far enough to get its
   * title. Backs the switcher's "pick a form" step, for a visit that
   * arrives with a site but no formId at all (see TODO §3).
   */
  listSkyeForms(siteId: string): Promise<SkyeFormSummary[]>;

  /**
   * Reads the three source files of one Custom View from
   * `skye_data/views/<viewId>/` (see TODO §16). The files are plain text
   * only — they are never imported, eval'd, or given an origin here; the
   * view host delivers them into a sandboxed, network-less iframe.
   */
  getSkyeViewFiles(siteId: string, viewId: string): Promise<SkyeViewFiles>;

  /**
   * Reads the site-wide `skye_data/config/skye.config.json` plus every
   * `[permission]` overlay under `skye_data/config/` the caller can
   * currently see — same directory-ACL model as getSkyeFormConfigFiles.
   * Throws SkyeNotConfiguredError (from lib/views/viewConfig.ts) if there
   * is no base file at all.
   */
  getSkyeSiteConfigFiles(siteId: string): Promise<SkyeSiteConfigFile[]>;

  /**
   * Lists the Custom Views configured on a site — the subfolders of its
   * `skye_data/views/` directory. Backs the switcher's view list (TODO §16).
   */
  listSkyeViews(siteId: string): Promise<SkyeViewSummary[]>;

  /**
   * Fetches the bytes of an image stored in (or referenced by) a list
   * item's field, for the `skye.image()` view capability. Resolves common
   * SharePoint shapes (a Hyperlink-or-Picture URL, an Image column's JSON,
   * a plain server-relative URL) to a document-library file and returns its
   * bytes — see graphClient.ts for the resolution strategy.
   */
  getListItemImage(siteId: string, listId: string, itemId: string, field: string): Promise<ListItemImage>;

  /**
   * Uploads a file into a document library — backs `fileStorage.target: "library"`.
   * Small-file upload only (Graph's simple PUT content endpoint, well-documented
   * and reliable up to ~4MB); larger files need Graph's upload-session API, not
   * yet implemented — see TODO §10.
   */
  uploadToLibrary(siteId: string, driveId: string, folderPath: string | undefined, fileName: string, data: ArrayBuffer): Promise<UploadedFile>;
}
