import { describe, it, expect, vi } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import type { GraphClient, GraphListColumn } from "../shared/sharepoint/types.js";
import { buildPrimarySharePointFields } from "../features/form/submit/encodeSharePointFields.js";

/** A GraphClient stub with just the one method the encoder calls. */
function graphWith(resolve: (id: string) => number | null): GraphClient {
  return { resolveSiteUserId: vi.fn(async (_s: string, id: string) => resolve(id)) } as unknown as GraphClient;
}

const columns: GraphListColumn[] = [
  { name: "Title", displayName: "Title", columnType: "text" },
  { name: "Host", displayName: "Host", columnType: "personOrGroup", allowMultiple: false },
  { name: "Cohosts", displayName: "Cohosts", columnType: "personOrGroup", allowMultiple: true },
  { name: "Location", displayName: "Location", columnType: "choice", allowMultiple: true, choices: ["Room A", "Room B"] },
];

const fields: Record<string, FieldConfig> = {
  title: { page: "p", source: "sharepoint", bindTo: "Title", controlType: "text" },
  host: { page: "p", source: "sharepoint", bindTo: "Host", controlType: "peoplePicker" },
  cohosts: { page: "p", source: "sharepoint", bindTo: "Cohosts", controlType: "peoplePicker" },
  location: { page: "p", source: "sharepoint", bindTo: "Location", controlType: "checkboxGroup" },
  note: { page: "p", source: "virtual", controlType: "text" },
};

describe("buildPrimarySharePointFields", () => {
  it("passes scalar text straight through and ignores virtual + untouched fields", async () => {
    const { fields: out } = await buildPrimarySharePointFields(
      graphWith(() => 1),
      "site1",
      fields,
      { title: "Spring Fair", note: "ignored" },
      columns
    );
    expect(out).toEqual({ Title: "Spring Fair" });
  });

  it("writes a single person column as <col>LookupId (scalar)", async () => {
    const { fields: out, errors } = await buildPrimarySharePointFields(
      graphWith((id) => (id === "alex@x.edu" ? 7 : null)),
      "site1",
      fields,
      { host: ["alex@x.edu"] },
      columns
    );
    expect(out).toEqual({ HostLookupId: 7 });
    expect(errors).toEqual({});
  });

  it("writes a multi person column as a Collection(Edm.Int32) of LookupIds", async () => {
    const ids: Record<string, number> = { "a@x.edu": 3, "b@x.edu": 9 };
    const { fields: out } = await buildPrimarySharePointFields(
      graphWith((id) => ids[id] ?? null),
      "site1",
      fields,
      { cohosts: ["a@x.edu", "b@x.edu"] },
      columns
    );
    expect(out).toEqual({ "CohostsLookupId@odata.type": "Collection(Edm.Int32)", CohostsLookupId: [3, 9] });
  });

  it("reports an unresolvable person and leaves that field unwritten, without failing", async () => {
    const { fields: out, errors } = await buildPrimarySharePointFields(
      graphWith(() => null),
      "site1",
      fields,
      { host: ["ghost@x.edu"] },
      columns
    );
    expect(out).toEqual({});
    expect(errors.host).toMatch(/ghost@x\.edu/);
  });

  it("encodes a multi-select choice field as Collection(Edm.String)", async () => {
    const { fields: out } = await buildPrimarySharePointFields(
      graphWith(() => 1),
      "site1",
      fields,
      { location: ["Room A", "Room B"] },
      columns
    );
    expect(out).toEqual({ "Location@odata.type": "Collection(Edm.String)", Location: ["Room A", "Room B"] });
  });

  it("joins a stray array reaching a plain column rather than sending it raw", async () => {
    const { fields: out } = await buildPrimarySharePointFields(
      graphWith(() => 1),
      "site1",
      { tags: { page: "p", source: "sharepoint", bindTo: "Title", controlType: "text" } },
      { tags: ["x", "y"] },
      [{ name: "Title", displayName: "Title", columnType: "text" }]
    );
    expect(out).toEqual({ Title: "x; y" });
  });
});
