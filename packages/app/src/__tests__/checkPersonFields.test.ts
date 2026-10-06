import { describe, it, expect, vi } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import type { GraphClient, GraphListColumn } from "../shared/sharepoint/types.js";
import { checkPersonFieldsResolve } from "../features/form/submit/checkPersonFields.js";

function graphResolving(known: Record<string, number>): GraphClient {
  return {
    // Mirrors RealGraphClient.resolveSiteUserId's own numeric fast path: a purely-numeric
    // identifier (an edit-mode person's already-resolved LookupId) is resolved by definition,
    // no lookup needed — same reason a bare LookupId key is treated as "already a site user".
    resolveSiteUserId: vi.fn(async (_s: string, id: string) => (/^\d+$/.test(id) ? Number(id) : (known[id] ?? null))),
  } as unknown as GraphClient;
}

const columns: GraphListColumn[] = [
  { name: "Title", displayName: "Title", columnType: "text" },
  { name: "Host", displayName: "Host", columnType: "personOrGroup", allowMultiple: false },
  { name: "Cohosts", displayName: "Cohosts", columnType: "personOrGroup", allowMultiple: true },
];

const fields: Record<string, FieldConfig> = {
  eventTitle: { page: "p", source: "sharepoint", bindTo: "Title", controlType: "text" },
  host: { page: "p", source: "sharepoint", bindTo: "Host", controlType: "peoplePicker" },
  cohosts: { page: "p", source: "sharepoint", bindTo: "Cohosts", controlType: "peoplePicker" },
  reviewer: { page: "p", source: "virtual", controlType: "peoplePicker" },
};

describe("checkPersonFieldsResolve", () => {
  it("returns no errors when every picked person resolves to a site user", async () => {
    const errors = await checkPersonFieldsResolve(
      graphResolving({ "a@x.edu": 1, "b@x.edu": 2 }),
      "site1",
      fields,
      columns,
      { host: ["a@x.edu"], cohosts: ["a@x.edu", "b@x.edu"] }
    );
    expect(errors).toEqual({});
  });

  it("reports the field with an unresolvable pick, naming the person", async () => {
    const errors = await checkPersonFieldsResolve(
      graphResolving({ "a@x.edu": 1 }),
      "site1",
      fields,
      columns,
      { host: ["ghost@x.edu"], cohosts: ["a@x.edu", "ghost2@x.edu"] }
    );
    expect(Object.keys(errors).sort()).toEqual(["cohosts", "host"]);
    expect(errors.host).toContain("ghost@x.edu");
    expect(errors.cohosts).toContain("ghost2@x.edu");
    expect(errors.cohosts).not.toContain("a@x.edu");
  });

  it("ignores virtual people pickers and non-person columns", async () => {
    const errors = await checkPersonFieldsResolve(graphResolving({}), "site1", fields, columns, {
      reviewer: ["nobody@x.edu"], // virtual — feeds a postAction, not a SP person column
      eventTitle: "Some Event",
    });
    expect(errors).toEqual({});
  });

  it("skips a people picker that has no selection", async () => {
    const errors = await checkPersonFieldsResolve(graphResolving({}), "site1", fields, columns, { host: [] });
    expect(errors).toEqual({});
  });

  it("resolves an UNTOUCHED edit-mode value — raw SharePoint {LookupId, LookupValue, Email} objects, not plain strings — the real live bug this fixes", async () => {
    // Before the fix, checkPersonFieldsResolve stringified these objects naively
    // ("[object Object]") instead of extracting a resolvable identifier, so a real,
    // already-valid site member got wrongly rejected as "not a member of this site" purely
    // because their value had never been re-picked since the item loaded.
    const errors = await checkPersonFieldsResolve(
      graphResolving({ "lison@iu.edu": 14 }),
      "site1",
      fields,
      columns,
      {
        host: { LookupId: 14, LookupValue: "Cloteaux, Lison", Email: "lison@iu.edu" },
        cohosts: [{ LookupId: 22, LookupValue: "Weyandt, Carley Jane", Email: "" }],
      }
    );
    // cohosts' entry has no Email, so it resolves via the numeric LookupId fallback instead —
    // still correctly resolvable, still not "[object Object]".
    expect(errors).toEqual({});
  });
});
