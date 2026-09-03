import type { PageConfig } from "@skye/form-config";

/** Converts a trackSizing value (integer shorthand or raw CSS track-list string) into a real grid-template-columns/rows value. */
function trackSizingToCss(value: number | string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return typeof value === "number" ? `repeat(${value}, 1fr)` : value;
}

/**
 * Applies a page's layout (falling back to the form-wide layout for
 * anything the page doesn't override) onto a real CSS Grid container.
 * gridTemplateAreas rows are joined into the quoted-string format CSS
 * actually expects.
 */
export function applyPageLayout(
  container: HTMLElement,
  page: PageConfig,
  formLayout: { gridTemplateColumns?: number | string; gap?: string } | undefined
): void {
  container.style.display = "grid";
  container.style.gridTemplateColumns = trackSizingToCss(page.layout?.gridTemplateColumns ?? formLayout?.gridTemplateColumns, "repeat(12, 1fr)");
  container.style.gap = page.layout?.gap ?? formLayout?.gap ?? "1rem";

  if (page.layout?.gridTemplateRows) {
    container.style.gridTemplateRows = trackSizingToCss(page.layout.gridTemplateRows, "auto");
  }

  if (page.layout?.gridTemplateAreas?.length) {
    container.style.gridTemplateAreas = page.layout.gridTemplateAreas.map((row) => `"${row}"`).join(" ");
  }
}
