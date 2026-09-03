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
});
