import type { ActionExecutionContext } from "@skye/config";

/**
 * Default Engage API host — some schools' requests go through a whitelabeled domain instead (e.g.
 * their own campus-branded URL), so every action accepts an optional `baseUrl` override rather
 * than hardcoding this. This is only the fallback used when a form config doesn't supply one.
 */
export const DEFAULT_ENGAGE_BASE_URL = "https://engage-api.campuslabs.com/api";

/**
 * Identifies an Engage user by any ONE of several identifier types (Engage's own "UserIdentifier"
 * shape, from its OpenAPI spec) — a form author supplies whichever one the form actually collects,
 * most commonly `campusEmail`. All optional at the type level since Engage accepts any single one;
 * each action's own validation (hasAnyIdentifier below) checks that at least one was actually given.
 */
export interface EngageUserIdentifier {
  communityMemberId?: number;
  accountId?: string;
  username?: string;
  campusEmail?: string;
  swipeCardIdentifier?: string;
  sisId?: string;
}

/** True if a UserIdentifier has at least one field set — every Engage action here needs at least one to identify who the request is about. */
export function hasAnyIdentifier(userId: EngageUserIdentifier | undefined): boolean {
  if (!userId) return false;
  return Object.values(userId).some((v) => v !== undefined && v !== null && v !== "");
}

/** One RFC 6902 JSON Patch operation — the wire format Engage's PATCH endpoints (event/rsvp/attendance) actually expect, confirmed from the real OpenAPI spec (requestBody: $ref "0.0-JsonPatchBody" on all three, not a plain partial object). */
export interface JsonPatchOp {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
}

/**
 * Builds a JSON Patch "replace" op for each DEFINED key in `changes` — lets every update action
 * here accept a simple, flat "what's changing" options object instead of requiring a form author
 * to hand-author raw JSON Patch syntax themselves. Keys with an `undefined` value are skipped, so
 * a caller can pass an options object with many optional fields and only the ones actually
 * supplied become patch operations.
 */
export function buildReplacePatch(changes: Record<string, unknown>): JsonPatchOp[] {
  return Object.entries(changes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ op: "replace", path: `/${key}`, value }));
}

/**
 * Shared HTTP helper for every Engage action: builds the full URL from baseUrl + path, attaches
 * the API key (X-Engage-Api-Key header — Engage's spec also allows a `key` query string param, but
 * a header keeps the key out of URLs that might get logged by an intermediary) WHEN one is given,
 * and wraps the ok-check/JSON-parse boilerplate every action here needs — the same role
 * graphJson.ts plays for Graph-backed actions.
 *
 * `apiKey` is OPTIONAL — some whitelabeled deployments route through a middleman/proxy that
 * injects the real Engage API key itself server-side, so SKYE never sees or needs one in that
 * case. When omitted, the header is left off entirely rather than sent empty/undefined, so it
 * can't be mistaken for "authenticating as nobody" versus "the proxy handles it." When an
 * `apiKey` IS supplied (form-config `args`, never hardcoded), same trust/handling level as any
 * other secret passed through a postAction's options.
 */
export async function engageFetch(
  ctx: ActionExecutionContext,
  baseUrl: string,
  apiKey: string | undefined,
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {}
): Promise<any> {
  const { body, headers, ...rest } = init;
  const response = await ctx.httpFetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-Engage-Api-Key": apiKey } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    // Response body only — never echoes the request (and therefore never the API key) back into an error.
    const text = await response.text().catch(() => "");
    throw new Error(`Engage API request to "${path}" failed: ${response.status} ${response.statusText} — ${text.slice(0, 300)}`);
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
