import { describe, it, expect, vi } from "vitest";
import type { ActionExecutionContext } from "@skye/config";
import { hasAnyIdentifier, buildReplacePatch, DEFAULT_ENGAGE_BASE_URL } from "../actions/engage/client.js";
import { createEvent } from "../actions/engage/createEvent.js";
import { updateEvent } from "../actions/engage/updateEvent.js";
import { cancelEvent } from "../actions/engage/cancelEvent.js";
import { rsvpToEvent } from "../actions/engage/rsvpToEvent.js";
import { updateRsvp } from "../actions/engage/updateRsvp.js";
import { recordAttendance } from "../actions/engage/recordAttendance.js";
import { updateAttendance } from "../actions/engage/updateAttendance.js";
import { deleteAttendance } from "../actions/engage/deleteAttendance.js";

function makeContext(httpFetch: ActionExecutionContext["httpFetch"]): ActionExecutionContext {
  return {
    templateContext: { fields: {}, item: {}, results: {} },
    httpFetch,
    graphFetch: vi.fn(),
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
    scriptActions: {},
  };
}

function requestBody(httpFetch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse((httpFetch.mock.calls[0][1] as RequestInit).body as string);
}

describe("hasAnyIdentifier", () => {
  it("is true when at least one identifier field is set", () => {
    expect(hasAnyIdentifier({ campusEmail: "a@iu.edu" })).toBe(true);
  });

  it("is false for undefined, empty object, or all-empty fields", () => {
    expect(hasAnyIdentifier(undefined)).toBe(false);
    expect(hasAnyIdentifier({})).toBe(false);
    expect(hasAnyIdentifier({ campusEmail: "" })).toBe(false);
  });
});

describe("buildReplacePatch", () => {
  it("builds one replace op per defined key, in RFC 6902 shape", () => {
    expect(buildReplacePatch({ status: "Excused", guests: 2 })).toEqual([
      { op: "replace", path: "/status", value: "Excused" },
      { op: "replace", path: "/guests", value: 2 },
    ]);
  });

  it("skips keys whose value is undefined, so only actually-supplied fields become patch ops", () => {
    expect(buildReplacePatch({ status: "Excused", guests: undefined })).toEqual([{ op: "replace", path: "/status", value: "Excused" }]);
  });

  it("returns an empty array when nothing is defined", () => {
    expect(buildReplacePatch({ a: undefined, b: undefined })).toEqual([]);
  });
});

describe("engage.createEvent", () => {
  it("posts to /v3.0/events/event with the X-Engage-Api-Key header, using the default base URL", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 42, name: "Kickoff", startsOn: "2026-09-01T14:00:00", endsOn: "2026-09-01T15:00:00" }), { status: 200 }));

    const result = await createEvent(
      [
        {
          apiKey: "test-key",
          submittedByOrganizationId: 7,
          submittedById: { campusEmail: "a@iu.edu" },
          name: "Kickoff",
          description: "Fall kickoff event",
          startsOn: "2026-09-01T14:00:00",
          endsOn: "2026-09-01T15:00:00",
          address: { name: "Union", city: "Bloomington", state: "IN" },
        },
      ],
      makeContext(httpFetch)
    );

    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_ENGAGE_BASE_URL}/v3.0/events/event`);
    expect((init.headers as Record<string, string>)["X-Engage-Api-Key"]).toBe("test-key");
    expect(requestBody(httpFetch).name).toBe("Kickoff");
    expect(result).toEqual({ eventId: 42, name: "Kickoff", startsOn: "2026-09-01T14:00:00", endsOn: "2026-09-01T15:00:00" });
  });

  it("uses a whitelabeled baseUrl override instead of the default host", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    await createEvent(
      [
        {
          apiKey: "k",
          baseUrl: "https://union.iu.edu/api",
          submittedByOrganizationId: 1,
          submittedById: { campusEmail: "a@iu.edu" },
          name: "x",
          description: "x",
          startsOn: "2026-09-01T14:00:00",
          endsOn: "2026-09-01T15:00:00",
          address: { address: "123 Main St" },
        },
      ],
      makeContext(httpFetch)
    );
    expect(httpFetch.mock.calls[0][0]).toBe("https://union.iu.edu/api/v3.0/events/event");
  });

  it("requires the core fields and a non-empty submittedById", async () => {
    await expect(createEvent([{ apiKey: "k" }], makeContext(vi.fn()))).rejects.toThrow(/requires/);
    await expect(
      createEvent(
        [{ apiKey: "k", submittedByOrganizationId: 1, name: "x", description: "x", startsOn: "s", endsOn: "e", address: {} }],
        makeContext(vi.fn())
      )
    ).rejects.toThrow(/submittedById/);
  });

  it("works with no apiKey at all — a whitelabeled proxy may inject its own — and omits the header entirely rather than sending it empty", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1, name: "x" }), { status: 200 }));
    await createEvent(
      [
        {
          submittedByOrganizationId: 1,
          submittedById: { campusEmail: "a@iu.edu" },
          name: "x",
          description: "x",
          startsOn: "2026-09-01T14:00:00",
          endsOn: "2026-09-01T15:00:00",
          address: { address: "123 Main St" },
        },
      ],
      makeContext(httpFetch)
    );
    const [, init] = httpFetch.mock.calls[0];
    expect("X-Engage-Api-Key" in (init.headers as Record<string, string>)).toBe(false);
  });
});

describe("engage.updateEvent", () => {
  it("PATCHes with JSON Patch ops: submittedById as 'add', changed fields as 'replace'", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 42, name: "New Name", startsOn: "2026-09-01T16:00:00", endsOn: "2026-09-01T17:00:00" }), { status: 200 }));

    const result = await updateEvent(
      [{ eventId: 42, submittedById: { campusEmail: "a@iu.edu" }, name: "New Name", startsOn: "2026-09-01T16:00:00", endsOn: "2026-09-01T17:00:00" }],
      makeContext(httpFetch)
    );

    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_ENGAGE_BASE_URL}/v3.0/events/event/42`);
    expect(init.method).toBe("PATCH");
    expect(requestBody(httpFetch)).toEqual([
      { op: "add", path: "/submittedById", value: { campusEmail: "a@iu.edu" } },
      { op: "replace", path: "/name", value: "New Name" },
      { op: "replace", path: "/startsOn", value: "2026-09-01T16:00:00" },
      { op: "replace", path: "/endsOn", value: "2026-09-01T17:00:00" },
    ]);
    expect(result).toEqual({ eventId: 42, name: "New Name", startsOn: "2026-09-01T16:00:00", endsOn: "2026-09-01T17:00:00" });
  });

  it("requires eventId and a non-empty submittedById, even when nothing else is changing", async () => {
    await expect(updateEvent([{ submittedById: { campusEmail: "a@iu.edu" } }], makeContext(vi.fn()))).rejects.toThrow(/eventId/);
    await expect(updateEvent([{ eventId: 1 }], makeContext(vi.fn()))).rejects.toThrow(/submittedById/);
  });
});

describe("engage.cancelEvent", () => {
  it("POSTs to the cancel endpoint with only comments in the body (never a status)", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "Canceled", comments: "Weather" }), { status: 200 }));
    const result = await cancelEvent([{ eventId: 42, comments: "Weather" }], makeContext(httpFetch));

    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_ENGAGE_BASE_URL}/v3.0/events/event/42/cancel`);
    expect(init.method).toBe("POST");
    expect(requestBody(httpFetch)).toEqual({ comments: "Weather" });
    expect(result).toEqual({ eventId: 42, status: "Canceled", comments: "Weather" });
  });

  it("requires eventId", async () => {
    await expect(cancelEvent([{}], makeContext(vi.fn()))).rejects.toThrow(/eventId/);
  });
});

describe("engage.rsvpToEvent", () => {
  it("posts to /v3.0/events/event/{eventId}/rsvp", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 5, eventId: 42, response: "Yes", guests: 1 }), { status: 200 }));
    const result = await rsvpToEvent([{ apiKey: "k", eventId: 42, userId: { campusEmail: "a@iu.edu" }, response: "Yes", guests: 1 }], makeContext(httpFetch));

    expect(httpFetch.mock.calls[0][0]).toBe(`${DEFAULT_ENGAGE_BASE_URL}/v3.0/events/event/42/rsvp`);
    expect(requestBody(httpFetch)).toEqual({ userId: { campusEmail: "a@iu.edu" }, response: "Yes", guests: 1 });
    expect(result).toEqual({ rsvpId: 5, eventId: 42, response: "Yes", guests: 1 });
  });

  it("requires eventId, response, and a non-empty userId", async () => {
    await expect(rsvpToEvent([{ apiKey: "k", userId: { campusEmail: "a@iu.edu" } }], makeContext(vi.fn()))).rejects.toThrow(/requires/);
    await expect(rsvpToEvent([{ apiKey: "k", eventId: 1, response: "Yes" }], makeContext(vi.fn()))).rejects.toThrow(/userId/);
  });

  it("does not require apiKey — confirms the optionality isn't special-cased to just createEvent", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1, eventId: 42, response: "Yes" }), { status: 200 }));
    await rsvpToEvent([{ eventId: 42, userId: { campusEmail: "a@iu.edu" }, response: "Yes" }], makeContext(httpFetch));
    expect("X-Engage-Api-Key" in (httpFetch.mock.calls[0][1].headers as Record<string, string>)).toBe(false);
  });
});

describe("engage.updateRsvp", () => {
  it("PATCHes /v3.0/events/event/{eventId}/rsvp/{rsvpId} with a JSON Patch built from the changed fields", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 5, eventId: 42, response: "No", guests: 0 }), { status: 200 }));
    const result = await updateRsvp([{ eventId: 42, rsvpId: 5, response: "No", guests: 0 }], makeContext(httpFetch));

    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_ENGAGE_BASE_URL}/v3.0/events/event/42/rsvp/5`);
    expect(init.method).toBe("PATCH");
    expect(requestBody(httpFetch)).toEqual([
      { op: "replace", path: "/response", value: "No" },
      { op: "replace", path: "/guests", value: 0 },
    ]);
    expect(result).toEqual({ rsvpId: 5, eventId: 42, response: "No", guests: 0 });
  });

  it("requires eventId and rsvpId", async () => {
    await expect(updateRsvp([{ rsvpId: 5, response: "No" }], makeContext(vi.fn()))).rejects.toThrow(/eventId/);
    await expect(updateRsvp([{ eventId: 42, response: "No" }], makeContext(vi.fn()))).rejects.toThrow(/rsvpId/);
  });

  it("requires at least one field to change", async () => {
    await expect(updateRsvp([{ eventId: 42, rsvpId: 5 }], makeContext(vi.fn()))).rejects.toThrow(/at least one field/);
  });
});

describe("engage.recordAttendance", () => {
  it("posts to /v3.0/events/event/{eventId}/attendance", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 9, eventId: 42, status: "Attended" }), { status: 200 }));
    const result = await recordAttendance([{ apiKey: "k", eventId: 42, userId: { campusEmail: "a@iu.edu" }, status: "Attended" }], makeContext(httpFetch));

    expect(httpFetch.mock.calls[0][0]).toBe(`${DEFAULT_ENGAGE_BASE_URL}/v3.0/events/event/42/attendance`);
    expect(result).toEqual({ attendanceId: 9, eventId: 42, status: "Attended" });
  });

  it("surfaces a clear error (with response body) on a non-ok response", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "bad request" }), { status: 400, statusText: "Bad Request" }));
    await expect(
      recordAttendance([{ apiKey: "k", eventId: 42, userId: { campusEmail: "a@iu.edu" }, status: "Attended" }], makeContext(httpFetch))
    ).rejects.toThrow(/400/);
  });

  it("requires eventId, status, and a non-empty userId", async () => {
    await expect(recordAttendance([{ apiKey: "k" }], makeContext(vi.fn()))).rejects.toThrow(/requires/);
  });
});

describe("engage.updateAttendance", () => {
  it("PATCHes /v3.0/events/event/{eventId}/attendance/{attendanceId} with a JSON Patch built from the changed fields", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 9, eventId: 42, status: "Excused" }), { status: 200 }));
    const result = await updateAttendance([{ eventId: 42, attendanceId: 9, status: "Excused" }], makeContext(httpFetch));

    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_ENGAGE_BASE_URL}/v3.0/events/event/42/attendance/9`);
    expect(init.method).toBe("PATCH");
    expect(requestBody(httpFetch)).toEqual([{ op: "replace", path: "/status", value: "Excused" }]);
    expect(result).toEqual({ attendanceId: 9, eventId: 42, status: "Excused" });
  });

  it("requires eventId and attendanceId", async () => {
    await expect(updateAttendance([{ attendanceId: 9, status: "Excused" }], makeContext(vi.fn()))).rejects.toThrow(/eventId/);
    await expect(updateAttendance([{ eventId: 42, status: "Excused" }], makeContext(vi.fn()))).rejects.toThrow(/attendanceId/);
  });

  it("requires at least one field to change", async () => {
    await expect(updateAttendance([{ eventId: 42, attendanceId: 9 }], makeContext(vi.fn()))).rejects.toThrow(/at least one field/);
  });
});

describe("engage.deleteAttendance", () => {
  it("DELETEs /v3.0/events/event/{eventId}/attendance/{attendanceId}", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const result = await deleteAttendance([{ eventId: 42, attendanceId: 9 }], makeContext(httpFetch));

    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_ENGAGE_BASE_URL}/v3.0/events/event/42/attendance/9`);
    expect(init.method).toBe("DELETE");
    expect(result).toEqual({ deleted: true, eventId: 42, attendanceId: 9 });
  });

  it("requires eventId and attendanceId", async () => {
    await expect(deleteAttendance([{ attendanceId: 9 }], makeContext(vi.fn()))).rejects.toThrow(/eventId/);
    await expect(deleteAttendance([{ eventId: 42 }], makeContext(vi.fn()))).rejects.toThrow(/attendanceId/);
  });
});
