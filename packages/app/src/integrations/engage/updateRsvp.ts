import type { ScriptAction } from "@skye/form-config";
import { engageFetch, buildReplacePatch, DEFAULT_ENGAGE_BASE_URL } from "./client.js";

export interface UpdateEngageRsvpOptions {
  apiKey?: string;
  baseUrl?: string;
  eventId: number;
  rsvpId: number;
  response?: "Yes" | "No";
  guests?: number;
}

/**
 * Updates an existing RSVP (PATCH /v3.0/events/event/{eventId}/rsvp/{id}) — e.g. changing a "Yes"
 * to a "No", or the guest count. Uses JSON Patch (RFC 6902), built from whichever optional fields
 * are actually supplied (see client.ts's buildReplacePatch).
 *
 * NOTE: confirmed directly from the real OpenAPI spec that Engage has NO delete endpoint for RSVPs
 * at all (only GET/POST/PATCH on the rsvp path) — unlike Attendance, which does support a genuine
 * DELETE. Setting `response: "No"` here is Engage's own supported way to withdraw an RSVP; there
 * is no `engage.deleteRsvp` action because there's no such endpoint to call.
 * Registered as "engage.updateRsvp" — see ../registry.ts.
 */
export const updateRsvp: ScriptAction = async (args, ctx) => {
  const options = args[0] as UpdateEngageRsvpOptions | undefined;
  if (!options?.eventId || !options.rsvpId) {
    throw new Error('engage.updateRsvp requires "eventId" and "rsvpId".');
  }

  const patch = buildReplacePatch({ response: options.response, guests: options.guests });
  if (patch.length === 0) {
    throw new Error('engage.updateRsvp requires at least one field to change ("response" or "guests").');
  }

  const res = await engageFetch(ctx, options.baseUrl ?? DEFAULT_ENGAGE_BASE_URL, options.apiKey, `/v3.0/events/event/${options.eventId}/rsvp/${options.rsvpId}`, {
    method: "PATCH",
    body: patch,
  });

  return { rsvpId: res.id, eventId: res.eventId, response: res.response, guests: res.guests };
};
