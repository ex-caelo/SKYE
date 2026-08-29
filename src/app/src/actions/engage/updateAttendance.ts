import type { ScriptAction } from "@skye/config";
import { engageFetch, buildReplacePatch, DEFAULT_ENGAGE_BASE_URL } from "./client.js";

export interface UpdateEngageAttendanceOptions {
  apiKey?: string;
  baseUrl?: string;
  eventId: number;
  attendanceId: number;
  status?: "Absent" | "Attended" | "Excused" | "Na";
  email?: string;
  externalIdentifier?: string;
  swipeCardIdentifier?: string;
}

/**
 * Updates an existing attendance record (PATCH /v3.0/events/event/{eventId}/attendance/{id}) —
 * e.g. correcting a status. Uses JSON Patch (RFC 6902), built from whichever optional fields are
 * actually supplied (see client.ts's buildReplacePatch), not a plain partial object. Deliberately
 * doesn't accept a new `userId` here — re-identifying WHO an existing attendance record belongs to
 * is an unusual enough operation that engage.deleteAttendance + engage.recordAttendance (fresh)
 * is the clearer path for that case.
 * Registered as "engage.updateAttendance" — see ../registry.ts.
 */
export const updateAttendance: ScriptAction = async (args, ctx) => {
  const options = args[0] as UpdateEngageAttendanceOptions | undefined;
  if (!options?.eventId || !options.attendanceId) {
    throw new Error('engage.updateAttendance requires "eventId" and "attendanceId".');
  }

  const patch = buildReplacePatch({
    status: options.status,
    email: options.email,
    externalIdentifier: options.externalIdentifier,
    swipeCardIdentifier: options.swipeCardIdentifier,
  });
  if (patch.length === 0) {
    throw new Error('engage.updateAttendance requires at least one field to change ("status", "email", "externalIdentifier", or "swipeCardIdentifier").');
  }

  const res = await engageFetch(
    ctx,
    options.baseUrl ?? DEFAULT_ENGAGE_BASE_URL,
    options.apiKey,
    `/v3.0/events/event/${options.eventId}/attendance/${options.attendanceId}`,
    { method: "PATCH", body: patch }
  );

  return { attendanceId: res.id, eventId: res.eventId, status: res.status };
};
