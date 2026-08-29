import { describe, it, expect } from "vitest";
import type { FieldConfig } from "@skye/config";
import { MockGraphClient } from "../lib/mock-graph/mockGraphClient.js";
import { uploadFieldFile } from "../lib/submit/fileUpload.js";

function makeFile(name: string, content = "hello"): File {
  return new File([content], name, { type: "text/plain" });
}

describe("uploadFieldFile", () => {
  it("uploads to the configured library and returns a driveItemId/webUrl", async () => {
    const graph = new MockGraphClient();
    const field: FieldConfig = {
      page: "p1",
      source: "sharepoint",
      bindTo: "Attachment",
      controlType: "file",
      fileStorage: { target: "library", library: { driveId: "drive-1", folderPath: "Uploads" } },
    };

    const result = await uploadFieldFile(graph, "site1", field, makeFile("report.txt"));
    expect(result.driveItemId).toBeTruthy();
    expect(result.webUrl).toContain("report.txt");
  });

  it("throws a clear error for attachment-mode (unimplemented) rather than silently failing or guessing an endpoint", async () => {
    const graph = new MockGraphClient();
    const field: FieldConfig = { page: "p1", source: "sharepoint", bindTo: "Attachment", controlType: "file" }; // defaults to "attachment"

    await expect(uploadFieldFile(graph, "site1", field, makeFile("report.txt"))).rejects.toThrow(/isn't implemented/);
  });

  it("throws a clear error when library mode is selected but no driveId is configured", async () => {
    const graph = new MockGraphClient();
    const field: FieldConfig = { page: "p1", source: "sharepoint", bindTo: "Attachment", controlType: "file", fileStorage: { target: "library" } };

    await expect(uploadFieldFile(graph, "site1", field, makeFile("report.txt"))).rejects.toThrow(/no fileStorage\.library/);
  });
});
