/**
 * A small reusable "here's a state, not a form" panel — used for the
 * permission-denied screen (see lib/builder/permissions.ts) and any other
 * plain informational/error state a page needs to show instead of its
 * normal content. Same rationale as confirmDialog.ts for staying a plain
 * TS/DOM module rather than an Astro component: this is a static-output
 * SPA, so which message (if any) to show is only known at runtime.
 */
export function renderMessagePanel(kind: "error" | "info" | "warning", title: string, body: string, document: Document): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "skye-message-panel";
  panel.dataset.level = kind;

  const heading = document.createElement("h1");
  heading.textContent = title;
  panel.appendChild(heading);

  const bodyEl = document.createElement("p");
  bodyEl.textContent = body;
  panel.appendChild(bodyEl);

  return panel;
}
