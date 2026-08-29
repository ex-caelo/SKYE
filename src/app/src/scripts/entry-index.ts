import { looksLikeFormLink, parseAuthErrorFromHash } from "../lib/routing/router.js";

/**
 * Entry point loaded by pages/index.astro (the site root). SKYE has no
 * real "homepage" content of its own — every real visit arrives at /form
 * or /switcher with a formId/siteId/applicationId already in hand (a link
 * from SharePoint). This only exists to: (1) show a clear message for an
 * OAuth error landing here from MSAL's redirect-fallback flow (its
 * redirectUri is the bare origin — see authProvider.ts), instead of
 * silently misreading it as a garbage formId and bouncing through several
 * confusing redirects; (2) catch a stray visit that still carries the old
 * bare-root-plus-hash link shape and forward it to /form. Otherwise it
 * leaves index.astro's own static landing markup alone.
 */
function main() {
  const authError = parseAuthErrorFromHash(window.location.hash);
  if (authError) {
    const appRoot = document.getElementById("skye-app");
    if (appRoot) {
      appRoot.innerHTML = `
        <h1>Sign-in didn't complete</h1>
        <p><strong>${authError.error}</strong>${authError.description ? `: ${authError.description}` : ""}</p>
        <p>This usually means the Microsoft sign-in/consent flow was cancelled, denied, or interrupted before finishing. Go back to the page you came from and try again.</p>
      `;
    }
    return;
  }

  if (looksLikeFormLink(window.location.hash, window.location.search)) {
    window.location.assign(`/form${window.location.search}${window.location.hash}`);
  }
}

main();
