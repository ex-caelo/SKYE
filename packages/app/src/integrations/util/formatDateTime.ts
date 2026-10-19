import type { ScriptAction } from "@skye/form-config";

export interface FormatDateTimeOptions {
  /** A datetime-local value ("2026-10-06T19:00", no timezone) or a date with an explicit offset. */
  date: string;
  /** BCP 47 locale, e.g. "en-US". */
  locale?: string;
  /** IANA zone the naive wall-clock value is in (and is shown in), e.g. "America/Indiana/Indianapolis". */
  timeZone?: string;
}

/**
 * Converts a naive wall-clock value (no timezone) that was entered for `timeZone` into the real instant it
 * names there, then returns that instant. Done by reading the zone's offset at that moment and subtracting
 * it — so the result doesn't depend on the browser's own timezone.
 */
function wallClockToInstant(naive: string, timeZone: string): Date {
  const [datePart, timePart = ""] = naive.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh = 0, mm = 0] = timePart.split(":").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(asUtc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const zoneWallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(asUtc - (zoneWallAsUtc - asUtc));
}

/**
 * Formats a date/time for display, e.g. "Oct 6, 2026, 7:00 PM EDT" for en-US in Eastern time.
 * Defaults to en-US and America/Indiana/Indianapolis, which is what SKYE's own event forms use.
 * Also returns `isoInstant` — the real UTC instant (with a "Z" offset) the naive wall-clock value
 * names in `timeZone`. A naive datetime-local string ("2026-10-18T17:00") has no timezone of its
 * own, so handing it to an external API UNCONVERTED lets that API's own parser guess — e.g. Campus
 * Labs Engage evidently treats an offset-less string as UTC, which silently shifted every BeInvolved
 * event's displayed time by the Eastern UTC offset (4-5 hours) versus what SKYE itself shows for the
 * same stored value. `isoInstant` is the fix: a config that needs to hand a date to a non-Graph API
 * (Engage's `startsOn`/`endsOn`, so far) should use this field, not the raw `{{fields.x}}` value.
 * Registered as "util.formatDateTime" — see ../registry.ts.
 */
export const formatDateTime: ScriptAction = async (args) => {
  const options = args[0] as FormatDateTimeOptions | undefined;
  if (!options?.date) throw new Error('util.formatDateTime requires "date".');

  const locale = options.locale ?? "en-US";
  const timeZone = options.timeZone ?? "America/Indiana/Indianapolis";
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(options.date);
  const instant = hasOffset ? new Date(options.date) : wallClockToInstant(options.date, timeZone);
  if (Number.isNaN(instant.getTime())) throw new Error(`util.formatDateTime: "${options.date}" isn't a parseable date.`);

  const formatted = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
  return { formatted, isoInstant: instant.toISOString() };
};
