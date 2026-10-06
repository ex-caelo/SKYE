export interface TemplateContext {
  /** Current form field values, keyed by field key — backs {{fields.x}}. */
  fields: Record<string, unknown>;
  /** The primary SharePoint list item this form created/updated — backs {{item.x}}. */
  item: Record<string, unknown>;
  /** Outputs of already-run postActions, keyed by action key — backs {{results.actionKey.path}}. */
  results: Record<string, unknown>;
  /** The signed-in viewer (e.g. `email`) — backs {{currentUser.x}}, used by field defaultValue. Optional; absent means those placeholders resolve to empty. */
  currentUser?: Record<string, unknown>;
}

/** Reads a dotted path (e.g. "createFollowupTicket.ticketId") off a nested object. */
function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[segment];
  }, obj);
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_.]+)\s*\}\}/g;
/** Matches a string that is EXACTLY one placeholder, nothing else around it — see resolveWholePlaceholder. */
const WHOLE_PLACEHOLDER_RE = /^\{\{\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_.]+)\s*\}\}$/;

/**
 * Resolves a string that is EXACTLY one `{{namespace.path}}` placeholder (nothing else around it)
 * to its RAW, untyped value — as opposed to `interpolateString`, which always stringifies.
 * Returns `undefined` if `input` isn't a whole-placeholder string (so the caller can fall back to
 * ordinary string interpolation). Used only by `interpolate`'s array case, to let an array-valued
 * field (e.g. a multi-person peoplePicker's `string[]`) be SPREAD into a parent array's positions,
 * rather than collapsed into one `String(anArray)` comma-joined string a config author almost
 * never wants (a peoplePicker's own value is always a `string[]` — even a single-person one is a
 * 1-element array — so `"{{fields.cohosts}}"` as a whole `memberUserIds` array entry needs to
 * become N entries, one per person, not one broken combined string).
 */
function resolveWholePlaceholder(input: string, ctx: TemplateContext): unknown {
  const match = input.match(WHOLE_PLACEHOLDER_RE);
  if (!match) return undefined;
  const [, namespace, path] = match;
  const source = (ctx as unknown as Record<string, unknown>)[namespace];
  return source === undefined ? undefined : getByPath(source, path);
}

/**
 * Resolves every {{namespace.path}} placeholder in a single string against
 * the template context. A placeholder that resolves to undefined (missing
 * field, action never ran, skipped dependency per runIfDependencySkipped)
 * becomes an empty string rather than throwing — callers whose logic
 * depends on that value existing are responsible for their own guards.
 */
function interpolateString(input: string, ctx: TemplateContext): string {
  return input.replace(PLACEHOLDER_RE, (_match, namespace: string, path: string) => {
    const source = (ctx as unknown as Record<string, unknown>)[namespace];
    if (source === undefined) return "";
    const value = getByPath(source, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

/**
 * Recursively walks an arbitrary JSON-like value (a postAction's `body`,
 * `to`, `message`, etc.) and interpolates placeholders in every string it
 * finds, leaving non-string values untouched. This is what lets a
 * postAction's `request.body` be a whole nested object of placeholders.
 */
export function interpolate(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === "string") return interpolateString(value, ctx);
  if (Array.isArray(value)) {
    // flatMap, not map: an element that's a WHOLE placeholder resolving to an array (see
    // resolveWholePlaceholder) is spread into this array's positions instead of becoming one
    // stringified element — every other element (plain values, or a placeholder embedded in a
    // larger string) is unaffected, wrapped right back into its own single-item array.
    return value.flatMap((item) => {
      if (typeof item === "string") {
        const whole = resolveWholePlaceholder(item, ctx);
        if (Array.isArray(whole)) return interpolate(whole, ctx) as unknown[];
      }
      return [interpolate(item, ctx)];
    });
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = interpolate(v, ctx);
    }
    return result;
  }
  return value;
}
