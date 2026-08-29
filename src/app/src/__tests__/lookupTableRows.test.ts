import { describe, it, expect } from "vitest";
import type { LookupTable } from "@skye/config";
import { MockGraphClient } from "../lib/mock-graph/mockGraphClient.js";
import { writeLookupTableRows } from "../lib/submit/lookupTableRows.js";

const table: LookupTable = {
  relatedList: { id: "related-list-1" },
  linkMode: "parentReference",
  parentReferenceColumn: "Correlated_x0020_Event",
  columns: {
    guestName: { source: "sharepoint", bindTo: "Title", controlType: "text" },
    mealChoice: { source: "sharepoint", bindTo: "Favourite_x0020_Campus", controlType: "select" },
  },
};

describe("writeLookupTableRows", () => {
  it("creates a new row with the parentReference lookupId field set to the primary item's id", async () => {
    const graph = new MockGraphClient();
    const listId = "related-list-create-test";
    await writeLookupTableRows(graph, "site1", { ...table, relatedList: { id: listId } }, "42", [
      { values: { guestName: "Alex", mealChoice: "veggie" } },
    ]);

    const page = await graph.searchListItems("site1", listId, {});
    expect(page.items).toHaveLength(1);
    expect(page.items[0].fields).toEqual({
      Title: "Alex",
      Favourite_x0020_Campus: "veggie",
      Correlated_x0020_EventLookupId: 42,
    });
  });

  it("updates an existing row when the row has an id", async () => {
    const graph = new MockGraphClient();
    const listId = "related-list-update-test";
    const created = await graph.createListItem("site1", listId, { Title: "Original Name" });
    await writeLookupTableRows(graph, "site1", { ...table, relatedList: { id: listId } }, "42", [
      { id: created.id, values: { guestName: "Updated Name" } },
    ]);
    const updated = await graph.getListItem("site1", listId, created.id);
    expect(updated.fields.Title).toBe("Updated Name");
    expect(updated.fields.Correlated_x0020_EventLookupId).toBe(42);
  });

  it("does nothing for lookupColumn linkMode (relationship lives on the primary item's own field)", async () => {
    const graph = new MockGraphClient();
    const listId = "related-list-lookupcolumn-test";
    const lookupColumnTable: LookupTable = { ...table, relatedList: { id: listId }, linkMode: "lookupColumn", parentReferenceColumn: undefined };
    await expect(writeLookupTableRows(graph, "site1", lookupColumnTable, "42", [{ values: { guestName: "Should not write" } }])).resolves.toBeUndefined();
    const page = await graph.searchListItems("site1", listId, {});
    expect(page.items).toHaveLength(0);
  });

  it("deletes a row marked deleted: true when it has an id (an existing, previously-saved row)", async () => {
    const graph = new MockGraphClient();
    const listId = "related-list-delete-test";
    const created = await graph.createListItem("site1", listId, { Title: "To be deleted" });

    await writeLookupTableRows(graph, "site1", { ...table, relatedList: { id: listId } }, "42", [{ id: created.id, values: {}, deleted: true }]);

    const page = await graph.searchListItems("site1", listId, {});
    expect(page.items).toHaveLength(0);
  });

  it("does nothing for a deleted row with no id (never saved server-side in the first place)", async () => {
    const graph = new MockGraphClient();
    const listId = "related-list-delete-unsaved-test";

    await expect(writeLookupTableRows(graph, "site1", { ...table, relatedList: { id: listId } }, "42", [{ values: {}, deleted: true }])).resolves.toBeUndefined();
    const page = await graph.searchListItems("site1", listId, {});
    expect(page.items).toHaveLength(0);
  });
});
