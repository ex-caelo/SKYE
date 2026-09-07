import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // `build` (tsc) emits compiled copies of the *.test.ts files into dist/.
    // Vitest 5 no longer excludes dist/ by default, so without this it would
    // discover and run every test twice (once from src/, once from dist/).
    // Setting `exclude` replaces vitest's built-in list entirely, so the
    // standard entries are repeated here alongside the dist/ guard.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
    ],
  },
});
