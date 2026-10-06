/**
 * Drag-and-drop + small preview enhancement layered on top of a real
 * `<input type="file">`. The input stays the single source of truth for
 * the selected file — renderForm.ts's own change listener still reads
 * `.files?.[0]` from it directly, unchanged — this module only adds a
 * nicer picking experience around it: a drop target with visual feedback,
 * and a small preview (a thumbnail for an image, a generic icon otherwise,
 * plus filename/size) with a way to remove the selection. Both a drop and
 * the remove button end up dispatching a normal `change` event on the
 * input, which is what renderForm's own listener already reacts to — no
 * coordination with it is needed here.
 */

const DRAGOVER_CLASS = "skye-file-upload--dragover";
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);

/** Human-readable file size, e.g. "128 KB" / "3.4 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const formatted = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(0);
  return `${formatted} ${units[unitIndex]}`;
}

/**
 * The decoded file name at the end of a URL's path (query/hash stripped),
 * or the whole string if it isn't a parseable URL. Exported so
 * page-scripts/form.ts can capture a saved value's real name BEFORE
 * swapping it for an opaque blob URL (see renderFilePreview's `overrides`
 * param — a blob URL has no extension/filename of its own to derive one
 * from).
 */
export function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)) || url;
  } catch {
    return url;
  }
}

/**
 * Best-effort "does this URL point at an image" — there's no MIME type to
 * check for an already-saved value, only its file extension. Exported so
 * page-scripts/form.ts can decide, before ever handing a saved value to
 * this module, whether it's worth fetching the image's actual bytes via
 * Graph (see that file's own comment on why a raw SharePoint webUrl can't
 * just be set as an `<img src>` directly).
 */
export function looksLikeImageUrl(url: string): boolean {
  const name = fileNameFromUrl(url).split(/[?#]/)[0];
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Builds (or clears) the small preview shown once a file is selected —
 * either a freshly picked `File` (thumbnail via an object URL, revoked on
 * the next swap so repeated selections don't leak blob URLs), or the
 * `string` URL of a value already saved on the item (an edit/view-mode
 * field's initial value — see renderForm.ts, which calls this directly
 * since a real `<input type="file">` can never be seeded with an existing
 * file's contents). `undefined` hides the preview.
 *
 * `overrides` lets a caller supply the display name and/or "is this an
 * image" verdict directly instead of deriving them from `source` —
 * needed when `source` is a blob URL page-scripts/form.ts created after
 * fetching a saved image's bytes through Graph: the blob URL itself has
 * no filename or extension of its own (just an opaque UUID), so deriving
 * either from it directly would show a UUID as the "filename" and miss
 * the image entirely. The caller captures both from the ORIGINAL saved
 * URL (via `fileNameFromUrl`/`looksLikeImageUrl`) before replacing it
 * with the blob URL, and passes them through here.
 */
export function renderFilePreview(
  previewEl: HTMLElement,
  source: File | string | undefined,
  document: Document,
  onRemove: () => void,
  overrides?: { name?: string; isImage?: boolean }
): void {
  const previousUrl = previewEl.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  delete previewEl.dataset.objectUrl;
  previewEl.innerHTML = "";

  if (!source) {
    previewEl.hidden = true;
    return;
  }
  previewEl.hidden = false;

  const isFile = source instanceof File;
  const name = overrides?.name ?? (isFile ? source.name : fileNameFromUrl(source));
  const isImage = overrides?.isImage ?? (isFile ? source.type.startsWith("image/") : looksLikeImageUrl(source));

  if (isImage) {
    const url = isFile ? URL.createObjectURL(source) : source;
    if (isFile) previewEl.dataset.objectUrl = url;
    const img = document.createElement("img");
    img.className = "skye-file-upload__thumb";
    img.src = url;
    img.alt = "";
    previewEl.appendChild(img);
  } else {
    const icon = document.createElement("span");
    icon.className = "skye-file-upload__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "📄";
    previewEl.appendChild(icon);
  }

  const meta = document.createElement("span");
  meta.className = "skye-file-upload__meta";
  const nameEl = document.createElement("span");
  nameEl.className = "skye-file-upload__name";
  nameEl.textContent = name;
  meta.appendChild(nameEl);
  if (isFile) {
    const size = document.createElement("span");
    size.className = "skye-file-upload__size";
    size.textContent = formatFileSize(source.size);
    meta.appendChild(size);
  }
  previewEl.appendChild(meta);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "skye-file-upload__remove";
  removeButton.setAttribute("aria-label", `Remove ${name}`);
  removeButton.textContent = "×";
  removeButton.addEventListener("click", onRemove);
  previewEl.appendChild(removeButton);
}

/**
 * Wires drag-and-drop onto `wrapper` (the whole drop zone) and keeps
 * `previewEl` in sync with the input's currently selected file, on both a
 * native pick and a drop.
 *
 * `dragenter`/`dragleave` are counted rather than toggled 1:1, because
 * `dragleave` also fires when the pointer moves over a CHILD element (the
 * preview, or the input itself) — without counting, that would flicker
 * the dragover highlight off while the pointer is still inside the zone.
 */
export function wireFileDropZone(wrapper: HTMLElement, input: HTMLInputElement, previewEl: HTMLElement, document: Document): void {
  let dragDepth = 0;

  wrapper.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth++;
    wrapper.classList.add(DRAGOVER_CLASS);
  });
  wrapper.addEventListener("dragover", (e) => {
    // Required for `drop` to fire at all — without this, the browser treats the zone as not a valid drop target.
    e.preventDefault();
  });
  wrapper.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) wrapper.classList.remove(DRAGOVER_CLASS);
  });
  wrapper.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    wrapper.classList.remove(DRAGOVER_CLASS);
    const files = (e as DragEvent).dataTransfer?.files;
    if (!files || files.length === 0) return;
    try {
      // The one browser-sanctioned way to hand a drop's real FileList to a file input — see
      // MDN's "File drag and drop" guide. Only a genuine FileList is accepted here (the
      // browser throws otherwise, which is also what jsdom's test environment does — it has
      // no real DataTransfer/FileList to hand a drop event at all, so a synthetic drop in a
      // test can exercise the dragover-state handling above but not this assignment itself).
      input.files = files;
    } catch {
      return;
    }
    // A programmatic assignment doesn't fire `change` on its own — dispatch it manually to feed
    // both this module's preview and renderForm's own `.files?.[0]` read.
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  input.addEventListener("change", () => {
    renderFilePreview(previewEl, input.files?.[0], document, () => {
      input.value = "";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}
