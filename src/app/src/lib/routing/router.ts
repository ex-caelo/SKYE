export type FormMode = "create" | "edit" | "view";

export interface FormRoute {
  page: "form";
  formId: string;
  mode: FormMode;
  /** Present only in edit/view mode. */
  itemId?: string;
  siteId: string;
  applicationId: string;
  /** Only needed for a single-tenant Azure app registration (which rejects the /common authority — see authProvider.ts); absent means "assume multi-tenant". */
  tenantId?: string;
  /**
   * `?draft=<id>` — renders `skye_data/forms/[formId]/_drafts/[draftId]/form.config.json`
   * in place of the live base config (real `[permission]` overlays the
   * viewer can see are still merged on top as normal), for a form owner to
   * share a beta/testing link without touching the live form at all. See
   * CLAUDE.md's "Form Config Builder" section and TODO §17.
   */
  draftId?: string;
}

export interface UnresolvedRoute {
  page: "unresolved";
  /** Whatever siteId WAS present, if any — used to decide whether this is a "no siteId" case or something else. */
  siteId?: string;
  applicationId?: string;
  tenantId?: string;
}

/** A Custom View route: `/view?siteId=&applicationId=&tenantId=#{viewId}` (TODO §16). */
export interface ViewRoute {
  page: "view";
  viewId: string;
  siteId: string;
  applicationId: string;
  tenantId?: string;
}

export type Route = FormRoute | UnresolvedRoute;

/**
 * Parses a hash like "#abc123/new" or "#abc123/45/view" plus the query
 * string's siteId/applicationId into a structured route. Pure function —
 * no window/location access — so it's fully unit-testable; parseCurrentRoute
 * below is the thin wrapper that reads the real browser location.
 */
export function parseRoute(hash: string, search: string): Route {
  const cleanHash = hash.replace(/^#/, "");
  const params = new URLSearchParams(search);
  const siteId = params.get("siteId") ?? undefined;
  const applicationId = params.get("applicationId") ?? undefined;
  // Optional — only needed for a single-tenant Azure app registration; see FormRoute's own doc comment.
  const tenantId = params.get("tenantId") ?? undefined;
  const draftId = params.get("draft") ?? undefined;

  const segments = cleanHash.split("/").filter(Boolean);
  const formId = segments[0];
  const second = segments[1]; // "new" | itemId | undefined
  const third = segments[2]; // "view" | undefined

  if (!formId || !siteId || !applicationId) {
    // Missing any of the three required pieces means we can't resolve a form —
    // caller (entry-form.ts) should route to the site-switcher/404 flow (TODO §3, still open scope-wise).
    return { page: "unresolved", siteId, applicationId, tenantId };
  }

  let mode: FormMode;
  let itemId: string | undefined;

  if (!second || second === "new") {
    mode = "create";
  } else if (third === "view") {
    mode = "view";
    itemId = second;
  } else {
    mode = "edit";
    itemId = second;
  }

  return { page: "form", formId, mode, itemId, siteId, applicationId, tenantId, draftId };
}

/** Reads the real browser location — the only place in this module that touches `window`. */
export function parseCurrentRoute(): Route {
  return parseRoute(window.location.hash, window.location.search);
}

/**
 * Parses a `/view` location. The hash is just `#{viewId}`. Missing any of
 * viewId / siteId / applicationId yields an UnresolvedRoute so entry-view.ts
 * can bounce to /switcher exactly like /form does.
 */
export function parseViewRoute(hash: string, search: string): ViewRoute | UnresolvedRoute {
  const params = new URLSearchParams(search);
  const siteId = params.get("siteId") ?? undefined;
  const applicationId = params.get("applicationId") ?? undefined;
  const tenantId = params.get("tenantId") ?? undefined;
  const rawViewId = hash.replace(/^#/, "").split("/").filter(Boolean)[0];
  // A view id must be a simple slug — it's interpolated into a Graph drive
  // path (`skye_data/views/<id>/...`), so `..` or a slash would be traversal.
  const viewId = rawViewId && /^[A-Za-z0-9_-]+$/.test(rawViewId) ? rawViewId : undefined;

  if (!viewId || !siteId || !applicationId) {
    return { page: "unresolved", siteId, applicationId, tenantId };
  }
  return { page: "view", viewId, siteId, applicationId, tenantId };
}

/** Reads the real browser location for the `/view` page. */
export function parseCurrentViewRoute(): ViewRoute | UnresolvedRoute {
  return parseViewRoute(window.location.hash, window.location.search);
}

/** Adds tenantId to a URLSearchParams if present — shared by every builder below, since it's always optional and always carried forward verbatim otherwise unchanged. */
function withTenantId(params: URLSearchParams, tenantId: string | undefined): URLSearchParams {
  if (tenantId) params.set("tenantId", tenantId);
  return params;
}

/**
 * Builds the /switcher URL to bounce to when /form can't resolve a route
 * (missing siteId and/or formId). Carries forward whatever siteId/
 * applicationId/tenantId were already in the query string, and preserves
 * the current hash untouched (formId/mode, if the URL had one) so the
 * switcher can pick up exactly where /form left off — see entry-form.ts
 * and entry-switcher.ts.
 */
export function buildSwitcherRedirectUrl(siteId: string | undefined, applicationId: string | undefined, tenantId: string | undefined, hash: string): string {
  const params = new URLSearchParams();
  if (siteId) params.set("siteId", siteId);
  if (applicationId) params.set("applicationId", applicationId);
  withTenantId(params, tenantId);
  const query = params.toString();
  return `/switcher${query ? `?${query}` : ""}${hash}`;
}

/**
 * Builds the /form URL to navigate to once a site has been chosen on the
 * switcher — fills in siteId and applicationId while preserving whatever
 * hash (formId/mode) was already present in the switcher's own URL.
 */
export function buildFormUrlForSelectedSite(siteId: string, applicationId: string, tenantId: string | undefined, hash: string): string {
  const params = withTenantId(new URLSearchParams({ siteId, applicationId }), tenantId);
  return `/form?${params.toString()}${hash}`;
}

/**
 * Builds the /switcher URL to move from step 1 (site chosen) to step 2
 * (pick a form on that site) — used when the switcher was reached with no
 * formId at all, so there's nothing yet to send back to /form.
 */
export function buildSwitcherUrlForSite(siteId: string, applicationId: string, tenantId: string | undefined): string {
  const params = withTenantId(new URLSearchParams({ siteId, applicationId }), tenantId);
  return `/switcher?${params.toString()}`;
}

/**
 * Builds the /form URL to navigate to once a form has been chosen on the
 * switcher's step 2 (site already known, no formId at all beforehand) —
 * defaults to create mode, since there's no existing item to edit/view yet.
 */
export function buildFormUrlForSelectedForm(siteId: string, applicationId: string, tenantId: string | undefined, formId: string): string {
  const params = withTenantId(new URLSearchParams({ siteId, applicationId }), tenantId);
  return `/form?${params.toString()}#${formId}/new`;
}

/**
 * Builds a shareable `/form` draft-preview URL — what `/builder`'s "Copy
 * preview link" hands to a tester (see FormRoute's `draftId` doc comment).
 * Always create mode ("new") since a draft is about previewing the FORM,
 * not a specific existing item.
 */
export function buildDraftPreviewUrl(siteId: string, applicationId: string, tenantId: string | undefined, formId: string, draftId: string): string {
  const params = withTenantId(new URLSearchParams({ siteId, applicationId, draft: draftId }), tenantId);
  return `/form?${params.toString()}#${formId}/new`;
}

/**
 * Builds a `/view` URL for a view on a known site — used by the switcher's
 * view list and by host-mediated view→view navigation (same site only).
 */
export function buildViewUrl(siteId: string, applicationId: string, tenantId: string | undefined, viewId: string): string {
  const params = withTenantId(new URLSearchParams({ siteId, applicationId }), tenantId);
  return `/view?${params.toString()}#${viewId}`;
}

/**
 * Builds the /switcher URL to bounce to when /view can't resolve a route
 * (missing siteId). The wanted view id travels as a `?view=` param rather
 * than in the hash, so the switcher can tell "resume this view" apart from
 * "resume this form" (a hash formId) and from "browse from scratch".
 */
export function buildViewSwitcherRedirectUrl(
  siteId: string | undefined,
  applicationId: string | undefined,
  tenantId: string | undefined,
  viewId: string
): string {
  const params = new URLSearchParams();
  if (siteId) params.set("siteId", siteId);
  if (applicationId) params.set("applicationId", applicationId);
  withTenantId(params, tenantId);
  params.set("view", viewId);
  return `/switcher?${params.toString()}`;
}

/**
 * Builds a `/form` URL for a specific form on a known site, in a chosen
 * mode — used by host-mediated view→form navigation. `create` omits the
 * itemId; `edit`/`view` require one.
 */
export function buildFormUrl(
  siteId: string,
  applicationId: string,
  tenantId: string | undefined,
  formId: string,
  mode: FormMode,
  itemId?: string
): string {
  const params = withTenantId(new URLSearchParams({ siteId, applicationId }), tenantId);
  const modeSegment = mode === "create" || !itemId ? "new" : mode === "view" ? `${itemId}/view` : itemId;
  return `/form?${params.toString()}#${formId}/${modeSegment}`;
}

/**
 * True if a hash carries a formId segment (e.g. "#abc123" or "#abc123/45/view").
 * Used by entry-switcher.ts to decide which step to show: with a formId
 * already known, picking a site should go straight back to /form; with no
 * formId at all, picking a site should move on to picking a form instead
 * (see buildSwitcherUrlForSite) rather than bouncing back to /form with
 * still nothing to resolve there.
 */
export function hashHasFormId(hash: string): boolean {
  return hash.replace(/^#/, "").split("/").filter(Boolean).length > 0;
}

/**
 * True if a URL's hash/query looks like it's carrying form-routing info
 * (leftover from the old bare "/" + hash link shape) rather than a
 * context-free landing visit with nothing to redirect to. See entry-index.ts.
 */
export function looksLikeFormLink(hash: string, search: string): boolean {
  const hasHash = hash.replace(/^#/, "").length > 0;
  const hasQuery = new URLSearchParams(search).toString().length > 0;
  return hasHash || hasQuery;
}

export interface AuthError {
  error: string;
  /** Human-readable detail, when Azure AD included one — falls back to error_subcode (e.g. "cancel") when it didn't. */
  description?: string;
}

/**
 * Detects an OAuth/MSAL redirect-flow error callback in the hash (e.g.
 * "#error=access_denied&error_subcode=cancel&state=..."), returning null
 * for an ordinary SKYE hash (formId/mode). MSAL's redirectUri is the bare
 * origin (see authProvider.ts), so a failed redirect-fallback login always
 * lands here on `/` first — without this check, the error hash gets
 * silently misread as a garbage formId and bounced through several
 * unresolved-route redirects with no explanation at all. See entry-index.ts.
 */
export function parseAuthErrorFromHash(hash: string): AuthError | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("error");
  if (!error) return null;
  return { error, description: params.get("error_description") ?? params.get("error_subcode") ?? undefined };
}
