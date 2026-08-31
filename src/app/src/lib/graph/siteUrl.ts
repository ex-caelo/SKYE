// Turns whatever a user pastes into the "set up SKYE on another site" box
// into something GraphClient.resolveSiteByUrl can act on. People rarely
// have the tidy site root handy — they copy the page they're looking at
// (a library view, a page, a settings screen) or a Teams channel link.

/** An anchored GUID matcher for a Teams link's `groupId`. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SharePoint "managed paths" that precede a site name — everything after `/{managed}/{name}` is inside the site, not the site itself. */
const MANAGED_PATHS = new Set(["sites", "teams"]);

export type PastedSiteRef =
  | {
      kind: "sharepoint";
      hostname: string;
      /** "" for a root site, otherwise "sites/Foo" / "teams/Bar". */
      sitePath: string;
    }
  | { kind: "groupId"; groupId: string };

/**
 * Parses a pasted string into a site reference, or null if it isn't
 * something we can resolve.
 *
 * - A SharePoint URL is reduced to its site root: the host plus, if
 *   present, `/{sites|teams}/{name}` — dropping any library / page /
 *   `_layouts` path that follows (e.g.
 *   `…/sites/msteams_79e519/Shared Documents/Forms/AllItems.aspx` →
 *   `…/sites/msteams_79e519`). No `/sites/` or `/teams/` segment means the
 *   tenant root site.
 * - A Teams deep link (`teams.microsoft.com/l/…?groupId=<guid>`) yields the
 *   backing M365 group id, which resolveSiteByUrl turns into the group's
 *   SharePoint site.
 */
export function parsePastedSiteUrl(input: string): PastedSiteRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  // --- Teams deep link -> the backing group id ---
  if (/^teams\.microsoft\.(com|us)$/i.test(url.hostname)) {
    const groupId = url.searchParams.get("groupId");
    return groupId && GUID.test(groupId) ? { kind: "groupId", groupId } : null;
  }

  // --- SharePoint URL -> the site root ---
  if (/\.sharepoint\.(com|us)$/i.test(url.hostname)) {
    const segments = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    if (segments[1] && MANAGED_PATHS.has(segments[0].toLowerCase())) {
      return { kind: "sharepoint", hostname: url.hostname, sitePath: `${segments[0].toLowerCase()}/${segments[1]}` };
    }
    return { kind: "sharepoint", hostname: url.hostname, sitePath: "" };
  }

  return null;
}

/** The tidy site root URL for a SharePoint ref (used for display + fixture matching). */
export function siteRootUrl(ref: Extract<PastedSiteRef, { kind: "sharepoint" }>): string {
  return ref.sitePath ? `https://${ref.hostname}/${ref.sitePath}` : `https://${ref.hostname}`;
}

/**
 * True if a SharePoint list is the site's Site Assets library. Matched on
 * `list.name` (the URL segment — always "SiteAssets") and the webUrl slug,
 * NOT the display name, which is localized ("Site Assets", "Activos del
 * sitio", …). Also note `GET /sites/{id}/drives` can omit Site Assets, so
 * the resolver goes through `GET /sites/{id}/lists`.
 */
export function isSiteAssetsList(list: { name?: string; displayName?: string; webUrl?: string }): boolean {
  if (list.name === "SiteAssets") return true;
  try {
    if (/\/SiteAssets\/?$/i.test(new URL(list.webUrl ?? "").pathname)) return true;
  } catch {
    /* not a URL */
  }
  return list.displayName === "Site Assets";
}
