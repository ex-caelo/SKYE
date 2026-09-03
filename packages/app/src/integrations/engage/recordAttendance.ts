import type { ScriptAction } from "@skye/form-config";
import { engageFetch, hasAnyIdentifier, DEFAULT_ENGAGE_BASE_URL, type EngageUserIdentifier } from "./client.js";

export interface RecordEngageAttendanceOptions {
  /** Optional — see client.ts's engageFetch docstring (a whitelabeled proxy may inject this itself). */
  apiKey?: string;
  baseUrl?: string;
  eventId: number;
  userId: EngageUserIdentifier;
  status: "Absent" | "Attended" | "Excused" | "Na";
  email?: string;
  externalIdentifier?: string;
  swipeCardIdentifier?: string;
}

/**
 * Records an attendance status for a user on an existing Engage event
 * (POST /v3.0/events/event/{eventId}/attendance). Registered as "engage.recordAttendance" — see
 * ../registry.ts.
 */
export const recordAttendance: ScriptAction = async (args, ctx) => {
  const options = args[0] as RecordEngageAttendanceOptions | undefined;
  if (!options?.eventId || !options.status) {
    throw new Error('engage.recordAttendance requires "eventId" and "status" (Absent/Attended/Excused/Na).');
  }
  if (!hasAnyIdentifier(options.userId)) {
    throw new Error('engage.recordAttendance requires "userId" with at least one identifier field set (e.g. campusEmail).');
  }

  const res = await engageFetch(ctx, options.baseUrl ?? DEFAULT_ENGAGE_BASE_URL, options.apiKey, `/v3.0/events/event/${options.eventId}/attendance`, {
    method: "POST",
    body: {
      userId: options.userId,
      status: options.status,
      email: options.email,
      externalIdentifier: options.externalIdentifier,
      swipeCardIdentifier: options.swipeCardIdentifier,
    },
  });

  return { attendanceId: res.id, eventId: res.eventId, status: res.status };
};
