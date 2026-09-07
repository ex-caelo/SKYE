import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Run test files on worker threads rather than child-process forks.
    // Forking a fresh Node process per file and standing up jsdom inside it
    // is punishingly slow here (~7s/file), which trips vitest's worker-
    // startup timeout on a chunk of the suite. Threads share the process,
    // so jsdom's native bits load once and workers start near-instantly,
    // while still giving each file its own isolated environment.
    pool: "threads",
    // browser-tests/ is Playwright-only (real browser + webServer, see playwright.config.ts's own comment
    // that it's deliberately kept out of the vitest/turbo run test path) — without this exclude,
    // vitest's default glob still picks up browser-tests/*.spec.ts and fails immediately at collection time
    // trying to run Playwright's test()/expect() through vitest's runner. Vitest's own defaults
    // are repeated here (setting `exclude` replaces them entirely, doesn't append) so node_modules
    // etc. stay excluded too.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "browser-tests/**",
    ],
  },
});
