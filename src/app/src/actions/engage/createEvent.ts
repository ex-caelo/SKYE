import type { ScriptAction } from "@skye/config";
import { engageFetch, hasAnyIdentifier, DEFAULT_ENGAGE_BASE_URL, type EngageUserIdentifier } from "./client.js";

/** Engage's own "EventAddress" shape — an object, not a plain string (the API's `address` field on an event is structured, per its OpenAPI schema). */
export interface EngageEventAddress {
  /** Free-text venue name, e.g. "Science Hall - 210". */
  name?: string;
  /** The full address as one string, e.g. "2455 Park Avenue, New York, NY". */
  address?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** For a virtual/online event — a join link. */
  onlineLocation?: string;
  instructions?: string;
}

export interface CreateEngageEventOptions {
  /**
   * Engage API key for this school's instance — config-supplied, never hardcoded. OPTIONAL: some
   * whitelabeled deployments route through a middleman/proxy that injects the real key itself
   * server-side, so SKYE never needs one in that case (see client.ts's engageFetch docstring).
   */
  apiKey?: string;
  /** Defaults to the standard Engage API host; override for a whitelabeled domain (see client.ts). */
  baseUrl?: string;
  submittedByOrganizationId: number;
  submittedById: EngageUserIdentifier;
  name: string;
  description: string;
  /** ISO 8601. */
  startsOn: string;
  endsOn: string;
  address: EngageEventAddress;
  organizationIds?: number[];
  categoryIds?: number[];
  imageUrl?: string;
  visibility?: "Public" | "Institution" | "Organization" | "Private";
}

/**
 * Creates an event on Campus Labs Engage (POST /v3.0/events/event) — a campus-involvement
 * platform, entirely separate from Microsoft Graph, with its own API-key auth (see client.ts).
 * Registered as "engage.createEvent" — see ../registry.ts.
 */
export const createEvent: ScriptAction = async (args, ctx) => {
  const options = args[0] as CreateEngageEventOptions | undefined;
  if (!options?.submittedByOrganizationId || !options.name || !options.description || !options.startsOn || !options.endsOn || !options.address) {
    throw new Error('engage.createEvent requires "submittedByOrganizationId", "name", "description", "startsOn", "endsOn", and "address".');
  }
  if (!hasAnyIdentifier(options.submittedById)) {
    throw new Error('engage.createEvent requires "submittedById" with at least one identifier field set (e.g. campusEmail).');
  }

  const res = await engageFetch(ctx, options.baseUrl ?? DEFAULT_ENGAGE_BASE_URL, options.apiKey, "/v3.0/events/event", {
    method: "POST",
    body: {
      submittedByOrganizationId: options.submittedByOrganizationId,
      submittedById: options.submittedById,
      name: options.name,
      description: options.description,
      startsOn: options.startsOn,
      endsOn: options.endsOn,
      address: options.address,
      organizationIds: options.organizationIds,
      categoryIds: options.categoryIds,
      imageUrl: options.imageUrl,
      visibility: options.visibility,
    },
  });

  return { eventId: res.id, name: res.name, startsOn: res.startsOn, endsOn: res.endsOn };
};
