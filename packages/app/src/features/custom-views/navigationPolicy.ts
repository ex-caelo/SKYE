// Decides what a view's `skye.navigate(target)` is actually allowed to do.
// This is a MEDIATED capability, never a browser permission — the sandbox
// has no allow-top-navigation / allow-popups flag, so navigation only
// happens because the host chooses to perform it here.
//
// Rules (TODO §16, decisions B + C):
//   - internal SKYE view/form by id, same site only  -> host navigates its
//     own window; safe by construction. Replaces the current page unless
//     the target sets `newTab: true` (see openInNewTab below), e.g. for a
//     Cmd/Ctrl+click or middle-click a view wants to honor itself.
//   - external URL -> allowed ONLY if its exact origin is in the site
//     config's navigation.allowedExternalOrigins, and then opened in a new
//     tab with noopener,noreferrer so the SKYE app is never navigated away.
//   - anything else -> rejected with a stable code.
//
// A view can never get a real "open in new tab" from a native <a href> or
// window.open() of its own — without allow-popups, the browser blocks that
// regardless of how it's triggered (a click, Cmd/Ctrl+click, or the
// browser's own right-click "open in new tab" menu item, which also needs
// a real href the sandboxed frame can't safely be given — see
// viewHost.ts's "view navigated itself away" teardown for what happens if
// the frame tries to navigate on its own instead). `newTab` on an internal
// target is the mediated substitute: the VIEW decides (by inspecting the
// click event itself) that the gesture looked like "open in new tab", and
// asks the HOST to actually do it via window.open(), the same safe path
// an external URL already uses.

import { buildFormUrl, buildViewUrl } from "../../shared/routing.js";
import type { FormMode } from "../../shared/routing.js";

/** A view's requested navigation. Exactly one of `view` / `form` / `url`. */
export type NavigationTarget =
  | { view: string; params?: Record<string, string | number | boolean>; newTab?: boolean }
  | { form: string; itemId?: string; mode?: "edit" | "view"; params?: Record<string, string | number | boolean>; newTab?: boolean }
  | { url: string };

/** The site/app context the host builds internal URLs from. */
export interface NavigationContext {
  siteId: string;
  applicationId: string;
  tenantId?: string;
  allowedExternalOrigins: string[];
}

/**
 * What the host should do with a resolved navigation. `openInNewTab` is how a view asks for a
 * second gesture (Cmd/Ctrl+click, middle-click) on an internal target to behave like a real link
 * — see this file's own top-of-file comment on why that can't just be a real `<a href>` inside the
 * sandbox. Always true for `external` (unconditional today, same as before this field existed);
 * for `internal` it reflects whether the view's own target asked for it (defaults to false, i.e.
 * the existing "replace the current page" behavior).
 */
export type NavigationDecision =
  | { kind: "internal"; url: string; openInNewTab: boolean }
  | { kind: "external"; url: string; openInNewTab: true };

/** Thrown for a disallowed / malformed navigation. `code` is stable for the runtime and tests. */
export class NavigationError extends Error {
  code: string;
  constructor(message: string, code = "navBlocked") {
    super(message);
    this.name = "NavigationError";
    this.code = code;
  }
}

/** Ids and item ids must be simple slugs — no path separators, no traversal, no whitespace. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Resolves a navigation target against the policy. Throws NavigationError if it isn't allowed. */
export function resolveNavigation(target: unknown, ctx: NavigationContext): NavigationDecision {
  if (!target || typeof target !== "object") {
    throw new NavigationError("navigate() needs a target object");
  }
  const t = target as Record<string, unknown>;

  // --- internal: another view on the same site ---
  if ("view" in t) {
    if (typeof t.view !== "string" || !SAFE_ID.test(t.view)) {
      throw new NavigationError("view id must be a simple slug");
    }
    // `params` are accepted for forward-compat but not yet encoded into the URL —
    // per-view state in the URL is out of scope for this pass (CUSTOM-VIEWS-SPEC.md §5).
    return { kind: "internal", url: buildViewUrl(ctx.siteId, ctx.applicationId, ctx.tenantId, t.view), openInNewTab: t.newTab === true };
  }

  // --- internal: a form on the same site ---
  if ("form" in t) {
    if (typeof t.form !== "string" || !SAFE_ID.test(t.form)) {
      throw new NavigationError("form id must be a simple slug");
    }
    let mode: FormMode = "create";
    let itemId: string | undefined;
    if (t.itemId !== undefined) {
      if (typeof t.itemId !== "string" || !SAFE_ID.test(t.itemId)) {
        throw new NavigationError("itemId must be a simple slug");
      }
      itemId = t.itemId;
      mode = t.mode === "view" ? "view" : "edit";
    } else if (t.mode !== undefined) {
      throw new NavigationError("mode needs an itemId to go with it");
    }
    return { kind: "internal", url: buildFormUrl(ctx.siteId, ctx.applicationId, ctx.tenantId, t.form, mode, itemId), openInNewTab: t.newTab === true };
  }

  // --- external: only an allowlisted origin, opened in a new tab ---
  if ("url" in t) {
    if (typeof t.url !== "string") throw new NavigationError("url must be a string");
    let parsed: URL;
    try {
      parsed = new URL(t.url);
    } catch {
      throw new NavigationError("url is not a valid absolute URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new NavigationError(`unsupported url scheme: ${parsed.protocol}`);
    }
    if (!ctx.allowedExternalOrigins.includes(parsed.origin)) {
      throw new NavigationError(`external navigation to ${parsed.origin} is not on this site's allowlist`);
    }
    return { kind: "external", url: parsed.toString(), openInNewTab: true };
  }

  throw new NavigationError("target must have one of: view, form, url");
}
