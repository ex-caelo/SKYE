/**
 * Invoker Commands API (`command` / `commandfor` attributes on `<button>`)
 * support.
 *
 * SKYE's pages use `command`/`commandfor` for the purely-declarative
 * button jobs — opening/closing the shared `<dialog>`, toggling a
 * `<details>`/popover — so that markup, not script, expresses those. The
 * API is Baseline-ish (Chrome/Edge 135+, Safari 26+) but Firefox has no
 * stable support yet, so `ensureInvokerCommands()` loads OddBird's
 * `invokers-polyfill` (which self-applies on import, and no-ops where the
 * feature is native) on browsers that lack it. Every entry script calls
 * this once, early. It's a dynamic import so supporting browsers never
 * download the polyfill chunk.
 */
export async function ensureInvokerCommands(): Promise<void> {
  if (typeof HTMLButtonElement === "undefined") return;
  if ("commandForElement" in HTMLButtonElement.prototype) return;
  await import("invokers-polyfill");
}
