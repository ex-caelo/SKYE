import { PublicClientApplication, InteractionRequiredAuthError, type AuthenticationResult } from "@azure/msal-browser";
import type { AuthenticationProvider } from "@microsoft/microsoft-graph-client";
import {
  backfillTenantIdInUrl,
  cacheTenantId,
  clearCachedTenantId,
  getCachedTenantId,
  isCommonEndpointUnsupported,
  resolveTenantInteractively,
  TENANT_GUID_RE,
} from "./tenantResolver.js";
import { rememberRedirectReturn } from "./redirectReturn.js";

/**
 * Whether to try the `/common` authority when no tenant id is known,
 * instead of asking the user for their work email. `/common` only works for
 * an actually-multi-tenant Azure app registration; a single-tenant one
 * dead-ends on an AADSTS50194 error page that MSAL can't read back (the
 * popup just closes as "user_cancelled"), so the default is to ask. A
 * multi-tenant deployment sets PUBLIC_AUTH_ALLOW_COMMON=1 to opt back in.
 */
function commonFallbackAllowed(): boolean {
  return import.meta.env.PUBLIC_AUTH_ALLOW_COMMON === "1" || import.meta.env.PUBLIC_AUTH_ALLOW_COMMON === "true";
}

// The scopes requested in every interactive token acquisition. A Graph access token carries
// EXACTLY the scopes asked for at acquisition — not whatever is admin-consented on the app
// registration overall — and MSAL requests this whole set in ONE token call, so a single scope
// that needs ungranted admin consent fails the entire sign-in. This list is therefore kept to
// scopes CONFIRMED available on the target tenant (see CLAUDE.md's "Real-tenant Graph
// permissions" section, tested via pages/diag.astro):
//
//   Sites.Selected      - all list/library access. Narrower than Sites.ReadWrite.All on purpose;
//                         the app has ZERO site access until a SharePoint admin grants it per-site
//                         (SharePoint Admin Center "API access", or a Sites.FullControl.All
//                         POST /sites/{id}/permissions made out of band). This also limits
//                         searchSitesWithSkyeData() to already-granted sites — see TODO §13.
//   User.ReadBasic.All  - searchPeople / the peoplePicker's directory search.
//   Chat.Create,
//   ChatMessage.Send    - teams.createChat / teams.sendMessage.
//   Mail.Send           - outlook.sendEmail.
//
// DELIBERATELY EXCLUDED: Calendars.ReadWrite.Shared (and every other Calendars.* / OnlineMeetings /
// Tasks scope). Calendars.ReadWrite.Shared is CONFIRMED blocked on the IU tenant (needs admin
// consent that hasn't been granted); the rest showed user_cancelled in isolation and are treated
// as unavailable. Including any of them here would break sign-in for everyone. Consequence:
// teams.scheduleMeeting and outlook.createCalendarEvent fail at runtime — use the documented
// redirect / deep-link workaround (outlook.buildCalendarEventDeepLink) instead. If IU ever grants
// a calendar scope, add exactly that one back here (and re-test the combined sign-in).
//
// Exported so diag.astro's per-scope probes test exactly this list without a second copy drifting.
export const GRAPH_SCOPES = ["Sites.Selected", "User.ReadBasic.All", "Chat.Create", "ChatMessage.Send", "Mail.Send"];

// One MSAL instance per (applicationId, tenantId) pair, since the Azure app
// registration's client ID comes from the URL (?applicationId=) rather than
// being a build-time constant — see TODO §4/§13. `tenantId` (also
// URL-sourced, ?tenantId=, with a PUBLIC_DEFAULT_TENANT_ID fallback — see
// entry-form.ts/entry-switcher.ts) picks the authority: a single-tenant
// Azure app registration REJECTS the /common endpoint outright
// (AADSTS50194) — confirmed against a real tenant, not just a theoretical
// gap — so /common is only a safe default for an actually-multi-tenant
// app registration, never assumed otherwise.
const msalInstances = new Map<string, PublicClientApplication>();

function getMsalInstance(applicationId: string, tenantId: string | undefined): PublicClientApplication {
  const key = `${applicationId}::${tenantId ?? "common"}`;
  let instance = msalInstances.get(key);
  if (!instance) {
    instance = new PublicClientApplication({
      auth: {
        clientId: applicationId,
        authority: `https://login.microsoftonline.com/${tenantId ?? "common"}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    msalInstances.set(key, instance);
  }
  return instance;
}

/** Shared first step for both acquireToken and acquireTokenPopupOnly: initialize, clear any pending redirect state, and try silent acquisition against the first cached account (if any). Returns the full AuthenticationResult (so the caller can read `tenantId`), or null when silent acquisition genuinely needs interaction — any OTHER error still propagates. */
async function initAndTrySilent(msal: PublicClientApplication, scopes: string[]): Promise<AuthenticationResult | null> {
  await msal.initialize();
  // Processes (and critically, CLEARS) any pending redirect response left over from a previous
  // loginRedirect fallback. Without this, an interrupted/failed redirect round-trip leaves MSAL's
  // sessionStorage-persisted "interaction in progress" flag stuck forever for this tab — every
  // subsequent acquireToken call then fails immediately with `interaction_in_progress`, regardless
  // of whether the original admin-consent/site-permission problem is even still an issue. Found via
  // exactly that stuck state during real-tenant debugging — safe/idempotent to call even when
  // there's no pending redirect (resolves to null immediately). A returned result here is a
  // completed redirect-flow sign-in, which we DO want to surface so its tenantId gets cached.
  const redirectResult = await msal.handleRedirectPromise();
  if (redirectResult) return redirectResult;

  const account = msal.getAllAccounts()[0];
  if (!account) return null;

  try {
    return await msal.acquireTokenSilent({ scopes, account });
  } catch (err) {
    if (!(err instanceof InteractionRequiredAuthError)) throw err;
    return null; // fall through to interactive acquisition
  }
}

/** Caches + backfills the tenant id from a successful sign-in, so a bare link resolves instantly next time (see tenantResolver.ts). */
function rememberTenantFromResult(applicationId: string, result: AuthenticationResult): void {
  const tid = result.tenantId || result.account?.tenantId;
  if (tid && TENANT_GUID_RE.test(tid)) {
    cacheTenantId(applicationId, tid);
    backfillTenantIdInUrl(tid);
  }
}

/**
 * The core acquire flow against ONE authority: silent → popup → redirect.
 * `tenantId` is always a real tenant id here (never undefined) UNLESS a
 * multi-tenant deployment opted into `/common` — so the redirect fallback
 * is only taken when we actually have a tenant (a blocked popup is then the
 * likely cause and redirect genuinely helps); with no tenant we rethrow so
 * acquireToken can recover by asking for the work email instead of
 * dead-ending on an AADSTS50194 error page mid-navigation.
 */
async function acquireWithTenant(applicationId: string, tenantId: string | undefined, scopes: string[]): Promise<string> {
  const msal = getMsalInstance(applicationId, tenantId);

  const silent = await initAndTrySilent(msal, scopes);
  if (silent) {
    rememberTenantFromResult(applicationId, silent);
    return silent.accessToken;
  }

  try {
    const result = await msal.loginPopup({ scopes });
    rememberTenantFromResult(applicationId, result);
    return result.accessToken;
  } catch (popupErr) {
    // No real tenant to fall back on -> a /common redirect would just dead-end. Let acquireToken recover.
    if (!tenantId) throw popupErr;
    if (isCommonEndpointUnsupported(popupErr)) throw popupErr;
    console.warn("MSAL popup failed, falling back to redirect flow:", popupErr);
    // Stash the current URL (+ pass it as `state`) so completeRedirectReturn() can bring the
    // user back here after AAD returns to the fixed redirect URI without our query string.
    rememberRedirectReturn();
    await msal.loginRedirect({ scopes, state: window.location.href });
    // loginRedirect navigates away; nothing after this line runs in this page load.
    throw new Error("Redirecting for authentication.");
  }
}

/** True if an error means "the tenant we used was rejected" — worth clearing a stale cache and re-asking. */
function tenantWasRejected(err: unknown): boolean {
  if (isCommonEndpointUnsupported(err)) return true;
  const message = (err as { errorMessage?: string; message?: string })?.errorMessage ?? (err as Error)?.message ?? "";
  // "tenant not found" / "no such tenant" family.
  return /AADSTS90002|AADSTS500011|AADSTS90072/.test(message);
}

/**
 * Acquires a Graph token for the given application. Tenant precedence:
 * an explicit `tenantId` (from `?tenantId=` / `PUBLIC_DEFAULT_TENANT_ID`) →
 * a tenant id a previous sign-in on this browser cached (localStorage) →
 * then, since a single-tenant Azure app registration CANNOT use `/common`
 * and its failure isn't cleanly recoverable mid-popup, we ask the user for
 * their work email and resolve it to a tenant id via Entra's public OIDC
 * discovery document (see tenantResolver.ts) — caching it and rewriting the
 * URL to carry `?tenantId=` so it's a one-time step. A genuinely
 * multi-tenant deployment sets `PUBLIC_AUTH_ALLOW_COMMON=1` to try
 * `/common` first instead of prompting.
 *
 * `` defaults to the full app-wide GRAPH_SCOPES set (every real call
 * site relies on that default); it's only overridden by diag.astro.
 */
export async function acquireToken(applicationId: string, tenantId?: string, scopes: string[] = GRAPH_SCOPES): Promise<string> {
  let effectiveTenantId = tenantId ?? getCachedTenantId(applicationId);

  // No tenant from anywhere, and this build hasn't opted into /common -> ask up front.
  if (!effectiveTenantId && !commonFallbackAllowed()) {
    effectiveTenantId = await resolveTenantInteractively(applicationId);
  }

  try {
    return await acquireWithTenant(applicationId, effectiveTenantId, scopes);
  } catch (err) {
    if (!tenantWasRejected(err)) throw err;
    // The tenant we used (a stale cache, a wrong URL param, or /common on a
    // single-tenant app) was refused — drop it and ask for the work email.
    clearCachedTenantId(applicationId);
    const rediscovered = await resolveTenantInteractively(applicationId);
    return acquireWithTenant(applicationId, rediscovered, scopes);
  }
}

/**
 * Same as acquireToken, but deliberately WITHOUT the redirect fallback — used only by diag.astro.
 * acquireToken's redirect fallback is a full-page navigation, which is exactly right for a real
 * end user whose popup got blocked, but wrong for a diagnostic tool running a whole sequence of
 * checks: a cancelled/failed popup (including clicking "Return to Application without Granting"
 * on an admin-approval-required screen) would navigate the ENTIRE diagnostics page away, destroying
 * every result gathered so far and stopping the run before later checks ever got a chance — a real
 * problem hit during live-tenant debugging. Here, a failed/cancelled popup just rejects normally,
 * so the caller can record it as one failed check and move on to the next one.
 */
export async function acquireTokenPopupOnly(applicationId: string, tenantId: string | undefined, scopes: string[]): Promise<string> {
  const msal = getMsalInstance(applicationId, tenantId);
  const silent = await initAndTrySilent(msal, scopes);
  if (silent) return silent.accessToken;

  const result = await msal.loginPopup({ scopes });
  return result.accessToken;
}

/** Adapts our token acquisition to the shape the Graph JS SDK expects. */
export function createAuthProvider(applicationId: string, tenantId?: string): AuthenticationProvider {
  return {
    getAccessToken: () => acquireToken(applicationId, tenantId),
  };
}
