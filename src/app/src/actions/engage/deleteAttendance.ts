import type { ScriptAction } from "@skye/config";
import { engageFetch, DEFAULT_ENGAGE_BASE_URL } from "./client.js";

export interface DeleteEngageAttendanceOptions {
  apiKey?: string;
  baseUrl?: string;
  eventId: number;
  attendanceId: number;
}

/**
 * Deletes an attendance record outright (DELETE /v3.0/events/event/{eventId}/attendance/{id}) —
 * unlike events (which have no true delete, only cancellation), Attendance genuinely supports a
 * real DELETE, confirmed directly from the OpenAPI spec.
 * Registered as "engage.deleteAttendance" — see ../registry.ts.
 */
export const deleteAttendance: ScriptAction = async (args, ctx) => {
  const options = args[0] as DeleteEngageAttendanceOptions | undefined;
  if (!options?.eventId || !options.attendanceId) {
    throw new Error('engage.deleteAttendance requires "eventId" and "attendanceId".');
  }

  await engageFetch(ctx, options.baseUrl ?? DEFAULT_ENGAGE_BASE_URL, options.apiKey, `/v3.0/events/event/${options.eventId}/attendance/${options.attendanceId}`, {
    method: "DELETE",
  });

  return { deleted: true, eventId: options.eventId, attendanceId: options.attendanceId };
};
