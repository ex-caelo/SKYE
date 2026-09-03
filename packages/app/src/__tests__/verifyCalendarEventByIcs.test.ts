import { describe, it, expect, vi } from "vitest";
import type { ActionExecutionContext } from "@skye/form-config";
import { verifyCalendarEventByIcs } from "../integrations/outlook/verifyCalendarEventByIcs.js";

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

const ICS_WITH_MARKER = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "SUMMARY:Team Sync",
  "DESCRIPTION:notes\\n\\n[SKYE-VERIFY:abc-123]",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("outlook.verifyCalendarEventByIcs", () => {
  it("reports found: true when the marker is present in the fetched ICS", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(ICS_WITH_MARKER, { status: 200 }));
    const result = await verifyCalendarEventByIcs([{ icsProxyUrl: "https://proxy.example.com/ics", verificationId: "abc-123" }], makeContext(httpFetch));

    expect(httpFetch).toHaveBeenCalledWith("https://proxy.example.com/ics", expect.objectContaining({ method: "GET" }));
    expect(result).toEqual({ found: true, verificationId: "abc-123" });
  });

  it("reports found: false when the marker isn't present, without throwing", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(ICS_WITH_MARKER, { status: 200 }));
    const result = await verifyCalendarEventByIcs([{ icsProxyUrl: "https://proxy.example.com/ics", verificationId: "not-there" }], makeContext(httpFetch));

    expect(result).toEqual({ found: false, verificationId: "not-there" });
  });

  it("never returns the raw ICS text itself", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(ICS_WITH_MARKER, { status: 200 }));
    const result = (await verifyCalendarEventByIcs(
      [{ icsProxyUrl: "https://proxy.example.com/ics", verificationId: "abc-123" }],
      makeContext(httpFetch)
    )) as Record<string, unknown>;

    expect(Object.keys(result).sort()).toEqual(["found", "verificationId"]);
  });

  it("throws a clear error when the proxy request itself fails", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }));
    await expect(
      verifyCalendarEventByIcs([{ icsProxyUrl: "https://proxy.example.com/ics", verificationId: "abc-123" }], makeContext(httpFetch))
    ).rejects.toThrow(/proxy request failed/);
  });

  it("throws a clear error when the response doesn't look like ICS content", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response("<html>not ics</html>", { status: 200 }));
    await expect(
      verifyCalendarEventByIcs([{ icsProxyUrl: "https://proxy.example.com/ics", verificationId: "abc-123" }], makeContext(httpFetch))
    ).rejects.toThrow(/doesn't look like ICS/);
  });

  it("requires icsProxyUrl and verificationId", async () => {
    await expect(verifyCalendarEventByIcs([{ icsProxyUrl: "" , verificationId: "" }], makeContext(vi.fn()))).rejects.toThrow(/requires/);
  });
});
