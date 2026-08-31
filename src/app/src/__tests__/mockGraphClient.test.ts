import { describe, it, expect } from "vitest";
import { MockGraphClient } from "../lib/mock-graph/mockGraphClient.js";
import { EtagConflictError } from "../lib/graph/types.js";

describe("MockGraphClient", () => {
  it("returns fixture list columns", async () => {
    const client = new MockGraphClient();
    const columns = await client.getListColumns("site1", "list1");
    expect(columns.find((c) => c.name === "Title")).toBeTruthy();
  });

  it("lists the site's lists (id + displayName), sorted, for the builder's new-form list picker", async () => {
    const client = new MockGraphClient();
    const lists = await client.listSiteLists("site1");
    expect(lists.length).toBeGreaterThan(1);
    expect(lists.every((l) => typeof l.id === "string" && typeof l.displayName === "string")).toBe(true);
    const names = lists.map((l) => l.displayName);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    // Every returned id is one getListColumns will accept (so a picked list actually resolves).
    for (const l of lists) await expect(client.getListColumns("site1", l.id)).resolves.toBeInstanceOf(Array);
  });

  it("returns the base config plus the admin overlay for the known fixture form", async () => {
    const client = new MockGraphClient();
    const files = await client.getSkyeFormConfigFiles("site1", "test-event-signup");
    expect(files.map((f) => f.source)).toEqual(["base", "admin"]);
  });

  it("throws a clear error for an unknown form id rather than returning nothing", async () => {
    const client = new MockGraphClient();
    await expect(client.getSkyeFormConfigFiles("site1", "not-a-real-form")).rejects.toThrow(/no fixture form config/);
  });

  it("creates and then reads back an item", async () => {
    const client = new MockGraphClient();
    const created = await client.createListItem("site1", "list1", { Title: "New item" });
    const fetched = await client.getListItem("site1", "list1", created.id);
    expect(fetched.fields.Title).toBe("New item");
  });

  it("throws EtagConflictError (not a generic error) on etag mismatch during update", async () => {
    const client = new MockGraphClient();
    await expect(client.updateListItem("site1", "list1", "1", { Title: "x" }, '"stale-etag"')).rejects.toThrow(EtagConflictError);
  });

  it("searches fixture people by display name", async () => {
    const client = new MockGraphClient();
    const results = await client.searchPeople("alex");
    expect(results).toHaveLength(1);
    expect(results[0].displayName).toBe("Alex Chen");
  });

  it("returns all people when the query is empty", async () => {
    const client = new MockGraphClient();
    const results = await client.searchPeople("");
    expect(results.length).toBeGreaterThan(1);
  });

  it("searches list items by a display field and returns id/label pairs", async () => {
    const client = new MockGraphClient();
    await client.createListItem("site1", "guests-list", { Title: "Alex Guest" });
    await client.createListItem("site1", "guests-list", { Title: "Jordan Guest" });
    const results = await client.searchLookupItems("site1", "guests-list", "Title", "alex");
    expect(results).toEqual([{ id: expect.any(String), label: "Alex Guest" }]);
  });

  it("returns the fixture list of sites with a skye_data directory", async () => {
    const client = new MockGraphClient();
    const sites = await client.searchSitesWithSkyeData();
    expect(sites.length).toBeGreaterThan(0);
    expect(sites[0]).toHaveProperty("siteId");
    expect(sites[0]).toHaveProperty("displayName");
    expect(sites[0]).toHaveProperty("webUrl");
  });

  it("lists the fixture form with its title, for the switcher's form-picker step", async () => {
    const client = new MockGraphClient();
    const forms = await client.listSkyeForms("site1");
    expect(forms).toEqual([{ formId: "test-event-signup", title: "Event Sign-up" }]);
  });

  describe("set-up-a-new-site flow", () => {
    it("resolves a SharePoint URL to a synthetic new site, and null for an unreachable one", async () => {
      const client = new MockGraphClient();
      const site = await client.resolveSiteByUrl("https://contoso.sharepoint.com/sites/BrandNew");
      expect(site).toMatchObject({ webUrl: "https://contoso.sharepoint.com/sites/BrandNew" });
      expect(await client.resolveSiteByUrl("not a url")).toBeNull();
      expect(await client.resolveSiteByUrl("https://contoso.sharepoint.com/sites/notfound-xyz")).toBeNull();
    });

    it("reduces a deep page/library URL to the site, and a Teams link to a per-group site", async () => {
      const client = new MockGraphClient();
      const fromPage = await client.resolveSiteByUrl("https://contoso.sharepoint.com/sites/BrandNew/Shared%20Documents/Forms/AllItems.aspx");
      expect(fromPage).toMatchObject({ webUrl: "https://contoso.sharepoint.com/sites/BrandNew" });

      const fromTeams = await client.resolveSiteByUrl(
        "https://teams.microsoft.com/l/team/19%3Ax%40thread.tacv2/conversations?groupId=6f69192b-0cd6-446c-b2cd-4677d8256d9a&tenantId=t"
      );
      expect(fromTeams?.siteId).toBe("mock-site-team-6f69192b");
    });

    it("reports no skye_data on a new site, then installs it and reports it present", async () => {
      const client = new MockGraphClient();
      const site = (await client.resolveSiteByUrl("https://contoso.sharepoint.com/sites/FreshSite"))!;
      expect(await client.hasSkyeConfig(site.siteId)).toBe(false);

      const result = await client.installSkyeSiteConfig(site.siteId);
      expect(result).toMatchObject({ libraryName: "Site Assets" });
      expect(result.libraryListId).toBeTruthy();
      expect(result.skyeDataItemId).toBeTruthy();
      expect(await client.hasSkyeConfig(site.siteId)).toBe(true);

      // A just-installed site resolves to only the minimal default config, no overlays.
      const files = await client.getSkyeSiteConfigFiles(site.siteId);
      expect(files.map((f) => f.source)).toEqual(["base"]);
      expect((files[0].config as { views: { allowedLists: string[] } }).views.allowedLists).toEqual([]);

      // …and now shows up in the switcher's site list.
      const sites = await client.searchSitesWithSkyeData();
      expect(sites.some((s) => s.siteId === site.siteId)).toBe(true);
    });

    it("throws SkyeInstallError (kind 'forbidden') when the site simulates a permissions failure", async () => {
      const client = new MockGraphClient();
      await expect(client.installSkyeSiteConfig("mock-site-forbidden")).rejects.toMatchObject({
        name: "SkyeInstallError",
        kind: "forbidden",
      });
    });

    it("throws 'siteAssetsMissing' the first time, then succeeds on retry (as if the user created Site Assets)", async () => {
      const client = new MockGraphClient();
      await expect(client.installSkyeSiteConfig("mock-site-noassets-x")).rejects.toMatchObject({ kind: "siteAssetsMissing" });
      const result = await client.installSkyeSiteConfig("mock-site-noassets-x");
      expect(result.libraryName).toBe("Site Assets");
    });

    it("canWriteSkyeData: true on a configured site, false when read-only or not set up", async () => {
      const client = new MockGraphClient();
      const fixtureSite = (await client.searchSitesWithSkyeData())[0];
      expect(await client.canWriteSkyeData(fixtureSite.siteId)).toBe(true);

      // A site that isn't set up yet — nothing to write into.
      const fresh = (await client.resolveSiteByUrl("https://contoso.sharepoint.com/sites/NotYetSet"))!;
      expect(await client.canWriteSkyeData(fresh.siteId)).toBe(false);
      await client.installSkyeSiteConfig(fresh.siteId);
      expect(await client.canWriteSkyeData(fresh.siteId)).toBe(true);

      // A read-only user.
      expect(await client.canWriteSkyeData("mock-site-readonly")).toBe(false);
    });
  });

  // Uses its own siteId ("site-builder-test") rather than "site1", so writes here can't be
  // observed by (or observe state left over from) the other fixture-form tests above, which all
  // share the module-level in-memory store keyed by siteId — same isolation approach already
  // relied on elsewhere in this file (list1/guests-list use distinct listIds for the same reason).
  it("saveSkyeFormConfigFile writes a new form config that a later getSkyeFormConfigFiles then reads back", async () => {
    const client = new MockGraphClient();
    const draft = { title: "Brand new form", list: { id: "list1" }, pages: {}, fields: {} };
    await client.saveSkyeFormConfigFile("site-builder-test", "brand-new-form", "base", draft);

    const files = await client.getSkyeFormConfigFiles("site-builder-test", "brand-new-form");
    expect(files).toEqual([{ source: "base", config: draft }]);
  });

  it("saveSkyeFormConfigFile against the fixture form's id layers on top of (and can override) the seeded fixture data", async () => {
    const client = new MockGraphClient();
    // Force-seed by reading first, matching how entry-builder.ts would load an existing form.
    await client.getSkyeFormConfigFiles("site-builder-test-2", "test-event-signup").catch(() => {
      // This siteId has never seen "test-event-signup" before, so the initial read seeds it —
      // it doesn't throw (formId IS the known fixture), this catch just documents that intent.
    });
    await client.saveSkyeFormConfigFile("site-builder-test-2", "test-event-signup", "base", { title: "Edited title" });

    const files = await client.getSkyeFormConfigFiles("site-builder-test-2", "test-event-signup");
    const base = files.find((f) => f.source === "base");
    expect(base?.config).toEqual({ title: "Edited title" });
    // The admin overlay, never touched, is still there untouched.
    expect(files.find((f) => f.source === "admin")).toBeTruthy();
  });

  it("listFormDrafts returns an empty array for a form with no drafts yet, rather than throwing", async () => {
    const client = new MockGraphClient();
    expect(await client.listFormDrafts("site-drafts-1", "test-event-signup")).toEqual([]);
  });

  it("saveFormDraft writes a draft that listFormDrafts and getFormDraft then see", async () => {
    const client = new MockGraphClient();
    const draft = { title: "Beta layout", list: { id: "list1" }, pages: {}, fields: {} };
    await client.saveFormDraft("site-drafts-2", "test-event-signup", "beta1", draft);

    expect(await client.listFormDrafts("site-drafts-2", "test-event-signup")).toEqual([{ draftId: "beta1", title: "Beta layout" }]);
    expect(await client.getFormDraft("site-drafts-2", "test-event-signup", "beta1")).toEqual(draft);
  });

  it("getFormDraft throws a clear error for an unknown draft id", async () => {
    const client = new MockGraphClient();
    await expect(client.getFormDraft("site-drafts-3", "test-event-signup", "nope")).rejects.toThrow(/no draft/);
  });

  it("publishFormDraft copies the draft's config to become the live base, without deleting the draft", async () => {
    const client = new MockGraphClient();
    const draft = { title: "Promoted", list: { id: "list1" }, pages: {}, fields: {} };
    await client.saveFormDraft("site-drafts-4", "test-event-signup", "beta1", draft);
    await client.publishFormDraft("site-drafts-4", "test-event-signup", "beta1");

    const files = await client.getSkyeFormConfigFiles("site-drafts-4", "test-event-signup");
    expect(files.find((f) => f.source === "base")?.config).toEqual(draft);
    // Still there afterward — publish is non-destructive.
    expect(await client.getFormDraft("site-drafts-4", "test-event-signup", "beta1")).toEqual(draft);
  });

  it("a form saved via saveSkyeFormConfigFile shows up in listSkyeForms for that site, alongside the always-available fixture form", async () => {
    const client = new MockGraphClient();
    await client.saveSkyeFormConfigFile("site-builder-test-3", "another-new-form", "base", { title: "Another new form" });
    const forms = await client.listSkyeForms("site-builder-test-3");
    expect(forms).toEqual(
      expect.arrayContaining([
        { formId: "another-new-form", title: "Another new form" },
        { formId: "test-event-signup", title: "Event Sign-up" },
      ])
    );
  });
});
