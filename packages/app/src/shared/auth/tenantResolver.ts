// Self-healing tenant resolution for single-tenant Azure app registrations.
//
// The problem: a single-tenant app registration REJECTS the /common
// authority outright (AADSTS50194), so we must know the tenant id BEFORE
// the first token call. The URL's `?tenantId=` and a deploy-time
// `PUBLIC_DEFAULT_TENANT_ID` both cover it — but a bare link with neither,
// on a deployment that never set the env var, used to be a dead end.
//
// This module closes that: after any successful sign-in we cache the real
// tenant id (from the MSAL result) in localStorage and rewrite the address
// bar to carry `?tenantId=`, so the link "heals" for next time. And on a
// first-ever visit that hits AADSTS50194, we ask the user for their work
// email, resolve it to a tenant id via Entra's unauthenticated OIDC
// discovery document, then retry.
//
// A tenant GUID is not a secret — it appears in every token, URL, and
// discovery document — so caching it in localStorage is fine.
//
// This module also remembers applicationId (an Azure app registration's
// client id, equally non-secret) the same way, and exposes
// resolveApplicationAndTenantId() as the one place both get recovered
// together — see that function's own doc comment for why URL and cache
// win/lose the way they do.

/** localStorage key for the remembered tenant id, per app registration. */
const CACHE_PREFIX = "skye:auth:tenant:";
/** localStorage key for the remembered applicationId — the last one a real URL on this browser used. */
const APPLICATION_ID_CACHE_KEY = "skye:auth:applicationId";
/** A tenant GUID anywhere in a string. */
export const TENANT_GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Entra's fixed "consumers" tenant (personal Microsoft accounts) — never a work/school tenant. */
const CONSUMERS_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

/** The remembered tenant id for this app registration, if a previous sign-in cached one. */
export function getCachedTenantId(applicationId: string): string | undefined {
  try {
    return localStorage.getItem(CACHE_PREFIX + applicationId) ?? undefined;
  } catch {
    return undefined; // storage disabled (private mode) — just means no fast path
  }
}

/** Remembers a tenant id so future visits with a bare link resolve instantly. */
export function cacheTenantId(applicationId: string, tenantId: string): void {
  try {
    localStorage.setItem(CACHE_PREFIX + applicationId, tenantId);
  } catch {
    // storage disabled — the URL backfill still helps within this session
  }
}

/** Forgets the remembered tenant id — used when the cached value turns out to be wrong (AAD rejected it). */
export function clearCachedTenantId(applicationId: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + applicationId);
  } catch {
    // storage disabled — nothing to clear
  }
}

/**
 * Rewrites the address bar to carry `?tenantId=<id>` (hash and everything
 * else preserved), with no navigation — so the link the user copies from
 * their address bar, or lands on next time, already has the tenant.
 */
export function backfillTenantIdInUrl(tenantId: string): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tenantId") === tenantId) return;
    url.searchParams.set("tenantId", tenantId);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    // no window.history / restricted context — this is cosmetic, not load-bearing
  }
}

/**
 * The last applicationId a real URL on this browser successfully used, if any — lets a later URL
 * that's lost `?applicationId=` (e.g. an MSAL redirect round-trip that couldn't recover the
 * pre-redirect URL and fell back to the bare origin — see pages/auth.astro's own docstring)
 * recover it instead of dead-ending. An Azure app registration's client id isn't a secret (it's
 * public in every token/URL), so caching it in localStorage is fine — same reasoning as the
 * tenant id cache above.
 */
export function getCachedApplicationId(): string | undefined {
  try {
    return localStorage.getItem(APPLICATION_ID_CACHE_KEY) ?? undefined;
  } catch {
    return undefined; // storage disabled (private mode) — just means no fast path
  }
}

/** Remembers an applicationId a real URL provided, so a later URL that loses it can recover it. */
export function cacheApplicationId(applicationId: string): void {
  try {
    localStorage.setItem(APPLICATION_ID_CACHE_KEY, applicationId);
  } catch {
    // storage disabled — nothing persists, just no fast path next time
  }
}

/** Rewrites the address bar to carry `?applicationId=<id>` — same idea as backfillTenantIdInUrl, for the same reason. */
export function backfillApplicationIdInUrl(applicationId: string): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("applicationId") === applicationId) return;
    url.searchParams.set("applicationId", applicationId);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    // no window.history / restricted context — this is cosmetic, not load-bearing
  }
}

/**
 * Resolves applicationId/tenantId for one page load, in the order this app already used at each
 * call site: URL query param -> that page's own build-time default (if it has one) -> whatever
 * this browser last used successfully. A value recovered from the cache is backfilled into the
 * address bar (no navigation), so a link copied from here already carries it forward; the
 * env-default case is deliberately never backfilled — it's already free, always available
 * without the URL needing to say so.
 *
 * The two ids are NOT treated symmetrically for caching: a genuinely URL-provided applicationId
 * is remembered here directly (`cacheApplicationId`) — it's not a secret and a wrong value fails
 * no worse than a missing one already would. A genuinely URL-provided tenantId is deliberately
 * NOT cached here — only a tenant id a real, successful sign-in actually confirmed gets
 * remembered (`rememberTenantFromResult`, elsewhere), so a wrong or typo'd `?tenantId=` in some
 * copied link can never poison this browser's cache for a later, different visit.
 *
 * `envDefaults` is each caller's own existing fallback (`PUBLIC_DEFAULT_APPLICATION_ID`/
 * `PUBLIC_DEFAULT_TENANT_ID`), passed in rather than read here, since not every page used the
 * same defaults before this existed (`/form` and `/view` never did, only `/switcher`/`/builder`
 * did) — this only adds the cache layer, it doesn't change which pages accept an env default.
 */
export function resolveApplicationAndTenantId(
  search: string,
  envDefaults: { applicationId?: string; tenantId?: string } = {}
): { applicationId: string | undefined; tenantId: string | undefined } {
  const params = new URLSearchParams(search);

  const urlApplicationId = params.get("applicationId") ?? undefined;
  let applicationId = urlApplicationId ?? envDefaults.applicationId;
  if (urlApplicationId) {
    cacheApplicationId(urlApplicationId);
  } else if (!applicationId) {
    const cached = getCachedApplicationId();
    if (cached) {
      applicationId = cached;
      backfillApplicationIdInUrl(cached);
    }
  }

  const urlTenantId = params.get("tenantId") ?? undefined;
  let tenantId = urlTenantId ?? envDefaults.tenantId;
  if (!tenantId && applicationId) {
    const cached = getCachedTenantId(applicationId);
    if (cached) {
      tenantId = cached;
      backfillTenantIdInUrl(cached);
    }
  }

  return { applicationId, tenantId };
}

/**
 * Resolves a work email (or bare domain) to its Entra tenant GUID via the
 * tenant's unauthenticated OpenID Connect discovery document. Returns null
 * if the domain isn't a Microsoft 365 work/school tenant, or on any network
 * error — the caller re-prompts.
 */
export async function discoverTenantIdFromDomain(emailOrDomain: string): Promise<string | null> {
  const domain = emailOrDomain.trim().toLowerCase().split("@").pop();
  if (!domain || !domain.includes(".")) return null;

  let res: Response;
  try {
    res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(domain)}/v2.0/.well-known/openid-configuration`);
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const doc = (await res.json().catch(() => null)) as { issuer?: string; token_endpoint?: string } | null;
  // The issuer is `https://login.microsoftonline.com/<GUID>/v2.0` for a real tenant.
  const guid = (doc?.issuer ?? doc?.token_endpoint ?? "").match(TENANT_GUID_RE)?.[0]?.toLowerCase();
  if (!guid || guid === CONSUMERS_TENANT) return null;
  return guid;
}

/**
 * Shows a small modal asking for the user's work email / domain, and
 * resolves with what they enter. Rejects if they cancel. Self-contained
 * styling so it works identically on /form, /view, and /switcher.
 */
export function promptForTenantDomain(errorMessage?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,0.45);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;";

    const card = document.createElement("form");
    card.style.cssText =
      "background:#fff;color:#1a1a1a;max-width:26rem;width:calc(100% - 2rem);padding:1.5rem;border-radius:8px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,0.25);display:flex;flex-direction:column;gap:0.75rem;";

    const h = document.createElement("h2");
    h.textContent = "Which Microsoft 365 organization?";
    h.style.cssText = "margin:0;font-size:1.1rem;";

    const p = document.createElement("p");
    p.textContent = "Enter your work email so we can sign you in to the right tenant.";
    p.style.cssText = "margin:0;font-size:0.9rem;color:#555;";

    const input = document.createElement("input");
    input.type = "email";
    input.placeholder = "you@yourcompany.com";
    input.autocomplete = "email";
    input.required = true;
    input.style.cssText = "font:inherit;padding:0.5rem 0.6rem;border:1px solid #bbb;border-radius:4px;";

    const err = document.createElement("p");
    err.style.cssText = "margin:0;font-size:0.85rem;color:#b91c1c;min-height:1em;";
    if (errorMessage) err.textContent = errorMessage;

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:0.5rem;justify-content:flex-end;";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.style.cssText = "font:inherit;padding:0.45rem 1rem;border:1px solid #bbb;border-radius:4px;background:#f5f5f5;cursor:pointer;";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Continue";
    submit.style.cssText = "font:inherit;padding:0.45rem 1rem;border:none;border-radius:4px;background:#2563eb;color:#fff;cursor:pointer;";

    const cleanup = () => overlay.remove();
    card.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      cleanup();
      resolve(value);
    });
    cancel.addEventListener("click", () => {
      cleanup();
      reject(new Error("Sign-in cancelled: no Microsoft 365 organization was chosen."));
    });

    row.append(cancel, submit);
    card.append(h, p, input, err, row);
    overlay.append(card);
    document.body.append(overlay);
    input.focus();
  });
}

/**
 * Full interactive resolution: prompt → discover → cache + backfill,
 * re-prompting on a bad domain. Throws if the user cancels or after too
 * many failed attempts.
 */
export async function resolveTenantInteractively(applicationId: string): Promise<string> {
  let errorMessage: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const entered = await promptForTenantDomain(errorMessage);
    const tenantId = await discoverTenantIdFromDomain(entered);
    if (tenantId) {
      cacheTenantId(applicationId, tenantId);
      backfillTenantIdInUrl(tenantId);
      return tenantId;
    }
    errorMessage = `Couldn't find a Microsoft 365 organization for "${entered}". Try your full work email address.`;
  }
  throw new Error("Could not determine your Microsoft 365 tenant.");
}

/** True if an MSAL/AAD error is "this single-tenant app can't use the /common (or /organizations) endpoint". */
export function isCommonEndpointUnsupported(err: unknown): boolean {
  const message =
    (err as { errorMessage?: string })?.errorMessage ??
    (err as { message?: string })?.message ??
    String(err ?? "");
  return message.includes("AADSTS50194") || message.includes("AADSTS50059");
}
