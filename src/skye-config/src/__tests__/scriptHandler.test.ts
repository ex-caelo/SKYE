import { describe, it, expect, vi } from "vitest";
import { scriptHandler } from "../actions/handlers/script.js";
import type { ActionExecutionContext } from "../actions/handlers/registry.js";
import type { PostAction } from "../schema/types.js";

function makeContext(scriptActions: ActionExecutionContext["scriptActions"], resultsSoFar: Record<string, unknown> = {}): ActionExecutionContext {
  return {
    templateContext: { fields: { name: "Jane Doe" }, item: { id: "1" }, results: resultsSoFar },
    httpFetch: vi.fn(),
    graphFetch: vi.fn(),
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
    scriptActions,
  };
}

describe("scriptHandler", () => {
  it("interpolates {{fields.x}}/{{results.x}} placeholders inside args before calling the function", async () => {
    const recordedArgs: unknown[][] = [];
    const scriptActions = {
      "test.record": async (args: unknown[]) => {
        recordedArgs.push(args);
        return "ok";
      },
    };
    const action: PostAction = {
      trigger: "afterSubmit",
      type: "script",
      functionName: "test.record",
      args: [{ greeting: "Hello {{fields.name}}", ticketId: "{{results.priorAction.id}}" }],
    };

    await scriptHandler(action, makeContext(scriptActions, { priorAction: { id: "ticket-1" } }));

    expect(recordedArgs[0][0]).toEqual({ greeting: "Hello Jane Doe", ticketId: "ticket-1" });
  });

  it("throws a clear error for an unregistered functionName", async () => {
    await expect(scriptHandler({ trigger: "afterSubmit", type: "script", functionName: "not.registered" }, makeContext({}))).rejects.toThrow(
      /not registered/
    );
  });
});
