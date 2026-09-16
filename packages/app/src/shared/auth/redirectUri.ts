// The MSAL `redirectUri` for every SKYE MSAL instance.
//
// It points at a DEDICATED, minimal landing page (`pages/auth.astro` +
// `page-scripts/auth.ts`) whose only job is to finish the Microsoft
// sign-in handshake — it renders no SKYE UI and loads no config. This
// fixes two long-standing problems with using the bare app origin as the
// redirect URI:
//
//  1. `loginPopup` sent the popup to `https://<origin>/`, which booted the
//     whole SKYE index SPA inside the popup ("mini SKYE"). MSAL's popup
//     handshake never completed, so `loginPopup` timed out after 60s and
//     fell back to a full-page redirect every time.
//  2. The full-page `loginRedirect` return also briefly booted the app on
//     the bare origin before bouncing back to where the user started.
//
// A tiny static page resolves in tens of milliseconds, so the popup closes
// cleanly and the redirect returns without a flash of the app.
//
// DEPLOYMENT: this exact URI must be registered as a **Single-page
// application** redirect URI on the Entra app registration — one per
// origin SKYE is served from, e.g. `https://getskye.app/auth` and
// `http://localhost:4321/auth`. AAD rejects any sign-in whose redirect_uri
// isn't registered (AADSTS50011).
export function authRedirectUri(): string {
  return `${window.location.origin}/auth`;
}
