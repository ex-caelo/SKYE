import { describe, it, expect } from "vitest";
import { MockGraphClient } from "../lib/mock-graph/mockGraphClient.js";
import { resolveSiteConfig } from "../lib/views/viewConfig.js";

describe("MockGraphClient — Custom Views surface", () => {
  it("serves the fixture view files, and throws for an unknown view id", async () => {
    const c = new MockGraphClient();
    const files = await c.getSkyeViewFiles("s1", "calendar");
    expect(files.html).toContain("grid");
    expect(files.js.length).toBeGreaterThan(0);
    await expect(c.getSkyeViewFiles("s1", "nope")).rejects.toThrow(/no fixture Custom View/);
  });

  it("returns the base site config plus an admin overlay that resolveSiteConfig unions", async () => {
    const c = new MockGraphClient();
    const files = await c.getSkyeSiteConfigFiles("s1");
    expect(files.map((f) => f.source)).toEqual(["base", "admin"]);
    const config = resolveSiteConfig(files);
    expect(config.views.allowedLists.sort()).toEqual(["AuditLog", "EventDetails", "Events"]);
    expect(config.home).toEqual({ type: "view", id: "calendar" });
  });

  it("lists the fixture views", async () => {
    const views = await new MockGraphClient().listSkyeViews("s1");
    expect(views.map((v) => v.viewId).sort()).toEqual(["calendar", "security-probes"]);
  });

  it("returns image bytes for skye.image()", async () => {
    const img = await new MockGraphClient().getListItemImage("s1", "Events", "1", "Poster");
    expect(img.contentType).toBe("image/png");
    expect(img.bytes).toBeInstanceOf(Uint8Array);
    expect(img.bytes.length).toBeGreaterThan(0);
  });

  it("returns view-list columns, and throws for a list it doesn't have (simulated 404)", async () => {
    const c = new MockGraphClient();
    const cols = await c.getListColumns("s1", "Events");
    expect(cols.some((col) => col.name === "Start")).toBe(true);
    await expect(c.getListColumns("s1", "TotallyNotAList")).rejects.toThrow(/not found/);
  });

  describe("searchListItems query support", () => {
    it("applies a compiled OData filter", async () => {
      const page = await new MockGraphClient().searchListItems("s1", "EventDetails", { filter: "fields/EventId eq 1" });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].fields.Host).toBe("Dr. Lee");
    });

    it("applies and/or groups and contains()", async () => {
      const c = new MockGraphClient();
      const orPage = await c.searchListItems("s1", "Events", { filter: "(fields/Category eq 'talk' or fields/Category eq 'social')" });
      expect(orPage.items.length).toBeGreaterThanOrEqual(3);
      const containsPage = await c.searchListItems("s1", "Events", { filter: "contains(fields/Title, 'Keynote')" });
      expect(containsPage.items.map((i) => i.fields.Title)).toEqual(["Opening Keynote"]);
    });

    it("sorts by orderby, descending", async () => {
      const page = await new MockGraphClient().searchListItems("s1", "Events", { orderby: "fields/Start desc" });
      const starts = page.items.map((i) => i.fields.Start as string);
      expect(starts).toEqual([...starts].sort().reverse());
    });

    it("reports totalCount only when asked, and paginates with skip/top + a cursor", async () => {
      const c = new MockGraphClient();
      const first = await c.searchListItems("s1", "Events", { top: 2, count: true, orderby: "fields/Start asc" });
      expect(first.totalCount).toBe(6);
      expect(first.items).toHaveLength(2);
      expect(first.nextLink).toBeTruthy();

      const second = await c.searchListItems("s1", "Events", { cursor: first.nextLink });
      expect(second.items[0].fields.Title).not.toBe(first.items[0].fields.Title);
    });
  });
});
