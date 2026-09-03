/**
 * Drives the shared message panel (components/MessagePanel.astro) — a
 * full-page "here's a state, not the normal content" screen, used for the
 * permission-denied screen (lib/builder/permissions.ts) and any other
 * plain informational/error state a page shows instead of its content.
 *
 * The markup now lives in the `.astro` component (reviewable HTML, one
 * instance per page that needs it); this function only reveals it and
 * fills it in. `root` is the page's `<main id="skye-app">` (or any
 * ancestor of both the panel and the other `[data-state]` sections).
 */
import { showState, fillSlot } from "./pageState.js";
import { MESSAGE_PANEL } from "./domHooks.js";

export function showMessagePanel(
  root: ParentNode,
  kind: "error" | "info" | "warning",
  title: string,
  body: string
): HTMLElement {
  const panel = showState(root, MESSAGE_PANEL.id);
  panel.dataset.level = kind;
  fillSlot(panel, MESSAGE_PANEL.slotTitle, title);
  fillSlot(panel, MESSAGE_PANEL.slotBody, body);
  return panel;
}
