import { describe, it, expect, vi } from "vitest";
import { canEditFormConfig } from "../features/builder/permissions.js";
import { SkyeNotConfiguredError } from "../shared/site-config.js";
import type { GraphClient } from "../shared/sharepoint/types.js";

function graphStub(
  getSkyeSiteConfigFiles: GraphClient["getSkyeSiteConfigFiles"],
  canWriteSkyeData: GraphClient["canWriteSkyeData"] = vi.fn().mockResolvedValue(false)
): GraphClient {
  return { getSkyeSiteConfigFiles, canWriteSkyeData } as unknown as GraphClient;
}

describe("canEditFormConfig", () => {
  it("returns true when the user can write into skye_data, without consulting builderEditors", async () => {
    const getFiles = vi.fn().mockResolvedValue([{ source: "base", config: {} }]);
    const graph = graphStub(getFiles, vi.fn().mockResolvedValue(true));
    expect(await canEditFormConfig(graph, "site1")).toBe(true);
    expect(getFiles).not.toHaveBeenCalled();
  });

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
