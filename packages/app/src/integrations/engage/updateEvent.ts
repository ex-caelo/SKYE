import type { ScriptAction } from "@skye/form-config";
import { engageFetch, buildReplacePatch, hasAnyIdentifier, DEFAULT_ENGAGE_BASE_URL, type EngageUserIdentifier, type JsonPatchOp } from "./client.js";
import type { EngageEventAddress } from "./createEvent.js";

export interface UpdateEngageEventOptions {
  apiKey?: string;
  baseUrl?: string;
  eventId: number;
  /**
   * Required on EVERY update, per Engage's own documented behavior — the update endpoint creates
   * a new Event Submission tied to this user, regardless of which other fields are changing.
   */
  submittedById: EngageUserIdentifier;
  name?: string;
  description?: string;
  /** ISO 8601 — the field to change to move an event's time. */
  startsOn?: string;
  endsOn?: string;
  address?: EngageEventAddress;
  organizationIds?: number[];
  categoryIds?: number[];
  imageUrl?: string;
  visibility?: "Public" | "Institution" | "Organization" | "Private";
}

/**
 * Updates an existing Engage event's properties (PATCH /v3.0/events/event/{id}) — e.g. changing
 * its time. Engage's own spec is explicit that the event's cancellation State can NOT be changed
 * through this endpoint — use engage.cancelEvent instead (there's no true DELETE for events at
 * all; cancellation is the deletion-equivalent).
 *
 * Uses JSON Patch (RFC 6902), not a plain partial object — this action builds that from a simple
 * flat "what's changing" options object (via buildReplacePatch) so a form author never has to
 * author raw JSON Patch syntax themselves. Registered as "engage.updateEvent" — see ../registry.ts.
 */
export const updateEvent: ScriptAction = async (args, ctx) => {
  const options = args[0] as UpdateEngageEventOptions | undefined;
  if (!options?.eventId) throw new Error('engage.updateEvent requires "eventId".');
  if (!hasAnyIdentifier(options.submittedById)) {
    throw new Error(
      'engage.updateEvent requires "submittedById" with at least one identifier field set (e.g. campusEmail) — Engage requires this on every update, regardless of what else is changing.'
    );
  }

  // submittedById uses "add" (matching Engage's own documented example verbatim); every other
  // changed field is a "replace" op built from whichever optional fields were actually supplied.
  const patch: JsonPatchOp[] = [
    { op: "add", path: "/submittedById", value: options.submittedById },
    ...buildReplacePatch({
      name: options.name,
      description: options.description,
      startsOn: options.startsOn,
      endsOn: options.endsOn,
      address: options.address,
      organizationIds: options.organizationIds,
      categoryIds: options.categoryIds,
      imageUrl: options.imageUrl,
      visibility: options.visibility,
    }),
  ];

  const res = await engageFetch(ctx, options.baseUrl ?? DEFAULT_ENGAGE_BASE_URL, options.apiKey, `/v3.0/events/event/${options.eventId}`, {
    method: "PATCH",
    body: patch,
  });

  return { eventId: res.id, name: res.name, startsOn: res.startsOn, endsOn: res.endsOn };
};
