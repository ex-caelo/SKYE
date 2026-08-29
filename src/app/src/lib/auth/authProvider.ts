import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";
import type { AuthenticationProvider } from "@microsoft/microsoft-graph-client";

// Sites.Selected (not the broader Sites.ReadWrite.All) is a deliberate choice, confirmed against
// a real tenant: it's narrower/more secure, but the app has ZERO site access by default — a
// tenant/SharePoint admin must explicitly grant it access to EACH specific site (via SharePoint
// Admin Center's "API access" page, if enabled, or a Sites.FullControl.All-privileged
// POST /sites/{siteId}/permissions Graph call made some other way — SKYE itself has no
// client-credentials flow to do this call as itself) before any Graph call against that site
// succeeds, even with this permission's own admin consent already granted. This also means
// GraphClient.searchSitesWithSkyeData()'s tenant-wide /search/query can only ever surface sites
// already explicitly granted — it can't discover a brand-new site the way it could under
// Sites.ReadWrite.All. Flagged, not silently worked around — see TODO §13.
// Calendars.ReadWrite.Shared and User.ReadBasic.All back the Teams/Outlook plugin actions and the
// peoplePicker's directory search respectively — all three are requested together in one token,
// since a Graph access token is scoped to exactly what was requested at acquisition time, not to
// everything that happens to be admin-consented on the app registration overall.
// Exported so diag.astro's per-scope probes can test exactly this list, one entry at a time,
// without duplicating it (and risking drift) in a second place.
//
// Calendars.ReadWrite.Shared previously needed to be temporarily commented out here, because a
// cancelled/blocked interactive prompt for it fell back to a page-navigating redirect that killed
// the whole diagnostics run (see acquireTokenPopupOnly below — now fixed, so it's safe to test
// again here rather than skip it). Chat.Create/ChatMessage.Send (teams.createChat/sendMessage) and
// Mail.Send (outlook.sendEmail) added to actually test the scopes those plugin actions need, not
// just the ones already known to work.
export const GRAPH_SCOPES = ["Sites.Selected", "Calendars.ReadWrite.Shared", "User.ReadBasic.All", "Chat.Create", "ChatMessage.Send", "Mail.Send"];

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

/** Shared first step for both acquireToken and acquireTokenPopupOnly: initialize, clear any pending redirect state, and try silent acquisition against the first cached account (if any). Returns null (not a throw) when silent acquisition genuinely needs interaction, so callers can fall through to their own interactive strategy — any OTHER error still propagates. */
async function initAndTrySilent(msal: PublicClientApplication, scopes: string[]): Promise<string | null> {
  await msal.initialize();
  // Processes (and critically, CLEARS) any pending redirect response left over from a previous
  // loginRedirect fallback. Without this, an interrupted/failed redirect round-trip leaves MSAL's
  // sessionStorage-persisted "interaction in progress" flag stuck forever for this tab — every
  // subsequent acquireToken call then fails immediately with `interaction_in_progress`, regardless
  // of whether the original admin-consent/site-permission problem is even still an issue. Found via
  // exactly that stuck state during real-tenant debugging — safe/idempotent to call even when
  // there's no pending redirect (resolves to null immediately).
  await msal.handleRedirectPromise();

  const account = msal.getAllAccounts()[0];
  if (!account) return null;

  try {
    const result = await msal.acquireTokenSilent({ scopes, account });
    return result.accessToken;
  } catch (err) {
    if (!(err instanceof InteractionRequiredAuthError)) throw err;
    return null; // fall through to interactive acquisition
  }
}

/**
 * Acquires a Graph token for the given application (and tenant, if the
 * Azure app registration is single-tenant), preferring silent acquisition,
 * then popup (keeps location.hash intact — see TODO §4), and only falling
 * back to a full-page redirect if the popup is blocked. `scopes` defaults
 * to the full app-wide GRAPH_SCOPES set (every real call site — GraphClient,
 * rawGraphFetch — relies on that default and never passes its own); it's
 * only overridden by diag.astro's per-scope probes, to isolate which
 * individual scope actually works vs. the combined request as a whole.
 */
export async function acquireToken(applicationId: string, tenantId?: string, scopes: string[] = GRAPH_SCOPES): Promise<string> {
  const msal = getMsalInstance(applicationId, tenantId);
  const silent = await initAndTrySilent(msal, scopes);
  if (silent) return silent;

  try {
    const result = await msal.loginPopup({ scopes });
    return result.accessToken;
  } catch (popupErr) {
    // Popup blocked or otherwise failed — fall back to redirect. This unloads the page,
    // so whatever's driving navigation post-auth needs to restore the hash/state on return.
    console.warn("MSAL popup failed, falling back to redirect flow:", popupErr);
    await msal.loginRedirect({ scopes });
    // loginRedirect navigates away; nothing after this line runs in this page load.
    throw new Error("Redirecting for authentication.");
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
  if (silent) return silent;

  const result = await msal.loginPopup({ scopes });
  return result.accessToken;
}

/** Adapts our token acquisition to the shape the Graph JS SDK expects. */
export function createAuthProvider(applicationId: string, tenantId?: string): AuthenticationProvider {
  return {
    getAccessToken: () => acquireToken(applicationId, tenantId),
  };
}
