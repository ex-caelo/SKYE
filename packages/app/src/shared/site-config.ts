// Site-wide SKYE configuration (`skye_data/config/skye.config.json`, in the
// site's Site Assets library) as it applies to Custom Views. This file owns
// the SHAPE of that config, how a base file and its `[permission]` overlays
// combine, and the "not set up yet" failure mode.
//
// IMPORTANT — this config is a shape/vocabulary guardrail, NOT a permission
// boundary. Widening `views.allowedLists` does not grant anyone access to a
// list they couldn't already open in SharePoint: every read a view makes
// still runs as the viewing user's own delegated Graph token, and
// SharePoint authorizes it per-user regardless of what's listed here. The
// allowlist's real job is stopping structural attacks (arbitrary list
// names, malformed queries) — see CUSTOM-VIEWS-SPEC.md §4.2.

import type { SkyeSiteConfigFile } from "./sharepoint/types.js";

/** Where a bare site visit should land, if the site's config names one. */
export interface SkyeHomeDestination {
  type: "view" | "form";
  id: string;
}

/** The resolved, normalized site config the view host runs against. */
export interface SkyeSiteConfig {
  views: {
    /** List names a Custom View on this site is allowed to name in `skye.list()` / `skye.item()` / `skye.schema()`. */
    allowedLists: string[];
  };
  navigation: {
    /** Exact origins (`https://host[:port]`) a view may `skye.navigate()` to externally. Anything else is rejected. */
    allowedExternalOrigins: string[];
  };
  /** Optional: a bare site visit auto-navigates here; the switcher is only shown when this is absent. */
  home?: SkyeHomeDestination;
  /**
   * Names of `[permission]` overlay folders (matching the SAME folder names
   * used under `skye_data/config/` and `skye_data/forms/[id]/`) that grant
   * `/builder` edit access for every form on this site. A signed-in user can
   * edit form configs if they can currently READ (via normal SharePoint
   * folder ACLs) any ONE of these overlay folders under
   * `skye_data/config/` — see lib/builder/permissions.ts. Additive across
   * overlays, same as `allowedLists`/`allowedExternalOrigins`: a
   * higher-permission overlay can only ever grant more names, never remove
   * one a lower overlay already declared.
   */
  builderEditors: string[];
}

/**
 * The minimal, valid `skye.config.json` written when SKYE is first
 * installed on a site (see GraphClient.installSkyeSiteConfig). Everything
 * is an empty allowlist — an owner opens things up from here. `home` is
 * omitted, so the switcher shows the form/view picker rather than
 * redirecting anywhere.
 */
export const DEFAULT_SITE_CONFIG = {
  views: { allowedLists: [] as string[] },
  navigation: { allowedExternalOrigins: [] as string[] },
  builderEditors: [] as string[],
};

/**
 * Thrown when a site's Site Assets library has no
 * `skye_data/config/skye.config.json` (or no Site Assets library at all).
 * entry-view / entry-switcher catch this and render a plain "SKYE isn't
 * set up yet" page rather than a stack trace.
 */
export class SkyeNotConfiguredError extends Error {
  constructor(message = "This site's Site Assets library has no skye_data/config/skye.config.json — SKYE isn't set up here yet.") {
    super(message);
    this.name = "SkyeNotConfiguredError";
  }
}

/** Narrows unknown parsed JSON to a string array, dropping anything that isn't a string. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Reads a `home` destination out of raw config, or undefined if it's absent/malformed. */
function readHome(raw: Record<string, unknown> | undefined): SkyeHomeDestination | undefined {
  const home = raw?.home;
  if (!home || typeof home !== "object") return undefined;
  const { type, id } = home as Record<string, unknown>;
  if ((type === "view" || type === "form") && typeof id === "string" && id.length > 0) {
    return { type, id };
  }
  return undefined;
}

/**
 * Combines a base `skye.config.json` with zero or more `[permission]`
 * overlays into one normalized SkyeSiteConfig.
 *
 * Overlays are ADDITIVE-ONLY (TODO §16, Q3): the allowlist arrays are
 * unioned across the base and every overlay, so a higher-permission
 * overlay can only ever grant a view MORE vocabulary, never take any away.
 * Scalar keys (`home`) take the last-defined value, so an admin overlay
 * can point admins at a different landing destination.
 */
export function resolveSiteConfig(files: SkyeSiteConfigFile[]): SkyeSiteConfig {
  const base = files.find((f) => f.source === "base");
  if (!base) throw new SkyeNotConfiguredError();

  // Order overlays deterministically by folder name, same convention as form overlays (TODO §5).
  const overlays = files.filter((f) => f.source !== "base").sort((a, b) => a.source.localeCompare(b.source));
  const layers = [base, ...overlays].map((f) => (f.config ?? {}) as Record<string, unknown>);

  const allowedLists = new Set<string>();
  const allowedExternalOrigins = new Set<string>();
  const builderEditors = new Set<string>();
  let home: SkyeHomeDestination | undefined;

  for (const layer of layers) {
    const views = (layer.views ?? {}) as Record<string, unknown>;
    const navigation = (layer.navigation ?? {}) as Record<string, unknown>;
    for (const name of toStringArray(views.allowedLists)) allowedLists.add(name);
    for (const origin of toStringArray(navigation.allowedExternalOrigins)) allowedExternalOrigins.add(origin);
    for (const name of toStringArray(layer.builderEditors)) builderEditors.add(name);
    const layerHome = readHome(layer);
    if (layerHome) home = layerHome; // last layer wins
  }

  return {
    views: { allowedLists: [...allowedLists] },
    navigation: { allowedExternalOrigins: [...allowedExternalOrigins] },
    home,
    builderEditors: [...builderEditors],
  };
}

/**
 * Whether the signed-in user may edit form configs on this site via
 * `/builder`: true if any `[permission]` overlay folder they can currently
 * see (per normal SharePoint ACLs — `files` is whatever
 * `getSkyeSiteConfigFiles` actually returned, which only includes overlays
 * Graph let this user read) is named in the resolved `builderEditors` list.
 * Deliberately reads the RAW file sources (not the merged SkyeSiteConfig)
 * because "which overlay(s) can I see" is exactly the ACL signal being
 * checked — the same mechanism this app already uses everywhere else for
 * permission-gated visibility (TODO §5), just read here instead of merged
 * away.
 */
export function canEditFormConfigs(files: SkyeSiteConfigFile[]): boolean {
  const config = resolveSiteConfig(files);
  if (config.builderEditors.length === 0) return false;
  const visibleOverlayNames = files.filter((f) => f.source !== "base").map((f) => f.source);
  return visibleOverlayNames.some((name) => config.builderEditors.includes(name));
}
