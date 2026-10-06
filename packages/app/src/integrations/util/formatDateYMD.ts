import type { ScriptAction } from "@skye/form-config";

export interface FormatDateYMDOptions {
  /** A date or date-time string, e.g. from a `date`/`datetime-local` field's own value. */
  date: string;
}

/**
 * Formats a date as "YYYY.MM.DD" — a pure, dependency-free helper (no
 * `ctx.graphFetch`/`ctx.httpFetch` needed) for configs that want a date
 * prefix in a templated string (e.g. a Teams chat topic), which the
 * templating engine itself can't produce — `{{fields.x}}` only
 * substitutes a field's raw stored value, with no formatting/transform
 * syntax (see post-actions/templating.ts). Uses `Date`'s LOCAL getters
 * (not UTC) so a `datetime-local` field's own already-local value (no
 * timezone suffix) formats using the date it actually displays, not a
 * UTC-shifted one — same reasoning as mapSharePointFieldsToValues.ts's
 * own date handling. Registered as "util.formatDateYMD" — see
 * ../registry.ts.
 */
export const formatDateYMD: ScriptAction = async (args) => {
  const options = args[0] as FormatDateYMDOptions | undefined;
  if (!options?.date) throw new Error('util.formatDateYMD requires "date".');

  const parsed = new Date(options.date);
  if (Number.isNaN(parsed.getTime())) throw new Error(`util.formatDateYMD: "${options.date}" isn't a parseable date.`);

  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${parsed.getFullYear()}.${pad(parsed.getMonth() + 1)}.${pad(parsed.getDate())}`;
  return { ymd };
};
