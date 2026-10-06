import { describe, it, expect } from "vitest";
import { interpolate, type TemplateContext } from "../post-actions/templating.js";

const ctx: TemplateContext = {
  fields: { name: "Jane Doe", campus: "Bloomington" },
  item: { id: "42" },
  results: { createFollowupTicket: { ticketId: "TCK-1" } },
};

describe("interpolate", () => {
  it("resolves {{fields.x}} and {{item.x}} in a plain string", () => {
    expect(interpolate("Hello {{fields.name}} from {{fields.campus}}, item {{item.id}}", ctx)).toBe(
      "Hello Jane Doe from Bloomington, item 42"
    );
  });

  it("resolves a nested {{results.actionKey.path}}", () => {
    expect(interpolate("Ticket: {{results.createFollowupTicket.ticketId}}", ctx)).toBe("Ticket: TCK-1");
  });

  it("resolves missing values to an empty string rather than throwing", () => {
    expect(interpolate("{{results.neverRan.someField}}", ctx)).toBe("");
    expect(interpolate("{{fields.doesNotExist}}", ctx)).toBe("");
  });

  it("recurses through nested objects/arrays, leaving non-strings alone", () => {
    const result = interpolate(
      { subject: "Ticket for {{fields.name}}", meta: { itemId: "{{item.id}}", count: 3, tags: ["{{fields.campus}}"] } },
      ctx
    );
    expect(result).toEqual({
      subject: "Ticket for Jane Doe",
      meta: { itemId: "42", count: 3, tags: ["Bloomington"] },
    });
  });

  describe("array spreading — a whole-placeholder array element resolving to an array", () => {
    const peopleCtx: TemplateContext = {
      fields: { host: ["host@iu.edu"], cohosts: ["a@iu.edu", "b@iu.edu"], empty: [] },
      item: {},
      results: {},
    };

    it("spreads a multi-value field's array into the parent array's positions, not one comma-joined string", () => {
      expect(interpolate(["{{fields.cohosts}}"], peopleCtx)).toEqual(["a@iu.edu", "b@iu.edu"]);
    });

    it("combines a spread field with other whole-placeholder array elements in one array", () => {
      expect(interpolate(["{{fields.host}}", "{{fields.cohosts}}"], peopleCtx)).toEqual(["host@iu.edu", "a@iu.edu", "b@iu.edu"]);
    });

    it("a single-value field's 1-element array still spreads to exactly one entry (not stringified)", () => {
      expect(interpolate(["{{fields.host}}"], peopleCtx)).toEqual(["host@iu.edu"]);
    });

    it("an empty array field spreads to nothing", () => {
      expect(interpolate(["{{fields.empty}}", "{{fields.host}}"], peopleCtx)).toEqual(["host@iu.edu"]);
    });

    it("does NOT spread when the placeholder is embedded in a larger string — falls back to normal stringification", () => {
      expect(interpolate(["Cohosts: {{fields.cohosts}}"], peopleCtx)).toEqual(["Cohosts: a@iu.edu,b@iu.edu"]);
    });

    it("a whole-placeholder resolving to a non-array value is unaffected (still a plain interpolated string)", () => {
      expect(interpolate(["{{fields.campus}}"], ctx)).toEqual(["Bloomington"]);
    });

    it("a whole-placeholder resolving to nothing (missing field) still resolves to an empty string, not removed from the array", () => {
      expect(interpolate(["{{fields.doesNotExist}}"], ctx)).toEqual([""]);
    });
  });
});
