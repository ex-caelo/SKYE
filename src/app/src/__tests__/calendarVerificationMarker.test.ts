import { describe, it, expect } from "vitest";
import { buildVerificationMarker, unfoldIcs, icsContainsVerificationMarker } from "../actions/outlook/calendarVerificationMarker.js";

describe("buildVerificationMarker", () => {
  it("wraps the id in a distinct, greppable marker", () => {
    expect(buildVerificationMarker("abc-123")).toBe("[SKYE-VERIFY:abc-123]");
  });
});

describe("unfoldIcs", () => {
  it("joins a folded continuation line (leading space) back onto the previous line, leaving the next real line break alone", () => {
    const folded = "DESCRIPTION:Hello \r\n [SKYE-VERIFY:abc-123]\r\nEND:VEVENT";
    expect(unfoldIcs(folded)).toBe("DESCRIPTION:Hello [SKYE-VERIFY:abc-123]\r\nEND:VEVENT");
  });

  it("leaves ordinary (non-folded) lines untouched", () => {
    const plain = "BEGIN:VEVENT\r\nDESCRIPTION:x\r\nEND:VEVENT";
    expect(unfoldIcs(plain)).toBe(plain);
  });
});

describe("icsContainsVerificationMarker", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Unrelated event",
    "DESCRIPTION:just some notes",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:The one we're looking for",
    "DESCRIPTION:Some notes\\n\\n[SKYE-VERIFY:abc-123]",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("finds the marker when it's present in some VEVENT's body", () => {
    expect(icsContainsVerificationMarker(ics, "abc-123")).toBe(true);
  });

  it("does not match a different id, even a substring of a real one", () => {
    expect(icsContainsVerificationMarker(ics, "abc-12")).toBe(false);
    expect(icsContainsVerificationMarker(ics, "xyz-999")).toBe(false);
  });

  it("returns false for a calendar with no VEVENT blocks at all", () => {
    expect(icsContainsVerificationMarker("BEGIN:VCALENDAR\r\nEND:VCALENDAR", "abc-123")).toBe(false);
  });
});
