import { completeRedirectReturn, getRedirectReturn, forgetRedirectReturn } from "../shared/auth/redirectReturn.js";

/**
 * Entry point for pages/auth.astro — the dedicated MSAL redirect landing
 * page. Splits on how sign-in was started:
 *
 *  - **Popup** (`window.opener` is set): the opener's own
 *    `PublicClientApplication` (the instance that called `loginPopup`)
 *    reads the response fragment straight off this same-origin popup and
 *    closes it. This page must therefore do **nothing** to the URL — no
 *    `handleRedirectPromise()`, no second `PublicClientApplication`.
 *    Running MSAL here races the opener for the `#code=…` fragment and,
 *    when this page wins, strips it before the opener can read it — the
 *    opener's `loginPopup` then times out and falls back to a full-page
 *    redirect (which is what was dumping people on the bare origin with
 *    every query param lost). We only keep a self-close fallback in case
 *    the opener doesn't close us.
 *  - **Full-page redirect** (no opener): finish the token exchange and
 *    navigate back to the pre-redirect URL. `completeRedirectReturn()`
 *    does exactly that (recover clientId → throwaway MSAL instance →
 *    `handleRedirectPromise()` → `location.replace(returnHref)`). If it
 *    somehow can't (no response fragment), fall back to the URL stashed
 *    before sign-in started — never the bare origin, which loses siteId /
 *    applicationId / the form id.
 */
async function main() {
  const inPopup = Boolean(window.opener && window.opener !== window);

  if (inPopup) {
    // Leave the fragment untouched for the opener. Self-close only as a fallback.
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        /* opener already closed us, or close() is blocked — nothing to do */
      }
    }, 3000);
    return;
  }

  const handled = await completeRedirectReturn();
  if (handled) return; // a navigation back to the start URL is already imminent

  // No redirect fragment to process. Prefer the URL the user started on (query params + hash
  // intact) over the bare origin, so the page they came from can complete sign-in silently.
  const back = getRedirectReturn();
  forgetRedirectReturn();
  window.location.replace(back ?? "/");
}

main().catch((err) => console.error("entry-auth failed:", err));
