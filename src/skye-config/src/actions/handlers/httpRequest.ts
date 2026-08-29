import type { ActionExecutionContext } from "./registry.js";
import type { PostAction } from "../../schema/types.js";
import { interpolate } from "../templating.js";

/** Fires a plain HTTP request, interpolating {{fields.x}}/{{item.x}}/{{results.x.y}} into url/headers/params/body. Returns the parsed JSON response body (or undefined if the response wasn't JSON). */
export async function httpRequestHandler(action: PostAction, ctx: ActionExecutionContext): Promise<unknown> {
  if (!action.request) throw new Error("httpRequest postAction is missing `request`.");

  const baseUrl = interpolate(action.request.url, ctx.templateContext) as string;
  const headers = (interpolate(action.request.headers ?? {}, ctx.templateContext) as Record<string, string>) ?? {};
  const body = action.request.body !== undefined ? interpolate(action.request.body, ctx.templateContext) : undefined;

  // `params` is a separate query-string bag rather than requiring the author to hand-build a
  // query string inside `url` themselves — appended after interpolation, so a param VALUE can
  // still use {{fields.x}} even though it's not part of the templated `url` string itself.
  const params = interpolate(action.request.params ?? {}, ctx.templateContext) as Record<string, string>;
  const query = new URLSearchParams(params).toString();
  const url = query ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${query}` : baseUrl;

  const response = await ctx.httpFetch(url, {
    method: action.request.method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`httpRequest postAction failed: ${response.status} ${response.statusText}`);
  }

  // Best-effort JSON parse — a handler's result only matters if a later action references it via {{results...}}.
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
