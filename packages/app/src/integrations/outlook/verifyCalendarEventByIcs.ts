import type { ScriptAction } from "@skye/form-config";
import { icsContainsVerificationMarker, unfoldIcs } from "./calendarVerificationMarker.js";

export interface VerifyCalendarEventByIcsOptions {
  /**
   * The URL to fetch for ICS content — expected to be an author-configured server-side proxy
   * endpoint that fetches the real published-calendar ICS feed on SKYE's behalf and returns it
   * with CORS headers permitting SKYE's own origin. A browser can't fetch a published Outlook ICS
   * feed directly — confirmed against a real tenant (see CLAUDE.md), Microsoft's endpoint sets no
   * Access-Control-Allow-Origin header at all. SKYE has no such proxy built in; this action assumes
   * one already exists and is reachable at this URL. Author-supplied via the form config
   * (skye_data), same trust level as the httpRequest postAction's own `url` field — never
   * hardcoded here, and never assumed to be any particular calendar.
   */
  icsProxyUrl: string;
  /** The id embedded by outlook.buildCalendarEventDeepLink's returned verificationId. */
  verificationId: string;
}

/**
 * Confirms whether an event built with outlook.buildCalendarEventDeepLink was actually saved, by
 * fetching ICS content (through the configured proxy — see icsProxyUrl above) and searching for
 * the marker that action embedded. Deliberately returns only a boolean + the id checked, never the
 * raw ICS text, into {{results...}} — the calendar's full contents (every other event in it too)
 * shouldn't flow into postAction templating just because one event needed confirming.
 * Registered as "outlook.verifyCalendarEventByIcs" — see ../registry.ts.
 */
export const verifyCalendarEventByIcs: ScriptAction = async (args, ctx) => {
  const options = args[0] as VerifyCalendarEventByIcsOptions | undefined;
  if (!options?.icsProxyUrl || !options.verificationId) {
    throw new Error('outlook.verifyCalendarEventByIcs requires "icsProxyUrl" and "verificationId".');
  }

  const response = await ctx.httpFetch(options.icsProxyUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`outlook.verifyCalendarEventByIcs: proxy request failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  // A defensive shape check, not full RFC 5545 validation — fails clearly if the proxy returned
  // something that isn't ICS at all (misconfigured proxy, wrong URL, an HTML error page, ...)
  // rather than silently reporting "not found" for a check that never actually ran.
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new Error("outlook.verifyCalendarEventByIcs: response doesn't look like ICS content (no BEGIN:VCALENDAR) — check icsProxyUrl.");
  }

  const found = icsContainsVerificationMarker(unfoldIcs(text), options.verificationId);
  return { found, verificationId: options.verificationId };
};
