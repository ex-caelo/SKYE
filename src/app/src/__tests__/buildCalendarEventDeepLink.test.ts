import { describe, it, expect, vi } from "vitest";
import type { ActionExecutionContext } from "@skye/config";
import { buildCalendarEventDeepLink } from "../actions/outlook/buildCalendarEventDeepLink.js";

function makeContext(): ActionExecutionContext {
  return {
    templateContext: { fields: {}, item: {}, results: {} },
    httpFetch: vi.fn(),
    graphFetch: vi.fn(),
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
    scriptActions: {},
  };
}

describe("outlook.buildCalendarEventDeepLink", () => {
  it("builds an Outlook Web compose URL with subject/startdt/enddt and an embedded verification marker", async () => {
    const result = (await buildCalendarEventDeepLink(
      [{ subject: "Team Sync", startDateTime: "2026-09-01T14:00:00", endDateTime: "2026-09-01T15:00:00" }],
      makeContext()
    )) as { url: string; verificationId: string };

    const url = new URL(result.url);
    expect(url.origin + url.pathname).toBe("https://outlook.office.com/calendar/0/deeplink/compose");
    expect(url.searchParams.get("subject")).toBe("Team Sync");
    expect(url.searchParams.get("startdt")).toBe("2026-09-01T14:00:00");
    expect(url.searchParams.get("enddt")).toBe("2026-09-01T15:00:00");
    expect(url.searchParams.get("body")).toContain(`[SKYE-VERIFY:${result.verificationId}]`);
    expect(result.verificationId).toBeTruthy();
  });

  it("includes location when given, and preserves author-supplied body content alongside the marker", async () => {
    const result = (await buildCalendarEventDeepLink(
      [
        {
          subject: "Kickoff",
          startDateTime: "2026-09-01T14:00:00",
          endDateTime: "2026-09-01T15:00:00",
          location: "Union Ballroom",
          bodyContent: "Bring your laptop.",
        },
      ],
      makeContext()
    )) as { url: string };

    const url = new URL(result.url);
    expect(url.searchParams.get("location")).toBe("Union Ballroom");
    expect(url.searchParams.get("body")).toContain("Bring your laptop.");
    expect(url.searchParams.get("body")).toContain("[SKYE-VERIFY:");
  });

  it("uses a caller-supplied verificationId instead of generating one, when given", async () => {
    const result = (await buildCalendarEventDeepLink(
      [{ subject: "x", startDateTime: "2026-09-01T14:00:00", endDateTime: "2026-09-01T15:00:00", verificationId: "fixed-id-1" }],
      makeContext()
    )) as { url: string; verificationId: string };

    expect(result.verificationId).toBe("fixed-id-1");
    expect(new URL(result.url).searchParams.get("body")).toContain("[SKYE-VERIFY:fixed-id-1]");
  });

  it("requires subject/startDateTime/endDateTime", async () => {
    await expect(buildCalendarEventDeepLink([{ subject: "x" }], makeContext())).rejects.toThrow(/requires/);
  });
});
