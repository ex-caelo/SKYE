import { defineConfig } from "@playwright/test";

/**
 * Browser regression gate for Custom Views (TODO §16.6). The isolation
 * boundary — opaque-origin sandbox, CSP network egress blocks, self-
 * navigation blocks — is not observable in jsdom, so this runs against a
 * real Chromium via the system Chrome channel (no separate browser
 * download). Kept OUT of the default `turbo run test` / `vitest` run
 * because it needs a browser and a dev server; invoke with
 * `pnpm test:views:browser`.
 */
export default defineConfig({
  testDir: "./browser-tests",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./browser-tests/globalSetup.ts",
  use: {
    baseURL: "http://localhost:4321",
    channel: "chrome",
    headless: true,
  },
  // Build + serve the static output rather than `astro dev`: the mock-graph
  // flag is baked in at build time, sidestepping Vite's dev-mode env/module
  // cache (a stale cache silently falls through to real MSAL auth, which
  // hangs with no tenant).
  // The build happens in globalSetup (with the mock flag in an explicit env
  // object); this just serves the already-built static output.
  webServer: {
    command: "pnpm exec astro preview --port 4321",
    url: "http://localhost:4321",
    reuseExistingServer: false,
    timeout: 60_000,
    // Astro 7's CLI auto-detects an "AI agent" environment and daemonizes
    // `astro preview` (the foreground process then exits, and Playwright
    // sees the web server "exit before becoming ready"). Setting this env
    // var opts out of that detection, keeping preview in the foreground
    // where Playwright manages its lifecycle.
    env: { ASTRO_PREVIEW_BACKGROUND: "1" },
  },
});
