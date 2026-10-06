import { describe, it, expect, vi } from "vitest";
import type { ActionExecutionContext } from "@skye/form-config";
import { graphJson } from "../integrations/graphJson.js";

function ctxWith(graphFetch: ActionExecutionContext["graphFetch"]): ActionExecutionContext {
  return { graphFetch } as unknown as ActionExecutionContext;
}

describe("graphJson", () => {
  it("resolves the parsed body on a 2xx response", async () => {
    const ctx = ctxWith(async () => new Response(JSON.stringify({ id: "chat-1" }), { status: 201 }));
    await expect(graphJson(ctx, "/chats", { method: "POST" })).resolves.toEqual({ id: "chat-1" });
  });

  it("resolves undefined for a 2xx response with no body (e.g. sendMail's 202)", async () => {
    const ctx = ctxWith(async () => new Response(null, { status: 202 }));
    await expect(graphJson(ctx, "/sendMail", { method: "POST" })).resolves.toBeUndefined();
  });

  it("includes the real Graph error body in the thrown error, not just the status line", async () => {
    // The real live bug this fixes: the old version only reported "400 Bad Request" with no way to
    // tell WHY a /chats call was rejected (duplicate members, an invalid user, etc.) short of
    // reproducing it with network tooling — exactly what happened chasing an unexplained 400.
    const body = JSON.stringify({ error: { code: "BadRequest", message: "One or more added object references already exist." } });
    const ctx = ctxWith(async () => new Response(body, { status: 400, statusText: "Bad Request" }));
    await expect(graphJson(ctx, "/chats", { method: "POST" })).rejects.toThrow(
      'Graph request to "/chats" failed: 400 Bad Request — ' + body
    );
  });

  it("truncates an unusually long error body to 300 characters", async () => {
    const longBody = "x".repeat(500);
    const ctx = ctxWith(async () => new Response(longBody, { status: 500 }));
    await expect(graphJson(ctx, "/whatever", {})).rejects.toThrow(`Graph request to "/whatever" failed: 500  — ${"x".repeat(300)}`);
  });
});
