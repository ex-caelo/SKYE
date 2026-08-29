import { describe, it, expect, vi } from "vitest";
import { canEditFormConfig } from "../lib/builder/permissions.js";
import { SkyeNotConfiguredError } from "../lib/views/viewConfig.js";
import type { GraphClient } from "../lib/graph/types.js";

function graphStub(getSkyeSiteConfigFiles: GraphClient["getSkyeSiteConfigFiles"]): GraphClient {
  return { getSkyeSiteConfigFiles } as unknown as GraphClient;
}

describe("canEditFormConfig", () => {
  it("returns true when the fetched site config grants edit access", async () => {
    const graph = graphStub(vi.fn().mockResolvedValue([
      { source: "base", config: { builderEditors: ["admin"] } },
      { source: "admin", config: {} },
    ]));
    expect(await canEditFormConfig(graph, "site1")).toBe(true);
  });

  it("returns false when it does not", async () => {
    const graph = graphStub(vi.fn().mockResolvedValue([{ source: "base", config: {} }]));
    expect(await canEditFormConfig(graph, "site1")).toBe(false);
  });

  it("returns false (not a thrown error) for a site with no SKYE config at all", async () => {
    const graph = graphStub(vi.fn().mockRejectedValue(new SkyeNotConfiguredError()));
    expect(await canEditFormConfig(graph, "site1")).toBe(false);
  });

  it("propagates any other, unexpected error", async () => {
    const graph = graphStub(vi.fn().mockRejectedValue(new Error("network down")));
    await expect(canEditFormConfig(graph, "site1")).rejects.toThrow("network down");
  });
});
