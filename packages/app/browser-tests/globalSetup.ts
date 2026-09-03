import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Builds the app once with PUBLIC_MOCK_GRAPH=1 baked in, before the browser
 * gate runs. Done here (not in webServer.command) so the flag is passed via
 * an explicit env object rather than shell syntax through pnpm, which was
 * not propagating it to `astro build`.
 */
export default function globalSetup() {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  execSync("pnpm exec astro build", {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, PUBLIC_MOCK_GRAPH: "1" },
  });
}
