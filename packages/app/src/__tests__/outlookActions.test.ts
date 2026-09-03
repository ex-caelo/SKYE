import { describe, it, expect, vi } from "vitest";
import type { ActionExecutionContext } from "@skye/form-config";
import { createCalendarEvent } from "../integrations/outlook/createCalendarEvent.js";
import { sendEmail } from "../integrations/outlook/sendEmail.js";

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

describe("outlook.createCalendarEvent", () => {
  it("creates a plain event (no online-meeting fields) on the given user's calendar", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "evt1", webLink: "https://outlook.office.com/evt1" }), { status: 201 }));

    const result = await createCalendarEvent(
      [
        {
          userId: "events@example.com",
          subject: "Banquet",
          startDateTime: "2026-09-01T18:00:00",
          endDateTime: "2026-09-01T20:00:00",
          location: "Union Ballroom",
          attendees: [{ email: "a@b.com", required: false }],
        },
      ],
      makeContext(graphFetch)
    );

    expect(graphFetch).toHaveBeenCalledWith("/users/events@example.com/events", expect.objectContaining({ method: "POST" }));
    const body = requestBody(graphFetch);
    expect(body.isOnlineMeeting).toBeUndefined();
    expect((body.location as Record<string, unknown>).displayName).toBe("Union Ballroom");
    expect((body.attendees as Array<Record<string, unknown>>)[0].type).toBe("optional");
    expect(result).toEqual({ eventId: "evt1", webLink: "https://outlook.office.com/evt1" });
  });

  it("defaults to the signed-in user's calendar when userId is omitted", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "evt2" }), { status: 201 }));
    await createCalendarEvent([{ subject: "x", startDateTime: "2026-09-01T14:00:00", endDateTime: "2026-09-01T15:00:00" }], makeContext(graphFetch));
    expect(graphFetch).toHaveBeenCalledWith("/users/me/events", expect.anything());
  });

  it("requires subject/startDateTime/endDateTime", async () => {
    await expect(createCalendarEvent([{ subject: "", startDateTime: "", endDateTime: "" }], makeContext(vi.fn()))).rejects.toThrow(/requires/);
  });
});

describe("outlook.sendEmail", () => {
  it("sends mail via the given mailbox with recipients mapped correctly", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    const result = await sendEmail(
      [{ userId: "events@example.com", subject: "Reminder", bodyContent: "<p>Hi</p>", toRecipients: ["a@b.com"], ccRecipients: ["c@d.com"] }],
      makeContext(graphFetch)
    );

    expect(graphFetch).toHaveBeenCalledWith("/users/events@example.com/sendMail", expect.objectContaining({ method: "POST" }));
    const body = requestBody(graphFetch);
    const message = body.message as Record<string, unknown>;
    expect((message.toRecipients as Array<Record<string, unknown>>)[0]).toEqual({ emailAddress: { address: "a@b.com" } });
    expect((message.ccRecipients as Array<Record<string, unknown>>)[0]).toEqual({ emailAddress: { address: "c@d.com" } });
    expect(body.saveToSentItems).toBe(true);
    expect(result).toEqual({ sent: true });
  });

  it("handles Graph's 202-with-no-body response without throwing", async () => {
    const graphFetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(sendEmail([{ subject: "x", bodyContent: "y", toRecipients: ["a@b.com"] }], makeContext(graphFetch))).resolves.toEqual({ sent: true });
  });

  it("requires subject/bodyContent/at least one recipient", async () => {
    await expect(sendEmail([{ subject: "", bodyContent: "", toRecipients: [] }], makeContext(vi.fn()))).rejects.toThrow(/requires/);
  });
});
