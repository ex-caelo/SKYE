import { looksLikeFormLink, parseAuthErrorFromHash } from "../shared/routing.js";
import { completeRedirectReturn } from "../shared/auth/redirectReturn.js";
import { showState, fillSlot } from "../shared/ui/pageState.js";

/**
 * Entry point loaded by pages/index.astro (the site root). SKYE has no
 * real "homepage" content of its own — every real visit arrives at /form
 * or /switcher with a formId/siteId/applicationId already in hand (a link
 * from SharePoint). This only exists to: (1) show a clear message for an
 * OAuth error landing here from MSAL's redirect-fallback flow (its
 * redirectUri is the bare origin — see authProvider.ts), instead of
 * silently misreading it as a garbage formId and bouncing through several
 * confusing redirects; (2) catch a stray visit that still carries the old
 * bare-root-plus-hash link shape and forward it to /form. The page's
 * static landing/auth-error markup lives in index.astro; this just picks
 * which one is visible.
 */
async function main() {
  // The bare origin is MSAL's redirectUri, so a loginRedirect response often lands here first.
  // Finish it and bounce to the pre-redirect URL before doing anything else.
  if (await completeRedirectReturn()) return;

  const appRoot = document.getElementById("skye-app");

  const authError = parseAuthErrorFromHash(window.location.hash);
  if (authError && appRoot) {
    const panel = showState(appRoot, "state-auth-error");
    fillSlot(panel, "error", authError.error);
    fillSlot(panel, "description", authError.description ? `: ${authError.description}` : "");
    return;
  }

  if (looksLikeFormLink(window.location.hash, window.location.search)) {
    window.location.assign(`/form${window.location.search}${window.location.hash}`);
  }
}

main().catch((err) => console.error("entry-index failed:", err));
