import type { FormConfig, CustomValidatorFn } from "@skye/config";
import { renderForm } from "../render/renderForm.js";
import type { GraphClient } from "../graph/types.js";

/**
 * The builder's left-pane live preview: renders an ALREADY-fully-merged
 * FormConfig (entry-builder.ts is responsible for merging base + whichever
 * overlay is currently selected before calling this — this module doesn't
 * know anything about overlays) through the real lib/render/renderForm.ts,
 * exactly like the actual /form page does, so what an author sees here is
 * what an end user would actually get. Layers on exactly two things a real
 * form render doesn't need:
 *
 *  - Clicking any rendered field (its label, its control, its help text —
 *    anywhere inside its container) selects that field for editing in the
 *    right pane, via `onSelectField`.
 *  - The same peoplePicker/lookupPicker search-event wiring entry-form.ts
 *    does, so those controls are actually usable in the preview rather
 *    than permanently empty.
 *
 * The submit button is hidden — this is a preview, not a real submission
 * surface, and nothing here writes to SharePoint. Field-level validation
 * (renderForm.ts's own — native constraints + the app's real
 * customValidators registry) is still fully live, though: an author
 * typing test values in here and tabbing through fields sees the exact
 * same inline errors an end user would, since this is "a form preview"
 * every bit as much as `/form`'s own draft-preview mode is (see TODO §17).
 *
 * `initialPageKey` lets the caller restore whichever page was showing
 * before a live-edit rebuilt this preview from scratch (renderForm always
 * defaults to the first page otherwise) — entry-builder.ts captures the
 * outgoing preview's `getActivePageKey()` before tearing it down and passes
 * it back in as this call's `initialPageKey`. The returned `getActivePageKey`
 * lets it do that again next time.
 */
export interface BuilderPreview {
  root: HTMLElement;
  getActivePageKey: () => string | undefined;
}

export function renderBuilderPreview(
  config: FormConfig,
  document: Document,
  graph: GraphClient,
  siteId: string,
  onSelectField: (fieldKey: string) => void,
  initialPageKey?: string,
  customValidators?: Record<string, CustomValidatorFn>
): BuilderPreview {
  const rendered = renderForm(config, document, { initialPageKey, customValidators });
  rendered.submitButton.style.display = "none";

  rendered.root.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("[data-field-key]") as HTMLElement | null;
    if (!target?.dataset.fieldKey) return;
    onSelectField(target.dataset.fieldKey);
  });

  rendered.root.addEventListener("skye-people-search", async (e) => {
    const { query } = (e as CustomEvent<{ query: string }>).detail;
    const results = await graph.searchPeople(query);
    (e.target as unknown as { setResults: (r: unknown[]) => void }).setResults(results);
  });

  rendered.root.addEventListener("skye-lookup-search", async (e) => {
    const { query, relatedList } = (e as CustomEvent<{ query: string; relatedList?: { id: string; siteId?: string; displayField: string } }>).detail;
    if (!relatedList) return;
    const results = await graph.searchLookupItems(relatedList.siteId ?? siteId, relatedList.id, relatedList.displayField, query);
    (e.target as unknown as { setResults: (r: unknown[]) => void }).setResults(results);
  });

  return { root: rendered.root, getActivePageKey: rendered.getActivePageKey };
}
