export interface TemplateContext {
  /** Current form field values, keyed by field key — backs {{fields.x}}. */
  fields: Record<string, unknown>;
  /** The primary SharePoint list item this form created/updated — backs {{item.x}}. */
  item: Record<string, unknown>;
  /** Outputs of already-run postActions, keyed by action key — backs {{results.actionKey.path}}. */
  results: Record<string, unknown>;
}

/** Reads a dotted path (e.g. "createFollowupTicket.ticketId") off a nested object. */
function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[segment];
  }, obj);
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_.]+)\s*\}\}/g;

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
  if (Array.isArray(value)) return value.map((item) => interpolate(item, ctx));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = interpolate(v, ctx);
    }
    return result;
  }
  return value;
}
