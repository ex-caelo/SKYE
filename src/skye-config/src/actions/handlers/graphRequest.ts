import type { ActionExecutionContext } from "./registry.js";
import type { PostAction } from "../../schema/types.js";
import { interpolate } from "../templating.js";

/** Fires an authenticated Microsoft Graph request through the app-provided graphFetch (which owns token acquisition/refresh). */
export async function graphRequestHandler(action: PostAction, ctx: ActionExecutionContext): Promise<unknown> {
  if (!action.request) throw new Error("graphRequest postAction is missing `request`.");

  const path = interpolate(action.request.url, ctx.templateContext) as string;
  const body = action.request.body !== undefined ? interpolate(action.request.body, ctx.templateContext) : undefined;

  const response = await ctx.graphFetch(path, {
    method: action.request.method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`graphRequest postAction failed: ${response.status} ${response.statusText}`);
  }

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
