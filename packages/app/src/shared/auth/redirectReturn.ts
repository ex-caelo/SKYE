// Survives the MSAL loginRedirect round-trip.
//
// When a blocked popup forces `loginRedirect`, AAD sends the browser to the
// app registration's FIXED redirect URI and comes back with `#code=…` in
// the fragment — the original `?applicationId=`/`?tenantId=`/`?siteId=`
// query string is gone. The entry scripts need `applicationId` to do
// anything, so they'd error out before `handleRedirectPromise()` ever runs
// and the sign-in would never complete.
//
// Fix: stash the full pre-redirect URL in sessionStorage right before
// `loginRedirect`, and on the landing page finish the token exchange (with
// a throwaway MSAL instance built from the stashed client id) then navigate
// back to exactly where the user started — now with a cached account, so
// the retry acquires a token silently.

import { PublicClientApplication } from "@azure/msal-browser";

const RETURN_KEY = "skye:auth:returnHref";

/** Call immediately before `msal.loginRedirect()`. */
export function rememberRedirectReturn(): void {
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.href);
  } catch {
    // sessionStorage unavailable — the flow will still complete via MSAL's `state` fallback below,
    // or land on the bare redirect URI. Nothing more we can do here.
  }
}

/** True if a location hash is an MSAL redirect-flow response (`#code=…&state=…` or `#error=…&state=…`). */
export function isRedirectResponseHash(hash: string): boolean {
  return /[#&](code|error|id_token)=/.test(hash) && /[#&]state=/.test(hash);
}

/** A safe `new URL()` that returns null instead of throwing. */
function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Scans MSAL's own `msal.<clientId>.…` sessionStorage keys to recover a client id when we have no stash. */
function findClientIdInMsalCache(): string | undefined {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const match = (sessionStorage.key(i) ?? "").match(/^msal\.([0-9a-fA-F-]{36})\./);
      if (match) return match[1];
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * If this page load is the landing from an MSAL `loginRedirect` (a
 * `#code=…&state=…` fragment), complete the token exchange and navigate
 * back to the pre-redirect URL. Returns true when it's handling a redirect
 * — the caller must stop immediately, since a navigation is imminent.
 */
export async function completeRedirectReturn(): Promise<boolean> {
  const rawHash = window.location.hash;
  if (!isRedirectResponseHash(rawHash)) return false;

  const isError = /[#&]error=/.test(rawHash);

  let returnHref: string | null = null;
  try {
    returnHref = sessionStorage.getItem(RETURN_KEY);
  } catch {
    // ignore
  }

  const stashed = returnHref ? safeUrl(returnHref) : null;
  const clientId = stashed?.searchParams.get("applicationId") ?? findClientIdInMsalCache();

  if (clientId) {
    const tenantId = stashed?.searchParams.get("tenantId") ?? undefined;
    const msal = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId ?? "common"}`,
        redirectUri: window.location.origin,
        // We navigate back ourselves, deterministically — don't let MSAL race us to it.
        navigateToLoginRequestUrl: false,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    try {
      await msal.initialize();
      const result = await msal.handleRedirectPromise();
      // `state` was set to the pre-redirect href in authProvider.ts — use it if the stash is gone.
      if (!returnHref && result?.state && /^https?:\/\//.test(result.state)) returnHref = result.state;
    } catch (err) {
      console.warn("Could not complete the sign-in redirect:", err);
    }
  }

  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // ignore
  }

  if (isError) {
    // Consent denied / cancelled / interrupted. Send to the root with ONLY error/description
    // in the hash (no `state`) so this function no-ops on the reload and entry-index.ts's
    // "Sign-in didn't complete" message shows — rather than bouncing into a retry loop.
    const src = new URLSearchParams(rawHash.replace(/^#/, ""));
    const kept = new URLSearchParams();
    if (src.get("error")) kept.set("error", src.get("error")!);
    const desc = src.get("error_description") ?? src.get("error_subcode");
    if (desc) kept.set("error_description", desc);
    window.location.replace(`/#${kept.toString()}`);
  } else {
    window.location.replace(returnHref ?? window.location.pathname);
  }
  return true;
}
