/**
 * Page-state toggling for SKYE's pages.
 *
 * Every SKYE page now ships all of its possible states as sibling
 * `<section data-state id="…">` elements inside `<main id="skye-app">`,
 * authored as real HTML in the `.astro` file rather than built at runtime
 * in the entry script. The entry script's job is to decide WHICH state is
 * visible (and to fill its data-driven `[data-slot]` regions), not to
 * construct the markup.
 *
 * `showState` hides every `[data-state]` element under `root` and reveals
 * the one whose `id` matches, returning it so the caller can fill it in.
 * Visibility is driven by the `hidden` attribute (the Astro page skeleton
 * ships every non-initial state already `hidden`, and `public/styles`
 * carries a `[hidden] { display: none !important }` guard).
 */
export function showState(root: ParentNode, id: string): HTMLElement {
  // ids are all fixed, simple slugs authored in the `.astro` pages — no need to CSS.escape.
  const target = root.querySelector<HTMLElement>(`#${id}[data-state]`);
  if (!target) throw new Error(`showState: no <… data-state id="${id}"> found in the page.`);
  root.querySelectorAll<HTMLElement>("[data-state]").forEach((el) => {
    el.hidden = el !== target;
  });
  return target;
}

/**
 * Convenience for the common "fill a `[data-slot]` text region" step —
 * looks up `[data-slot="name"]` within `scope` and sets its text. A missing
 * slot is a programming error (the `.astro` skeleton and the script have
 * drifted), so it throws rather than silently doing nothing.
 */
export function fillSlot(scope: ParentNode, name: string, text: string): HTMLElement {
  const el = scope.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  if (!el) throw new Error(`fillSlot: no [data-slot="${name}"] found.`);
  el.textContent = text;
  return el;
}

/** Looks up a `[data-el="name"]` control within `scope`, throwing if the skeleton is missing it. */
export function el<T extends HTMLElement = HTMLElement>(scope: ParentNode, name: string): T {
  const found = scope.querySelector<T>(`[data-el="${name}"]`);
  if (!found) throw new Error(`el: no [data-el="${name}"] found.`);
  return found;
}
