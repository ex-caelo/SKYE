import type { ScriptAction } from "@skye/form-config";
import { graphJson } from "../graphJson.js";

export interface CreateCalendarEventOptions {
  /** Graph user id/UPN whose calendar this goes on. Defaults to "me" (the signed-in user). */
  userId?: string;
  subject: string;
  /** ISO 8601 local time, e.g. "2026-09-01T14:00:00" — interpreted in `timeZone` (default "UTC"). */
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  attendees?: Array<{ email: string; name?: string; required?: boolean }>;
  bodyContent?: string;
  location?: string;
}

/**
 * Adds a plain (non-Teams) event to a calendar (POST /users/{id}/events).
 * For a Teams meeting that also emails attendees a join link, see
 * teams.scheduleMeeting instead — same underlying Graph endpoint, with
 * `isOnlineMeeting`/`onlineMeetingProvider` added.
 * Registered as "outlook.createCalendarEvent" — see ../registry.ts.
 */
export const createCalendarEvent: ScriptAction = async (args, ctx) => {
  const options = args[0] as CreateCalendarEventOptions | undefined;
  if (!options?.subject || !options.startDateTime || !options.endDateTime) {
    throw new Error('outlook.createCalendarEvent requires "subject", "startDateTime", and "endDateTime".');
  }

  const timeZone = options.timeZone ?? "UTC";
  const res = await graphJson(ctx, `/users/${options.userId ?? "me"}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: options.subject,
      start: { dateTime: options.startDateTime, timeZone },
      end: { dateTime: options.endDateTime, timeZone },
      body: { contentType: "HTML", content: options.bodyContent ?? "" },
      location: options.location ? { displayName: options.location } : undefined,
      attendees: (options.attendees ?? []).map((attendee) => ({
        emailAddress: { address: attendee.email, name: attendee.name },
        type: attendee.required === false ? "optional" : "required",
      })),
    }),
  });

  return { eventId: res.id, webLink: res.webLink };
};
