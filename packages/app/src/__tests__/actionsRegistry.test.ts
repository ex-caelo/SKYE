import { describe, it, expect } from "vitest";
import { scriptActions } from "../integrations/registry.js";

describe("scriptActions registry", () => {
  it("registers every built-in action, keyed \"service.actionName\"", () => {
    expect(Object.keys(scriptActions).sort()).toEqual([
      "engage.cancelEvent",
      "engage.createEvent",
      "engage.deleteAttendance",
      "engage.recordAttendance",
      "engage.rsvpToEvent",
      "engage.updateAttendance",
      "engage.updateEvent",
      "engage.updateRsvp",
      "outlook.buildCalendarEventDeepLink",
      "outlook.createCalendarEvent",
      "outlook.sendEmail",
      "outlook.verifyCalendarEventByIcs",
      "teams.createChat",
      "teams.scheduleMeeting",
      "teams.sendMessage",
    ]);
  });

  it("every registered action is callable", () => {
    for (const action of Object.values(scriptActions)) {
      expect(typeof action).toBe("function");
    }
  });
});
