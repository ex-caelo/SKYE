import { describe, it, expect } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import { MockGraphClient } from "../shared/sharepoint/mockGraphClient.js";
import { uploadFieldFile, renderUploadFileName } from "../features/form/submit/fileUpload.js";

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

  it("renames the upload from fileStorage.fileNameTemplate, keeping the original extension", async () => {
    const graph = new MockGraphClient();
    const field: FieldConfig = {
      page: "p1",
      source: "sharepoint",
      bindTo: "Poster",
      controlType: "file",
      fileStorage: {
        target: "library",
        library: { driveId: "drive-1", folderPath: "PHOTOS!/Event Posters/2026-2027" },
        fileNameTemplate: "{{date:startTime}} {{fields.eventTitle}} Poster",
      },
    };

    const result = await uploadFieldFile(graph, "site1", field, makeFile("IMG_4821.png"), {
      startTime: "2026-03-14T18:00",
      eventTitle: "Spring Hackathon",
    });

    expect(decodeURIComponent(result.webUrl)).toContain("2026.03.14 Spring Hackathon Poster.png");
  });
});

describe("renderUploadFileName", () => {
  it("substitutes {{date:key}} as YYYY.MM.DD and {{fields.key}} as the raw value", () => {
    expect(
      renderUploadFileName("{{date:startTime}} {{fields.eventTitle}} Poster", { startTime: "2026-03-14T18:00", eventTitle: "Kickoff" }, "x.jpg")
    ).toBe("2026.03.14 Kickoff Poster.jpg");
  });

  it("reads a bare date value without a timezone shift", () => {
    expect(renderUploadFileName("{{date:d}}", { d: "2026-01-01" }, "x.png")).toBe("2026.01.01.png");
  });

  it("strips characters SharePoint rejects in a file name", () => {
    expect(renderUploadFileName("{{fields.t}}", { t: 'A/B: "C" <#1>' }, "x.pdf")).toBe("A B C 1.pdf");
  });

  it("falls back to the original name when the template renders empty", () => {
    expect(renderUploadFileName("{{fields.missing}}", {}, "original.docx")).toBe("original.docx");
  });

  it("keeps a name with no extension extension-less", () => {
    expect(renderUploadFileName("{{fields.t}}", { t: "notes" }, "README")).toBe("notes");
  });
});
