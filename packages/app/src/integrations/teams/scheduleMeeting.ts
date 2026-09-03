import type { ScriptAction } from "@skye/form-config";
import { graphJson } from "../graphJson.js";

export interface ScheduleTeamsMeetingOptions {
  /** Graph user id/UPN of the organizer's mailbox. Defaults to "me" (the signed-in user). */
  organizerUserId?: string;
  subject: string;
  /** ISO 8601 local time, e.g. "2026-09-01T14:00:00" — interpreted in `timeZone` (default "UTC"). */
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  attendees?: Array<{ email: string; name?: string; required?: boolean }>;
  bodyContent?: string;
}

/**
 * Schedules a Teams meeting AND emails the invite to attendees. Graph has
 * no separate "send a Teams invite" call — a Teams meeting that actually
 * notifies attendees is a calendar event with `isOnlineMeeting`/
 * `onlineMeetingProvider` set (POST /users/{id}/events), which is why this
 * looks almost identical to outlook.createCalendarEvent — see that file
 * for the plain-calendar-event version with no Teams meeting attached.
 * Registered as "teams.scheduleMeeting" — see ../registry.ts.
 */
export const scheduleMeeting: ScriptAction = async (args, ctx) => {
  const options = args[0] as ScheduleTeamsMeetingOptions | undefined;
  if (!options?.subject || !options.startDateTime || !options.endDateTime) {
    throw new Error('teams.scheduleMeeting requires "subject", "startDateTime", and "endDateTime".');
  }

  const timeZone = options.timeZone ?? "UTC";
  const res = await graphJson(ctx, `/users/${options.organizerUserId ?? "me"}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: options.subject,
      start: { dateTime: options.startDateTime, timeZone },
      end: { dateTime: options.endDateTime, timeZone },
      body: { contentType: "HTML", content: options.bodyContent ?? "" },
      attendees: (options.attendees ?? []).map((attendee) => ({
        emailAddress: { address: attendee.email, name: attendee.name },
        type: attendee.required === false ? "optional" : "required",
      })),
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    }),
  });

  return { eventId: res.id, joinUrl: res.onlineMeeting?.joinUrl };
};
