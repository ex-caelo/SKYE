import { describe, it, expect, vi } from "vitest";
import { runTriggerPhase, createDefaultHandlerRegistry, type ActionExecutionContext } from "@skye/form-config";
import type { PostAction } from "@skye/form-config";
import { scriptActions } from "../integrations/registry.js";

/**
 * Proves the reason teams.createChat and teams.sendMessage are two separate
 * actions rather than one combined "create and send" action: they compose
 * through the existing dependsOn + {{results.x}} chaining mechanism
 * (actionRunner/dependencyGraph/templating, all in @skye/form-config) with zero
 * new orchestration code, exactly like the createFollowupTicket ->
 * notifyCatering example in the real fixture config.
 */
describe("teams.createChat -> teams.sendMessage chaining", () => {
  it("sends a message into the chat that was just created, via {{results.createChatAction.chatId}}", async () => {
    const graphFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "chat-123", webUrl: "https://teams/chat-123" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "msg-456" }), { status: 201 }));

    const postActions: Record<string, PostAction> = {
      createChatAction: {
        trigger: "afterSubmit",
        type: "script",
        functionName: "teams.createChat",
        args: [{ memberUserIds: ["u1", "u2", "u3"], topic: "Event planning" }],
      },
      sendMessageAction: {
        trigger: "afterSubmit",
        type: "script",
        dependsOn: ["createChatAction"],
        functionName: "teams.sendMessage",
        args: [{ chatId: "{{results.createChatAction.chatId}}", message: "Welcome!" }],
      },
    };

    const makeExecutionContext = (resultsSoFar: Record<string, unknown>): ActionExecutionContext => ({
      templateContext: { fields: {}, item: {}, results: resultsSoFar },
      httpFetch: vi.fn(),
      graphFetch,
      navigate: vi.fn(),
      showMessage: vi.fn(),
      setFieldValue: vi.fn(),
      scriptActions,
    });

    const result = await runTriggerPhase(postActions, "afterSubmit", {}, createDefaultHandlerRegistry(), makeExecutionContext);

    expect(result.errors).toEqual({});
    expect(result.results.createChatAction).toEqual({ chatId: "chat-123", webUrl: "https://teams/chat-123" });
    expect(result.results.sendMessageAction).toEqual({ messageId: "msg-456" });

    // The second call's chatId came from the first call's real result, not a hardcoded placeholder.
    expect(graphFetch).toHaveBeenNthCalledWith(2, "/chats/chat-123/messages", expect.anything());
  });
});
