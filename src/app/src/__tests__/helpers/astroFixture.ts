import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test helper: return the static HTML body of an `.astro` component (the
 * `src/components/*.astro` skeletons are expression-free, so everything
 * after the `---` frontmatter fence is usable HTML). This keeps the tests
 * running against the SAME markup the page ships — no hand-maintained
 * fixture copy to drift out of sync — without needing Astro's build
 * pipeline in vitest.
 */
const COMPONENTS_DIR = join(import.meta.dirname, "..", "..", "components");

export function componentBody(name: string): string {
  const src = readFileSync(join(COMPONENTS_DIR, `${name}.astro`), "utf8");
  const body = src.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  if (/\{[^}]+\}/.test(body)) {
    throw new Error(`componentBody(${name}): component has template expressions and can't be used as a static fixture.`);
  }
  return body.trim();
}

/**
 * Mounts one or more component bodies into a fresh `<main id="skye-app">`
 * appended to `document.body`, mirroring how the real pages compose them.
 * Returns the host element (also a valid `showState` root).
 */
export function mountComponents(...names: string[]): HTMLElement {
  const host = document.createElement("main");
  host.id = "skye-app";
  host.innerHTML = names.map(componentBody).join("\n");
  document.body.appendChild(host);
  return host;
}
