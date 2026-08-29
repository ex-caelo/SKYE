import type { ScriptAction } from "@skye/config";
import { engageFetch, DEFAULT_ENGAGE_BASE_URL } from "./client.js";

export interface CancelEngageEventOptions {
  apiKey?: string;
  baseUrl?: string;
  eventId: number;
  /** Optional reason shown alongside the cancellation. */
  comments?: string;
}

/**
 * Cancels an Engage event (POST /v3.0/events/event/{id}/cancel) — Engage has no true DELETE for
 * events at all; cancellation (the event stays visible with State: Canceled, rather than being
 * removed outright) is the deletion-equivalent, confirmed directly from the real OpenAPI spec (no
 * DELETE method exists on the event path). `status` is deliberately NOT sent in the request body —
 * it's marked read-only on this endpoint's request schema (implied by calling /cancel at all, not
 * something the caller sets); `comments` is the only real, settable field.
 * Registered as "engage.cancelEvent" — see ../registry.ts.
 */
export const cancelEvent: ScriptAction = async (args, ctx) => {
  const options = args[0] as CancelEngageEventOptions | undefined;
  if (!options?.eventId) throw new Error('engage.cancelEvent requires "eventId".');

  const res = await engageFetch(ctx, options.baseUrl ?? DEFAULT_ENGAGE_BASE_URL, options.apiKey, `/v3.0/events/event/${options.eventId}/cancel`, {
    method: "POST",
    body: { comments: options.comments },
  });

  return { eventId: options.eventId, status: res?.status, comments: res?.comments };
};
