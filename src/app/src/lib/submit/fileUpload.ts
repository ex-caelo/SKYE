import type { FieldConfig } from "@skye/config";
import type { GraphClient, UploadedFile } from "../graph/types.js";

/** Reads a File/Blob's contents as an ArrayBuffer via FileReader — used instead of Blob.arrayBuffer() since that method isn't implemented in every environment (notably jsdom's File polyfill, used in this repo's tests) that otherwise supports File/Blob fine. */
function readFileAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Uploads a `file` controlType field's selected File, per its
 * `fileStorage.target` (defaults to "attachment" per the schema).
 *
 * IMPORTANT — "attachment" mode is intentionally NOT implemented here. As
 * of this writing, Microsoft Graph v1.0 does not have a well-documented,
 * stable endpoint for SharePoint list item attachments the way it does for
 * document libraries — historically this has required the separate
 * SharePoint REST API (a different token audience/scope than Graph), which
 * this app hasn't set up. Rather than guess at an endpoint that might not
 * exist or might silently fail in a real tenant, this throws a clear error
 * pointing at the one mode that IS solidly implemented. See TODO §10.
 */
export async function uploadFieldFile(graph: GraphClient, siteId: string, field: FieldConfig, file: File): Promise<UploadedFile> {
  const target = field.fileStorage?.target ?? "attachment";

  if (target === "attachment") {
    throw new Error(
      `File field targets "attachment" storage, which isn't implemented yet (Microsoft Graph has no solid v1.0 endpoint for ` +
        `SharePoint list item attachments as of this writing — see TODO §10 and fileUpload.ts's docstring). ` +
        `Set this field's fileStorage.target to "library" (with a driveId) for a fully working upload path.`
    );
  }

  const library = field.fileStorage?.library;
  if (!library) throw new Error('File field targets "library" storage but has no fileStorage.library.driveId configured.');

  const data = await readFileAsArrayBuffer(file);
  return graph.uploadToLibrary(library.siteId ?? siteId, library.driveId, library.folderPath, file.name, data);
}
