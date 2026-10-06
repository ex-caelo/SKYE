import { describe, it, expect, vi } from "vitest";
import type { LookupTable } from "@skye/form-config";
import type { GraphClient, GraphListColumn } from "../shared/sharepoint/types.js";
import { MockGraphClient } from "../shared/sharepoint/mockGraphClient.js";
import { writeLookupTableRows } from "../features/form/submit/lookupTableRows.js";

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
      Correlated_x0020_EventLookupId: "42",
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
    expect(updated.fields.Correlated_x0020_EventLookupId).toBe("42");
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

  it("falls back to plain values (no crash) when the related list's columns can't be fetched", async () => {
    const graph = {
      getListColumns: vi.fn().mockRejectedValue(new Error("simulated 403")),
      createListItem: vi.fn().mockResolvedValue({ id: "1", fields: {} }),
    } as unknown as GraphClient;

    await writeLookupTableRows(graph, "site1", table, "42", [{ values: { guestName: "Alex" } }]);
    expect(graph.createListItem).toHaveBeenCalledWith("site1", "related-list-1", { Title: "Alex", Correlated_x0020_EventLookupId: "42" }, undefined);
  });

  describe("a column Graph reports as hyperlinkOrPicture", () => {
    const linkTable: LookupTable = {
      relatedList: { id: "related-list-1" },
      linkMode: "parentReference",
      parentReferenceColumn: "Correlated_x0020_Event",
      columns: {
        itemTitle: { source: "sharepoint", bindTo: "Title", controlType: "text" },
        linkToItem: { source: "sharepoint", bindTo: "LinktoItem", controlType: "url" },
      },
    };
    const relatedColumns: GraphListColumn[] = [
      { name: "Title", displayName: "Title", columnType: "text" },
      { name: "LinktoItem", displayName: "Link to Item", columnType: "hyperlinkOrPicture" },
    ];

    it("encodes it as { Url, Description } and requests the beta API version header on create", async () => {
      const graph = {
        getListColumns: vi.fn().mockResolvedValue(relatedColumns),
        createListItem: vi.fn().mockResolvedValue({ id: "1", fields: {} }),
      } as unknown as GraphClient;

      await writeLookupTableRows(graph, "site1", linkTable, "42", [
        { values: { itemTitle: "Cream Cheese", linkToItem: "https://www.kroger.com/p/x" } },
      ]);

      expect(graph.createListItem).toHaveBeenCalledWith(
        "site1",
        "related-list-1",
        {
          Title: "Cream Cheese",
          LinktoItem: { Url: "https://www.kroger.com/p/x", Description: "https://www.kroger.com/p/x" },
          Correlated_x0020_EventLookupId: "42",
        },
        { preferBetaApiVersion: true }
      );
    });

    it("still encodes it even when Graph's /columns response reports no facet at all for it (confirmed live: a real hyperlinkOrPicture column can omit the facet entirely, both from the collection and a single-column GET by id or name) — controlType: \"url\" alone is enough", async () => {
      const graph = {
        // Mirrors the real, live-confirmed response shape: no `hyperlinkOrPicture` key, so
        // graphClient.ts's mapColumn falls back to columnType "text" for this column.
        getListColumns: vi.fn().mockResolvedValue([{ name: "Title", displayName: "Title", columnType: "text" }, { name: "LinktoItem", displayName: "Link to Item", columnType: "text" }]),
        createListItem: vi.fn().mockResolvedValue({ id: "1", fields: {} }),
      } as unknown as GraphClient;

      await writeLookupTableRows(graph, "site1", linkTable, "42", [
        { values: { itemTitle: "Cream Cheese", linkToItem: "https://www.kroger.com/p/x" } },
      ]);

      expect(graph.createListItem).toHaveBeenCalledWith(
        "site1",
        "related-list-1",
        expect.objectContaining({ LinktoItem: { Url: "https://www.kroger.com/p/x", Description: "https://www.kroger.com/p/x" } }),
        { preferBetaApiVersion: true }
      );
    });

    it("does the same on update, and doesn't request the header when the row has no hyperlinkOrPicture value", async () => {
      const graph = {
        getListColumns: vi.fn().mockResolvedValue(relatedColumns),
        updateListItem: vi.fn().mockResolvedValue({ id: "row-1", fields: {} }),
      } as unknown as GraphClient;

      await writeLookupTableRows(graph, "site1", linkTable, "42", [{ id: "row-1", values: { itemTitle: "No link here" } }]);

      expect(graph.updateListItem).toHaveBeenCalledWith(
        "site1",
        "related-list-1",
        "row-1",
        { Title: "No link here", Correlated_x0020_EventLookupId: "42" },
        undefined,
        undefined
      );
    });
  });
});
