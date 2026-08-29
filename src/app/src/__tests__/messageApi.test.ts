import { describe, it, expect, vi } from "vitest";
import { createViewApi } from "../lib/views/messageApi.js";
import type { GraphClient, GraphListColumn } from "../lib/graph/types.js";
import type { SkyeSiteConfig } from "../lib/views/viewConfig.js";

const COLUMNS: GraphListColumn[] = [
  { name: "Title", displayName: "Title", columnType: "text", required: true },
  { name: "Start", displayName: "Start", columnType: "dateTime" },
  { name: "Poster", displayName: "Poster", columnType: "hyperlinkOrPicture" },
];

const siteConfig: SkyeSiteConfig = {
  views: { allowedLists: ["Events"] },
  navigation: { allowedExternalOrigins: ["https://ok.example"] },
  builderEditors: [],
};

/** A GraphClient stub with just the methods the view API touches; `getListColumns` throws for unknown lists like real Graph would. */
function fakeGraph(overrides: Partial<GraphClient> = {}): GraphClient {
  const base = {
    getListColumns: vi.fn(async (_s: string, listId: string) => {
      if (listId !== "Events") throw new Error(`list "${listId}" not found`);
      return COLUMNS;
    }),
    searchListItems: vi.fn(async () => ({ items: [{ id: "1", fields: { Title: "Keynote" } }], nextLink: "next-token", totalCount: 7 })),
    getListItem: vi.fn(async (_s: string, _l: string, id: string) => ({ id, fields: { Title: "Keynote" } })),
    getListItemImage: vi.fn(async () => ({ contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) })),
  } as unknown as GraphClient;
  return Object.assign(base, overrides);
}

function makeApi(graph = fakeGraph(), navigate = vi.fn()) {
  return {
    api: createViewApi({ graph, siteConfig, ctx: { siteId: "s1", applicationId: "a1" }, navigate }),
    graph,
    navigate,
  };
}

describe("createViewApi dispatch", () => {
  it("has no write-shaped handler at all", () => {
    const { api } = makeApi();
    for (const t of ["skye:createItem", "skye:updateItem", "skye:deleteItem", "skye:write"]) {
      expect(api.has(t)).toBe(false);
    }
    expect(api.has("skye:list")).toBe(true);
  });

  it("rejects an unknown request type with code unknownType", async () => {
    const { api } = makeApi();
    await expect(api.handle("skye:deleteItem", {})).rejects.toMatchObject({ code: "unknownType" });
  });

  it("does not resolve Object.prototype members as handlers (no prototype-chain dispatch)", async () => {
    const { api } = makeApi();
    for (const t of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(api.has(t)).toBe(false);
      await expect(api.handle(t, {})).rejects.toMatchObject({ code: "unknownType" });
    }
  });

  it("skye:lists returns the config allowlist without hitting Graph", async () => {
    const { api, graph } = makeApi();
    expect(await api.handle("skye:lists", {})).toEqual(["Events"]);
    expect(graph.getListColumns).not.toHaveBeenCalled();
  });

  it("skye:schema rejects a list not on the allowlist with code listNotAllowed", async () => {
    const { api } = makeApi();
    await expect(api.handle("skye:schema", { name: "SecretHRList" })).rejects.toMatchObject({ code: "listNotAllowed" });
  });

  it("skye:schema returns a safe column subset for an allowlisted list", async () => {
    const { api } = makeApi();
    const schema = (await api.handle("skye:schema", { name: "Events" })) as Array<Record<string, unknown>>;
    expect(schema[0]).toEqual({ name: "Title", label: "Title", type: "text", required: true, choices: undefined });
  });

  it("skye:list validates the query against the schema, compiles it, and calls Graph", async () => {
    const { api, graph } = makeApi();
    const result = await api.handle("skye:list", {
      name: "Events",
      query: { where: { field: "Title", operator: "equals", value: "Keynote" }, orderBy: [{ field: "Start", direction: "desc" }], top: 5 },
    });
    expect(graph.searchListItems).toHaveBeenCalledWith("s1", "Events", {
      filter: "fields/Title eq 'Keynote'",
      orderby: "fields/Start desc",
      top: 5,
    });
    expect(result).toEqual({ items: [{ id: "1", fields: { Title: "Keynote" } }], cursor: "next-token", totalCount: 7 });
  });

  it("skye:list rejects an unknown field before calling Graph", async () => {
    const { api, graph } = makeApi();
    await expect(api.handle("skye:list", { name: "Events", query: { where: { field: "Ssn", operator: "equals", value: "x" } } })).rejects.toMatchObject({
      code: "unknownField",
    });
    expect(graph.searchListItems).not.toHaveBeenCalled();
  });

  it("skye:list passes a cursor straight through and ignores other query fields", async () => {
    const { api, graph } = makeApi();
    await api.handle("skye:list", { name: "Events", query: { cursor: "opaque-token", where: { field: "Title", operator: "equals", value: "x" } } });
    expect(graph.searchListItems).toHaveBeenCalledWith("s1", "Events", { cursor: "opaque-token" });
  });

  it("defense in depth: a list that slips past the allowlist still fails at the Graph layer", async () => {
    // Force the allowlist to contain a list the fake Graph doesn't have.
    const api = createViewApi({
      graph: fakeGraph(),
      siteConfig: { ...siteConfig, views: { allowedLists: ["Events", "SecretHRList"] } },
      ctx: { siteId: "s1", applicationId: "a1" },
      navigate: vi.fn(),
    });
    await expect(api.handle("skye:list", { name: "SecretHRList", query: {} })).rejects.toThrow(/not found/);
  });

  it("skye:item rejects a non-slug id", async () => {
    const { api } = makeApi();
    await expect(api.handle("skye:item", { name: "Events", id: "1 or 1=1" })).rejects.toMatchObject({ code: "badId" });
  });

  it("skye:image returns a data: URI and rejects an unknown field", async () => {
    const { api } = makeApi();
    const uri = await api.handle("skye:image", { name: "Events", id: "1", field: "Poster" });
    expect(uri).toBe("data:image/png;base64,AQID");
    await expect(api.handle("skye:image", { name: "Events", id: "1", field: "../etc" })).rejects.toMatchObject({ code: "unknownField" });
  });

  it("skye:navigate resolves the policy and invokes the host navigate callback", async () => {
    const { api, navigate } = makeApi();
    const res = await api.handle("skye:navigate", { target: { view: "calendar" } });
    expect(navigate).toHaveBeenCalledWith({ kind: "internal", url: "/view?siteId=s1&applicationId=a1#calendar" });
    expect(res).toEqual({ ok: true, kind: "internal" });
  });

  it("skye:navigate rejects a non-allowlisted external URL and does not navigate", async () => {
    const { api, navigate } = makeApi();
    await expect(api.handle("skye:navigate", { target: { url: "https://evil.example/" } })).rejects.toThrow(/allowlist/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("caches schema across calls (one getListColumns per list)", async () => {
    const { api, graph } = makeApi();
    await api.handle("skye:schema", { name: "Events" });
    await api.handle("skye:list", { name: "Events", query: {} });
    await api.handle("skye:schema", { name: "Events" });
    expect(graph.getListColumns).toHaveBeenCalledTimes(1);
  });
});
