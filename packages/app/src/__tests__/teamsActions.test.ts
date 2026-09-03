import { describe, it, expect, vi } from "vitest";
import type { ActionExecutionContext } from "@skye/form-config";
import { createChat } from "../integrations/teams/createChat.js";
import { sendMessage } from "../integrations/teams/sendMessage.js";
import { scheduleMeeting } from "../integrations/teams/scheduleMeeting.js";

function makeContext(graphFetch: ActionExecutionContext["graphFetch"]): ActionExecutionContext {
  return {
    templateContext: { fields: {}, item: {}, results: {} },
    httpFetch: vi.fn(),
    graphFetch,
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
    scriptActions: {},
  };
}

function requestBody(graphFetch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse((graphFetch.mock.calls[0][1] as RequestInit).body as string);
}

describe("teams.createChat", () => {
  it("creates a group chat with a topic when given more than 2 members", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "chat1", webUrl: "https://teams/chat1" }), { status: 201 }));

    const result = await createChat([{ memberUserIds: ["u1", "u2", "u3"], topic: "Event planning" }], makeContext(graphFetch));

    expect(graphFetch).toHaveBeenCalledWith("/chats", expect.objectContaining({ method: "POST" }));
    const body = requestBody(graphFetch);
    expect(body.chatType).toBe("group");
    expect(body.topic).toBe("Event planning");
    expect((body.members as unknown[]).length).toBe(3);
    expect(result).toEqual({ chatId: "chat1", webUrl: "https://teams/chat1" });
  });

  it("defaults to oneOnOne for exactly 2 members and omits topic", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "chat2" }), { status: 201 }));
    await createChat([{ memberUserIds: ["u1", "u2"] }], makeContext(graphFetch));
    const body = requestBody(graphFetch);
    expect(body.chatType).toBe("oneOnOne");
    expect(body.topic).toBeUndefined();
  });

  it("rejects a topic on a oneOnOne chat", async () => {
    await expect(createChat([{ memberUserIds: ["u1", "u2"], topic: "nope" }], makeContext(vi.fn()))).rejects.toThrow(/can't have a topic/);
  });

  it("requires at least one member", async () => {
    await expect(createChat([{ memberUserIds: [] }], makeContext(vi.fn()))).rejects.toThrow(/memberUserIds/);
  });
});

describe("teams.sendMessage", () => {
  it("sends plain text content", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg1" }), { status: 201 }));
    const result = await sendMessage([{ chatId: "chat1", message: "Hello" }], makeContext(graphFetch));
    expect(graphFetch).toHaveBeenCalledWith("/chats/chat1/messages", expect.objectContaining({ method: "POST" }));
    const body = requestBody(graphFetch);
    expect((body.body as Record<string, unknown>).content).toBe("Hello");
    expect(result).toEqual({ messageId: "msg1" });
  });

  it("sends an adaptive card as an attachment", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg2" }), { status: 201 }));
    const card = { type: "AdaptiveCard", body: [] };
    await sendMessage([{ chatId: "chat1", adaptiveCard: card }], makeContext(graphFetch));
    const body = requestBody(graphFetch);
    const attachment = (body.attachments as Array<Record<string, unknown>>)[0];
    expect(attachment.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(JSON.parse(attachment.content as string)).toEqual(card);
    expect((body.body as Record<string, unknown>).content).toContain("<attachment");
  });

  it("requires chatId, and either message or adaptiveCard", async () => {
    await expect(sendMessage([{ chatId: "", message: "hi" }], makeContext(vi.fn()))).rejects.toThrow(/chatId/);
    await expect(sendMessage([{ chatId: "chat1" }], makeContext(vi.fn()))).rejects.toThrow(/message.*adaptiveCard/);
  });
});

describe("teams.scheduleMeeting", () => {
  it("creates a calendar event with isOnlineMeeting/teamsForBusiness set, and returns the join URL", async () => {
    const graphFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "evt1", onlineMeeting: { joinUrl: "https://teams.microsoft.com/join1" } }), { status: 201 }));

    const result = await scheduleMeeting(
      [{ subject: "Kickoff", startDateTime: "2026-09-01T14:00:00", endDateTime: "2026-09-01T15:00:00", attendees: [{ email: "a@b.com" }] }],
      makeContext(graphFetch)
    );

    expect(graphFetch).toHaveBeenCalledWith("/users/me/events", expect.objectContaining({ method: "POST" }));
    const body = requestBody(graphFetch);
    expect(body.isOnlineMeeting).toBe(true);
    expect(body.onlineMeetingProvider).toBe("teamsForBusiness");
    expect(result).toEqual({ eventId: "evt1", joinUrl: "https://teams.microsoft.com/join1" });
  });

  it("targets a specific organizer mailbox when organizerUserId is given", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "evt2" }), { status: 201 }));
    await scheduleMeeting(
      [{ organizerUserId: "events@example.com", subject: "x", startDateTime: "2026-09-01T14:00:00", endDateTime: "2026-09-01T15:00:00" }],
      makeContext(graphFetch)
    );
    expect(graphFetch).toHaveBeenCalledWith("/users/events@example.com/events", expect.anything());
  });

  it("requires subject/startDateTime/endDateTime", async () => {
    await expect(scheduleMeeting([{ subject: "x", startDateTime: "", endDateTime: "" }], makeContext(vi.fn()))).rejects.toThrow(/requires/);
  });
});
