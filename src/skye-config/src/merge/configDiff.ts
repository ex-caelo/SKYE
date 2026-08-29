/**
 * Computes a human-reviewable diff between two versions of the same
 * dictionary-shaped part of a form config (fields, pages, or postActions),
 * for `/builder`'s "review changes before saving" step. Pure and
 * framework-agnostic — the DOM rendering of this lives in
 * packages/app/src/lib/builder/configDiffView.ts.
 *
 * Deliberately structural, not semantic: two values compare equal via
 * JSON.stringify, which is sufficient for this app's config data (plain JSON —
 * no functions, no Dates, no key-order-sensitive meaning beyond what
 * JSON.stringify already preserves consistently for a given object as
 * mutated by the builder's own code).
 */

export type DiffStatus = "added" | "removed" | "changed";
/** More specific than a boolean: distinguishes "a visibility condition was newly added" from "one was removed" from "an existing one's shape changed" — covers this app's "hidden" / "made conditionally visible" vocabulary in one field. */
export type VisibilityChange = "added" | "removed" | "changed";

export interface DiffEntry {
  key: string;
  status: DiffStatus;
  /** Only set for status "changed": which top-level properties on this entry actually differ. */
  changedProperties?: string[];
  /** Only set when the entry's visibleIf (fields/pages) or when (postActions) specifically differs. */
  visibilityChange?: VisibilityChange;
  /** Fields only: which page this field is on, read from whichever side has it (after preferred). */
  pageKey?: string;
}

export interface ConfigDiff {
  settings: { changedProperties: string[] };
  pages: DiffEntry[];
  fields: DiffEntry[];
  postActions: DiffEntry[];
  isEmpty: boolean;
}

function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Which top-level keys differ between two entry objects (a field, a page, or a postAction), sorted for stable display. */
function diffEntryProperties(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!stableEqual(before?.[key], after?.[key])) changed.push(key);
  }
  return changed.sort();
}

function diffVisibility(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, visibilityKey: string): VisibilityChange | undefined {
  const b = before?.[visibilityKey];
  const a = after?.[visibilityKey];
  if (stableEqual(b, a)) return undefined;
  if (b === undefined) return "added";
  if (a === undefined) return "removed";
  return "changed";
}

/** Diffs one dictionary section (fields, pages, or postActions) between two config versions. Unchanged entries are omitted entirely — this returns only what actually differs. */
function diffDict(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, visibilityKey: string): DiffEntry[] {
  const beforeDict = before ?? {};
  const afterDict = after ?? {};
  const keys = new Set([...Object.keys(beforeDict), ...Object.keys(afterDict)]);
  const entries: DiffEntry[] = [];

  for (const key of keys) {
    const b = beforeDict[key] as Record<string, unknown> | undefined;
    const a = afterDict[key] as Record<string, unknown> | undefined;
    const pageKey = (a?.page ?? b?.page) as string | undefined;

    if (b === undefined) {
      entries.push({ key, status: "added", pageKey });
      continue;
    }
    if (a === undefined) {
      entries.push({ key, status: "removed", pageKey });
      continue;
    }
    if (stableEqual(b, a)) continue; // truly unchanged — omitted from the diff

    entries.push({
      key,
      status: "changed",
      changedProperties: diffEntryProperties(b, a),
      visibilityChange: diffVisibility(b, a, visibilityKey),
      pageKey,
    });
  }

  return entries.sort((x, y) => x.key.localeCompare(y.key));
}

const SETTINGS_KEYS = ["id", "title", "description", "mode", "list", "layout"];

/**
 * Diffs two versions of the same form config object (a base FormConfig, an
 * overlay FormConfigOverlay, or a draft — all structurally dictionaries of
 * the same three sections plus a handful of top-level settings). `before`
 * is the version as originally loaded/last saved this builder session;
 * `after` is the current in-memory (edited) state.
 */
export function computeConfigDiff(before: Record<string, unknown>, after: Record<string, unknown>): ConfigDiff {
  const changedProperties = SETTINGS_KEYS.filter((key) => !stableEqual(before[key], after[key]));
  const pages = diffDict(before.pages as Record<string, unknown> | undefined, after.pages as Record<string, unknown> | undefined, "visibleIf");
  const fields = diffDict(before.fields as Record<string, unknown> | undefined, after.fields as Record<string, unknown> | undefined, "visibleIf");
  const postActions = diffDict(before.postActions as Record<string, unknown> | undefined, after.postActions as Record<string, unknown> | undefined, "when");

  return {
    settings: { changedProperties },
    pages,
    fields,
    postActions,
    isEmpty: changedProperties.length === 0 && pages.length === 0 && fields.length === 0 && postActions.length === 0,
  };
}
