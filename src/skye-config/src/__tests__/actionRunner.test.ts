import { describe, it, expect, vi } from "vitest";
import { runTriggerPhase } from "../actions/actionRunner.js";
import { createDefaultHandlerRegistry } from "../actions/defaultHandlerRegistry.js";
import type { ActionExecutionContext } from "../actions/handlers/registry.js";
import type { PostAction } from "../schema/types.js";

// Mirrors the afterSubmit chain in form.config.example.json: createFollowupTicket -> notifyCatering,
// both guarded by `when: attendingBanquet === true`.
const postActions: Record<string, PostAction> = {
  createFollowupTicket: {
    trigger: "afterSubmit",
    type: "httpRequest",
    when: { field: "attendingBanquet", operator: "equals", value: true },
    request: { url: "https://tickets.example.com/api/tickets", method: "POST", body: { subject: "{{fields.name}}" } },
  },
  notifyCatering: {
    trigger: "afterSubmit",
    type: "httpRequest",
    when: { field: "attendingBanquet", operator: "equals", value: true },
    dependsOn: ["createFollowupTicket"],
    request: {
      url: "https://hooks.example.com/banquet-headcount",
      method: "POST",
      body: { ticketId: "{{results.createFollowupTicket.ticketId}}" },
    },
  },
};

function makeContext(httpFetch: ActionExecutionContext["httpFetch"], resultsSoFar: Record<string, unknown>): ActionExecutionContext {
  return {
    templateContext: { fields: { name: "Jane Doe", attendingBanquet: true }, item: { id: "1" }, results: resultsSoFar },
    httpFetch,
    graphFetch: vi.fn(),
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
    scriptActions: {},
  };
}

describe("runTriggerPhase", () => {
  it("runs a dependent action after its dependency, threading {{results...}} through", async () => {
    const httpFetch = vi.fn<ActionExecutionContext["httpFetch"]>(async (url) => {
      if (url.includes("tickets.example.com")) {
        return new Response(JSON.stringify({ ticketId: "TCK-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const { outcomes, results, errors } = await runTriggerPhase(
      postActions,
      "afterSubmit",
      { attendingBanquet: true },
      createDefaultHandlerRegistry(),
      (resultsSoFar) => makeContext(httpFetch, resultsSoFar)
    );

    expect(errors).toEqual({});
    expect(outcomes).toEqual({ createFollowupTicket: "ran", notifyCatering: "ran" });
    expect(results.createFollowupTicket).toEqual({ ticketId: "TCK-1" });

    // The second call's body should have received the first action's ticketId via {{results...}}.
    const secondCallBody = JSON.parse(httpFetch.mock.calls[1][1].body as string);
    expect(secondCallBody.ticketId).toBe("TCK-1");
  });

  it("skips a `when: false` action and cascade-skips its dependent, without calling httpFetch", async () => {
    const httpFetch = vi.fn(async () => new Response("{}", { status: 200 }));

    const { outcomes, errors } = await runTriggerPhase(
      postActions,
      "afterSubmit",
      { attendingBanquet: false },
      createDefaultHandlerRegistry(),
      (resultsSoFar) => makeContext(httpFetch, resultsSoFar)
    );

    expect(outcomes).toEqual({ createFollowupTicket: "skipped", notifyCatering: "skipped" });
    expect(errors).toEqual({});
    expect(httpFetch).not.toHaveBeenCalled();
  });
});
