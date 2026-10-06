import { describe, it, expect, vi } from "vitest";
import type { FormConfig } from "@skye/form-config";
import { runButtonActions } from "../features/form/submit/runButtonActions.js";
import { formatDateYMD } from "../integrations/util/formatDateYMD.js";
import { formatDateTime } from "../integrations/util/formatDateTime.js";
import type { RawGraphFetch } from "../shared/sharepoint/rawGraphFetch.js";
import adminConfig from "../../../../skye_data/forms/luddy-llc-event-proposal/admin/form.config.json" with { type: "json" };

function stubGraphFetch() {
  return vi.fn<RawGraphFetch>(async () => new Response("{}", { status: 200 }));
}

/**
 * Runs the REAL "Approve Event" button config from
 * skye_data/forms/luddy-llc-event-proposal/admin/form.config.json through
 * the actual engine (runButtonActions -> runTriggerPhase -> the real
 * postAction handlers), not a synthetic example — so a future edit to that
 * config that breaks the create-vs-update branching, the array-spread
 * templating trick, or the field bindings fails a test, not just a live
 * click.
 */
const approveButton = (adminConfig as unknown as FormConfig).fields.approveButton;

function stubCallbacks(extra: Record<string, unknown> = {}) {
  return {
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
    scriptActions: {
      "engage.createEvent": vi.fn(async () => ({ eventId: 501, accessCode: "CREATE01" })),
      "engage.updateEvent": vi.fn(async () => ({ eventId: 501, accessCode: "UPDATE01" })),
      "teams.createChat": vi.fn(async () => ({ chatId: "chat-1" })),
      "teams.sendMessage": vi.fn(async () => ({ messageId: "msg-1" })),
      // The real implementation, not a stub — it's pure (no network), so there's no reason to
      // fake it, and using the real one here is what actually exercises the config's new
      // formatApprovalChatTopic -> openApprovalChatFrom(Create|Update) dependency end to end.
      "util.formatDateYMD": formatDateYMD,
      "util.formatDateTime": formatDateTime,
      ...extra,
    },
  };
}

const baseFields = {
  eventTitle: "Spring Hackathon",
  eventDescription: "A 24-hour hackathon.",
  startTime: "2026-04-10T18:00",
  endTime: "2026-04-11T18:00",
  location: ["Luddy Atrium"],
  // Deliberately NOT a real email — `host` feeds engage.createEvent's organizer resolution path
  // and the SharePoint personOrGroup column write, but a real live bug showed `{{fields.host}}`
  // must NEVER feed memberUserIds directly: an untouched Host people-picker field falls back to
  // its SharePoint column's own numeric LookupId whenever that column's cached Email is blank (a
  // real, documented tenant quirk), and a bare LookupId means nothing to Graph's /users/{id} — it
  // got Teams' own chat creation rejected with a 403 ("One or more members cannot be added to the
  // thread roster"). `"42"` here stands in for exactly that fallen-back-to-LookupId shape; if
  // memberUserIds ever started reading `fields.host` again instead of `fields.hostEmail`, this
  // value landing in teams.createChat's real validation (not the stubbed one here) would throw.
  host: ["42"],
  cohosts: ["cohost1@iu.edu", "cohost2@iu.edu"],
  reviewer: ["reviewer@iu.edu"],
  hostEmail: "host@iu.edu",
  approvalComments: "Looks good.",
};

describe("luddy-llc-event-proposal admin overlay — Approve Event button", () => {
  it("first-time approval (no existing BeInvolved event id): creates, saves fields, opens the chat with host+cohosts+reviewer, sends the card", async () => {
    const graphFetch = stubGraphFetch();
    const callbacks = stubCallbacks();

    const result = await runButtonActions(approveButton, { ...baseFields, beInvolvedEventId: undefined }, { id: "9001" }, graphFetch, callbacks);

    expect(result.errors).toEqual({});
    // The create branch ran; the update branch (mutually exclusive) was cleanly skipped, not attempted.
    expect(result.outcomes.createBeInvolvedEvent).toBe("ran");
    expect(result.outcomes.updateBeInvolvedEvent).toBe("skipped");
    expect(result.outcomes.setBeInvolvedEventIdFromUpdate).toBe("skipped");
    expect(result.outcomes.setAttendanceCodeFromUpdate).toBe("skipped");
    expect(result.outcomes.saveApprovalFieldsFromUpdate).toBe("skipped");

    // Status flipped live in the form (step 1) before BeInvolved was ever called.
    expect(callbacks.setFieldValue).toHaveBeenCalledWith("status", "Approved");
    // The create branch's own results populated the visible fields (step 3).
    expect(callbacks.setFieldValue).toHaveBeenCalledWith("beInvolvedEventId", "501");
    expect(callbacks.setFieldValue).toHaveBeenCalledWith("attendanceCode", "CREATE01");

    // The primary item was PATCHed with the real values, not blank/stale ones (step 4).
    const [, init] = graphFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(graphFetch.mock.calls[0][0]).toContain("/items/9001/fields");
    expect(body).toEqual({ Status: "Approved", BeInvolved_x0020_Event_x0020_Id: "501", AttendanceScannerAccessCode: "CREATE01" });

    // The chat includes host + BOTH cohosts (array-spread) + reviewer — not a broken comma-joined string.
    expect(callbacks.scriptActions["teams.createChat"]).toHaveBeenCalledWith(
      [{ memberUserIds: ["host@iu.edu", "cohost1@iu.edu", "cohost2@iu.edu", "reviewer@iu.edu"], chatType: "group", topic: "2026.04.10 Spring Hackathon" }],
      expect.anything()
    );

    // The card carries the event details and the freshly-created access code.
    const cardCall = (callbacks.scriptActions["teams.sendMessage"] as ReturnType<typeof vi.fn>).mock.calls[0][0][0];
    expect(cardCall.chatId).toBe("chat-1");
    expect(cardCall.adaptiveCard.body[0].text).toBe("Spring Hackathon");
    const facts = cardCall.adaptiveCard.body[2].facts;
    expect(facts.find((f: { title: string }) => f.title === "Scanner Code").value).toBe("CREATE01");
    expect(facts.find((f: { title: string }) => f.title === "Location").value).toBe("Luddy Atrium");
  });

  it("re-approval (a BeInvolved event id already exists): PATCHes the existing event instead of creating a new one", async () => {
    const graphFetch = stubGraphFetch();
    const callbacks = stubCallbacks();

    const result = await runButtonActions(approveButton, { ...baseFields, beInvolvedEventId: "501" }, { id: "9001" }, graphFetch, callbacks);

    expect(result.errors).toEqual({});
    expect(result.outcomes.createBeInvolvedEvent).toBe("skipped");
    expect(result.outcomes.updateBeInvolvedEvent).toBe("ran");
    expect(result.outcomes.saveApprovalFieldsFromCreate).toBe("skipped");

    expect(callbacks.scriptActions["engage.updateEvent"]).toHaveBeenCalledWith([expect.objectContaining({ eventId: "501" })], expect.anything());
    expect(callbacks.setFieldValue).toHaveBeenCalledWith("attendanceCode", "UPDATE01");

    const body = JSON.parse((graphFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ Status: "Approved", BeInvolved_x0020_Event_x0020_Id: "501", AttendanceScannerAccessCode: "UPDATE01" });
  });

  it("if BeInvolved creation fails, the save/chat/card never run — no blank data is written and no notification goes out", async () => {
    const graphFetch = stubGraphFetch();
    const callbacks = stubCallbacks({ "engage.createEvent": vi.fn(async () => { throw new Error("Engage is down"); }) });

    const result = await runButtonActions(approveButton, { ...baseFields, beInvolvedEventId: undefined }, { id: "9001" }, graphFetch, callbacks);

    expect(result.outcomes.createBeInvolvedEvent).toBe("failed");
    expect(result.outcomes.setBeInvolvedEventIdFromCreate).toBe("skipped");
    expect(result.outcomes.saveApprovalFieldsFromCreate).toBe("skipped");
    expect(result.outcomes.openApprovalChatFromCreate).toBe("skipped");
    expect(result.outcomes.sendApprovalCardFromCreate).toBe("skipped");
    // The update branch was never applicable either (no existing BeInvolved event id) — its own
    // chain stays cleanly skipped throughout, not just the create branch.
    expect(result.outcomes.openApprovalChatFromUpdate).toBe("skipped");
    expect(result.outcomes.sendApprovalCardFromUpdate).toBe("skipped");
    expect(graphFetch).not.toHaveBeenCalled();
    expect(callbacks.scriptActions["teams.createChat"]).not.toHaveBeenCalled();
  });

  it("if a re-approval's BeInvolved update fails, the existing (good) event id/attendance code are never overwritten with blanks", async () => {
    // This is the scenario the "shared downstream + runIfDependencySkipped" design got wrong
    // during development (caught by an earlier version of this test): a failure on the ACTIVE
    // branch must not be treated the same as the INACTIVE branch's ordinary, harmless skip.
    const graphFetch = stubGraphFetch();
    const callbacks = stubCallbacks({ "engage.updateEvent": vi.fn(async () => { throw new Error("Engage is down"); }) });

    const result = await runButtonActions(approveButton, { ...baseFields, beInvolvedEventId: "501" }, { id: "9001" }, graphFetch, callbacks);

    expect(result.outcomes.updateBeInvolvedEvent).toBe("failed");
    expect(result.outcomes.setBeInvolvedEventIdFromUpdate).toBe("skipped");
    expect(result.outcomes.saveApprovalFieldsFromUpdate).toBe("skipped");
    expect(result.outcomes.openApprovalChatFromUpdate).toBe("skipped");
    expect(result.outcomes.sendApprovalCardFromUpdate).toBe("skipped");
    expect(graphFetch).not.toHaveBeenCalled(); // no PATCH at all — the existing SharePoint values are left exactly as they were
    expect(callbacks.setFieldValue).not.toHaveBeenCalledWith("beInvolvedEventId", "");
    expect(callbacks.setFieldValue).not.toHaveBeenCalledWith("attendanceCode", "");
    expect(callbacks.scriptActions["teams.createChat"]).not.toHaveBeenCalled();
  });
});
