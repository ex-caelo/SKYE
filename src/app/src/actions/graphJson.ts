import type { ActionExecutionContext } from "@skye/config";

/**
 * Shared by every Graph-backed script action in this directory: fires
 * ctx.graphFetch (the same authenticated Graph fetch the built-in
 * graphRequest postAction uses), throws a clear error on a non-2xx
 * response, and best-effort parses a JSON body — some Graph calls (e.g.
 * sendMail) return 202 with no body at all.
 */
export async function graphJson(ctx: ActionExecutionContext, path: string, init: RequestInit): Promise<any> {
  const response = await ctx.graphFetch(path, init);
  if (!response.ok) {
    throw new Error(`Graph request to "${path}" failed: ${response.status} ${response.statusText}`);
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
