import type { ScriptAction } from "@skye/config";
import { engageFetch, hasAnyIdentifier, DEFAULT_ENGAGE_BASE_URL, type EngageUserIdentifier } from "./client.js";

export interface RsvpToEngageEventOptions {
  /** Optional — see client.ts's engageFetch docstring (a whitelabeled proxy may inject this itself). */
  apiKey?: string;
  baseUrl?: string;
  eventId: number;
  userId: EngageUserIdentifier;
  response: "Yes" | "No";
  guests?: number;
}

/**
 * RSVPs to an existing Engage event (POST /v3.0/events/event/{eventId}/rsvp), on behalf of the
 * user identified by `userId`. Registered as "engage.rsvpToEvent" — see ../registry.ts.
 */
export const rsvpToEvent: ScriptAction = async (args, ctx) => {
  const options = args[0] as RsvpToEngageEventOptions | undefined;
  if (!options?.eventId || !options.response) {
    throw new Error('engage.rsvpToEvent requires "eventId" and "response" ("Yes" or "No").');
  }
  if (!hasAnyIdentifier(options.userId)) {
    throw new Error('engage.rsvpToEvent requires "userId" with at least one identifier field set (e.g. campusEmail).');
  }

  const res = await engageFetch(ctx, options.baseUrl ?? DEFAULT_ENGAGE_BASE_URL, options.apiKey, `/v3.0/events/event/${options.eventId}/rsvp`, {
    method: "POST",
    body: { userId: options.userId, response: options.response, guests: options.guests },
  });

  return { rsvpId: res.id, eventId: res.eventId, response: res.response, guests: res.guests };
};
