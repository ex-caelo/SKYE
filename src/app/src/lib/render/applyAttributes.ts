/**
 * Applies a bag of HTML attributes to an element, with one hard rule that
 * holds independent of what already passed JSON Schema validation: any key
 * matching /^on/i is stripped before it ever reaches setAttribute. The
 * schema's htmlAttributes allowlist already excludes these, but that's a
 * lint-time guarantee about authoring, not a runtime guarantee about every
 * code path that touches config data — see README's "Attributes & style:
 * allowlisted, not sanitized" section for why this defense-in-depth layer
 * has to live here, in the one place every control funnels through, rather
 * than being assumed safe because it passed validation earlier.
 */
export function applyAttributes(el: HTMLElement, attributes: Record<string, unknown> | undefined): void {
  if (!attributes) return;

  for (const [key, value] of Object.entries(attributes)) {
    if (/^on/i.test(key)) {
      console.warn(`applyAttributes: refusing to set event-handler-like attribute "${key}" — this should never happen if the config passed schema validation.`);
      continue;
    }
    if (value === undefined || value === null) continue;

    if (typeof value === "boolean") {
      // Boolean HTML attributes (disabled, required, autofocus, ...) are present-or-absent, not "true"/"false" strings.
      if (value) el.setAttribute(key, "");
      else el.removeAttribute(key);
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

/**
 * Same idea as applyAttributes, but for the cosmetic `style` bag — applied
 * via the CSSStyleDeclaration API (camelCase keys map directly), never via
 * a raw string, so there's no cssText injection surface either.
 */
export function applyStyle(el: HTMLElement, style: Record<string, unknown> | undefined): void {
  if (!style) return;
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    // @ts-expect-error dynamic camelCase key into CSSStyleDeclaration
    el.style[key] = String(value);
  }
}
