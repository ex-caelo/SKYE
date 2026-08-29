import type { FormConfig, FormConfigOverlay } from "../schema/types.js";

export interface MergeResult {
  config: FormConfig;
  /** Paths where a permission overlay used `null`, which this system disallows (see README: overlays are additive-only). */
  nullValueErrors: string[];
}

/**
 * Recursively applies `patch` on top of `base`, following RFC 7396 JSON Merge
 * Patch semantics (plain objects merge key-by-key, arrays and primitives are
 * replaced wholesale) with one deliberate deviation: RFC 7396 says a `null`
 * value deletes the key, but SKYE's overlays are additive-only by convention,
 * so a `null` here is never a valid authoring choice. We collect it as an
 * error instead of performing the delete, and skip applying that key so the
 * base value survives.
 */
function mergePatch(base: unknown, patch: unknown, path: string, errors: string[]): unknown {
  // A non-object patch value simply replaces the base value outright (RFC 7396 base case).
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    if (patch === null) {
      errors.push(path);
      return base; // ignore the null — keep whatever the base already had
    }
    return patch;
  }

  // Both patch and base are plain objects (or base is missing/not an object) — merge key by key.
  const result: Record<string, unknown> =
    typeof base === "object" && base !== null && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {};

  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (value === null) {
      // Disallowed delete — record it, leave the base's existing value (if any) untouched.
      errors.push(childPath);
      continue;
    }
    result[key] = mergePatch(result[key], value, childPath, errors);
  }

  return result;
}

/**
 * Merges a base form config with zero or more permission overlays, in order.
 * Each overlay is applied in sequence, so later overlays win on any key both
 * touch — callers should already have sorted overlays into a deterministic
 * order (see the numeric-prefix folder-naming convention in the TODO/README).
 */
export function mergeConfig(base: FormConfig, ...overlays: FormConfigOverlay[]): MergeResult {
  const errors: string[] = [];
  let merged: unknown = base;

  for (const overlay of overlays) {
    merged = mergePatch(merged, overlay, "", errors);
  }

  return { config: merged as FormConfig, nullValueErrors: errors };
}
