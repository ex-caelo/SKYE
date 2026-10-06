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

    const result = await createChat(
      [{ memberUserIds: ["u1@x.edu", "u2@x.edu", "u3@x.edu"], topic: "Event planning" }],
      makeContext(graphFetch)
    );

    expect(graphFetch).toHaveBeenCalledWith("/chats", expect.objectContaining({ method: "POST" }));
    const body = requestBody(graphFetch);
    expect(body.chatType).toBe("group");
    expect(body.topic).toBe("Event planning");
    expect((body.members as unknown[]).length).toBe(3);
    expect(result).toEqual({ chatId: "chat1", webUrl: "https://teams/chat1" });
  });

  it("defaults to oneOnOne for exactly 2 members and omits topic", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "chat2" }), { status: 201 }));
    await createChat([{ memberUserIds: ["u1@x.edu", "u2@x.edu"] }], makeContext(graphFetch));
    const body = requestBody(graphFetch);
    expect(body.chatType).toBe("oneOnOne");
    expect(body.topic).toBeUndefined();
  });

  it("rejects a topic on a oneOnOne chat", async () => {
    await expect(createChat([{ memberUserIds: ["u1@x.edu", "u2@x.edu"], topic: "nope" }], makeContext(vi.fn()))).rejects.toThrow(
      /can't have a topic/
    );
  });

  it("accepts a bare Entra object id (GUID) as well as a UPN/email", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "chat5" }), { status: 201 }));
    await createChat(
      [{ memberUserIds: ["u1@x.edu", "3fa85f64-5717-4562-b3fc-2c963f66afa6"] }],
      makeContext(graphFetch)
    );
    expect(requestBody(graphFetch).members).toHaveLength(2);
  });

  it("rejects a memberUserIds entry that looks like a SharePoint LookupId, not a Graph user id/UPN — the real live bug behind an opaque Teams 403", async () => {
    // Graph's own rejection here was maximally unhelpful: a 403 "OperationFailed... One or more
    // members cannot be added to the thread roster," naming no specific id. Root cause: a
    // peoplePicker field's `{{fields.x}}` falls back to its SharePoint column's own numeric
    // LookupId when that column's cached Email is blank (a real, documented tenant quirk) — valid
    // for WRITING a SharePoint personOrGroup column, meaningless to Graph's /users/{id}. This
    // check catches it before the request even goes out, naming the actual bad value.
    await expect(createChat([{ memberUserIds: ["u1@x.edu", "22"] }], makeContext(vi.fn()))).rejects.toThrow(
      /"22".*doesn't look like a Microsoft Graph user id\/UPN/
    );
  });

  it("requires at least one member", async () => {
    await expect(createChat([{ memberUserIds: [] }], makeContext(vi.fn()))).rejects.toThrow(/memberUserIds/);
  });

  it("de-duplicates memberUserIds (case-insensitive) before building the request — the real live bug: Graph rejects a duplicate member with a 400", async () => {
    // The Luddy approve button's reviewer field is explicitly "pick yourself," so overlapping with
    // the host/a cohost is a real, expected case, not a config-authoring mistake — Graph's own
    // error was literal: "Duplicate chat members is specified in the request body."
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "chat3", webUrl: "https://teams/chat3" }), { status: 201 }));
    await createChat(
      [{ memberUserIds: ["host@iu.edu", "Host@iu.edu", "cohost@iu.edu"], chatType: "group" }],
      makeContext(graphFetch)
    );
    const body = requestBody(graphFetch);
    const boundUsers = (body.members as Array<{ "user@odata.bind": string }>).map((m) => m["user@odata.bind"]);
    expect(boundUsers).toEqual([
      "https://graph.microsoft.com/v1.0/users('host@iu.edu')",
      "https://graph.microsoft.com/v1.0/users('cohost@iu.edu')",
    ]);
  });

  it("picks chatType from the DE-DUPLICATED member count, not the raw one", async () => {
    // 3 raw ids that collapse to 2 unique people should still auto-pick "oneOnOne", not "group".
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "chat4" }), { status: 201 }));
    await createChat([{ memberUserIds: ["a@x.edu", "A@x.edu", "b@x.edu"] }], makeContext(graphFetch));
    expect(requestBody(graphFetch).chatType).toBe("oneOnOne");
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
