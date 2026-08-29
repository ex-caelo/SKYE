import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // e2e/ is Playwright-only (real browser + webServer, see playwright.config.ts's own comment
    // that it's deliberately kept out of the vitest/turbo run test path) — without this exclude,
    // vitest's default glob still picks up e2e/*.spec.ts and fails immediately at collection time
    // trying to run Playwright's test()/expect() through vitest's runner. Vitest's own defaults
    // are repeated here (setting `exclude` replaces them entirely, doesn't append) so node_modules
    // etc. stay excluded too.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "e2e/**",
    ],
  },
});
