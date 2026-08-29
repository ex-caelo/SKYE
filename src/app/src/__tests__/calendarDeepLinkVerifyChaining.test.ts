import { describe, it, expect, vi } from "vitest";
import { runTriggerPhase, createDefaultHandlerRegistry, type ActionExecutionContext } from "@skye/config";
import type { PostAction } from "@skye/config";
import { scriptActions } from "../actions/registry.js";

/**
 * Proves the verificationId returned by outlook.buildCalendarEventDeepLink flows into
 * outlook.verifyCalendarEventByIcs via the existing dependsOn + {{results.x}} chaining — the same
 * mechanism proven for teams.createChat -> teams.sendMessage, extended to a build-then-verify pair
 * instead of a create-then-send pair. In a real form these two would typically run in different
 * trigger phases (verify happens well after the user has had a chance to actually save the event
 * in Outlook) — this test only proves the templating/composition mechanism itself works, not the
 * realistic timing.
 */
describe("outlook.buildCalendarEventDeepLink -> outlook.verifyCalendarEventByIcs chaining", () => {
  it("verifies using the exact verificationId the build step generated", async () => {
    const httpFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:x", "DESCRIPTION:notes", "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
          { status: 200 }
        )
      );

    const postActions: Record<string, PostAction> = {
      buildLinkAction: {
        trigger: "afterSubmit",
        type: "script",
        functionName: "outlook.buildCalendarEventDeepLink",
        args: [{ subject: "Kickoff", startDateTime: "2026-09-01T14:00:00", endDateTime: "2026-09-01T15:00:00" }],
      },
      verifyAction: {
        trigger: "afterSubmit",
        type: "script",
        dependsOn: ["buildLinkAction"],
        functionName: "outlook.verifyCalendarEventByIcs",
        args: [{ icsProxyUrl: "https://proxy.example.com/ics", verificationId: "{{results.buildLinkAction.verificationId}}" }],
      },
    };

    const makeExecutionContext = (resultsSoFar: Record<string, unknown>): ActionExecutionContext => ({
      templateContext: { fields: {}, item: {}, results: resultsSoFar },
      httpFetch,
      graphFetch: vi.fn(),
      navigate: vi.fn(),
      showMessage: vi.fn(),
      setFieldValue: vi.fn(),
      scriptActions,
    });

    const result = await runTriggerPhase(postActions, "afterSubmit", {}, createDefaultHandlerRegistry(), makeExecutionContext);

    expect(result.errors).toEqual({});
    const builtVerificationId = (result.results.buildLinkAction as { verificationId: string }).verificationId;
    expect(builtVerificationId).toBeTruthy();

    // Marker in the fetched ICS deliberately does NOT match — proves the real generated id (not a
    // hardcoded placeholder) was actually threaded through the template, since a wrong/empty id
    // would also correctly report false, but a real accidental match would give a false positive.
    expect(result.results.verifyAction).toEqual({ found: false, verificationId: builtVerificationId });

    // The URL the httpFetch call actually received the templated icsProxyUrl unchanged.
    expect(httpFetch).toHaveBeenCalledWith("https://proxy.example.com/ics", expect.anything());
  });
});
