import type { ActionExecutionContext } from "@skye/form-config";

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
    // Response body only — never echoes the request back into an error. Graph's actual diagnostic
    // detail (error.code/error.message — e.g. "One or more added object references already exist")
    // lives in the body, not the status line; without this, every failure here was reported as a
    // bare "400 Bad Request" with no way to tell WHY short of reproducing it with network tooling —
    // confirmed a real, live diagnosability gap chasing an otherwise-unexplained /chats 400.
    const text = await response.text().catch(() => "");
    throw new Error(`Graph request to "${path}" failed: ${response.status} ${response.statusText} — ${text.slice(0, 300)}`);
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
