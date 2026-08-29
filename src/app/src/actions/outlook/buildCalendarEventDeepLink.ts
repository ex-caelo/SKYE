import type { ScriptAction } from "@skye/config";
import { buildVerificationMarker } from "./calendarVerificationMarker.js";

export interface BuildCalendarEventDeepLinkOptions {
  subject: string;
  /** ISO 8601 local time, e.g. "2026-09-01T14:00:00". */
  startDateTime: string;
  endDateTime: string;
  location?: string;
  bodyContent?: string;
  /** A unique id embedded in the event's body for later verification (see outlook.verifyCalendarEventByIcs) — generated automatically if omitted. */
  verificationId?: string;
}

/**
 * Builds a pre-filled Outlook Web "new event" deep-link URL — does NOT write the event via Graph
 * at all (Calendars.* is currently unavailable on this tenant — see CLAUDE.md's "Real-tenant Graph
 * permissions" section, and the workaround this action implements was discussed there). The
 * signed-in user completes the actual save themselves in their own Outlook.
 *
 * This action only BUILDS the URL and returns it (plus the verificationId used) — it doesn't
 * navigate anywhere itself. Chain a `redirect` postAction via `{{results.<thisActionKey>.url}}` to
 * actually send the user there, same "one action builds, a plain postAction acts on the result"
 * composition already used by teams.createChat -> teams.sendMessage. Embeds a unique marker in the
 * event body so outlook.verifyCalendarEventByIcs can later confirm the user actually saved it.
 *
 * The exact deep-link query parameters (`startdt`/`enddt`/etc.) are a commonly-observed Outlook Web
 * URL pattern, not an officially documented/stable API — worth confirming the compose screen
 * actually pre-fills correctly against a real tenant before relying on this in production.
 * Registered as "outlook.buildCalendarEventDeepLink" — see ../registry.ts.
 */
export const buildCalendarEventDeepLink: ScriptAction = async (args) => {
  const options = args[0] as BuildCalendarEventDeepLinkOptions | undefined;
  if (!options?.subject || !options.startDateTime || !options.endDateTime) {
    throw new Error('outlook.buildCalendarEventDeepLink requires "subject", "startDateTime", and "endDateTime".');
  }

  const verificationId = options.verificationId ?? crypto.randomUUID();
  // Appended, not prepended, so a human skimming the compose screen sees their own content first —
  // the marker only needs to survive being saved, not be noticed.
  const body = `${options.bodyContent ?? ""}\n\n${buildVerificationMarker(verificationId)}`;

  const params = new URLSearchParams({
    subject: options.subject,
    startdt: options.startDateTime,
    enddt: options.endDateTime,
    body,
  });
  if (options.location) params.set("location", options.location);

  const url = `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
  return { url, verificationId };
};
