import { describe, it, expect } from "vitest";
import { formatFileSize, looksLikeImageUrl, renderFilePreview, wireFileDropZone } from "../features/form/render/fileUploadZone.js";

describe("looksLikeImageUrl", () => {
  it("recognizes common image extensions, case-insensitively", () => {
    expect(looksLikeImageUrl("https://contoso.sharepoint.com/sites/x/Poster.PNG")).toBe(true);
    expect(looksLikeImageUrl("https://contoso.sharepoint.com/sites/x/photo.jpeg")).toBe(true);
  });

  it("returns false for a non-image extension", () => {
    expect(looksLikeImageUrl("https://contoso.sharepoint.com/sites/x/report.pdf")).toBe(false);
  });

  it("ignores a query string when checking the extension", () => {
    expect(looksLikeImageUrl("https://contoso.sharepoint.com/sites/x/poster.png?version=3")).toBe(true);
  });
});

describe("formatFileSize", () => {
  it("formats bytes under 1024 as-is", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("formats kilobytes and megabytes", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5 MB");
  });
});

describe("renderFilePreview", () => {
  it("hides and clears the preview when there's no file", () => {
    const previewEl = document.createElement("div");
    previewEl.innerHTML = "<span>stale</span>";
    renderFilePreview(previewEl, undefined, document, () => {});
    expect(previewEl.hidden).toBe(true);
    expect(previewEl.innerHTML).toBe("");
  });

  it("shows a generic icon plus name/size for a non-image file", () => {
    const previewEl = document.createElement("div");
    const file = new File(["hello world"], "notes.txt", { type: "text/plain" });
    renderFilePreview(previewEl, file, document, () => {});
    expect(previewEl.hidden).toBe(false);
    expect(previewEl.querySelector("img")).toBeNull();
    expect(previewEl.querySelector(".skye-file-upload__icon")).not.toBeNull();
    expect(previewEl.querySelector(".skye-file-upload__name")?.textContent).toBe("notes.txt");
    expect(previewEl.querySelector(".skye-file-upload__size")?.textContent).toBe("11 B");
  });

  it("shows an <img> thumbnail (via an object URL) for an image file", () => {
    const previewEl = document.createElement("div");
    const file = new File(["fake-png-bytes"], "poster.png", { type: "image/png" });
    renderFilePreview(previewEl, file, document, () => {});
    const img = previewEl.querySelector<HTMLImageElement>("img.skye-file-upload__thumb");
    expect(img).not.toBeNull();
    expect(img!.src).toBe(previewEl.dataset.objectUrl);
  });

  it("revokes the previous object URL when swapping to a new image", () => {
    const previewEl = document.createElement("div");
    renderFilePreview(previewEl, new File(["a"], "one.png", { type: "image/png" }), document, () => {});
    const firstUrl = previewEl.dataset.objectUrl;
    renderFilePreview(previewEl, new File(["b"], "two.png", { type: "image/png" }), document, () => {});
    expect(previewEl.dataset.objectUrl).not.toBe(firstUrl);
  });

  it("wires the remove button to the given callback", () => {
    const previewEl = document.createElement("div");
    let removed = false;
    renderFilePreview(previewEl, new File(["a"], "a.txt", { type: "text/plain" }), document, () => {
      removed = true;
    });
    previewEl.querySelector<HTMLButtonElement>(".skye-file-upload__remove")!.click();
    expect(removed).toBe(true);
  });

  describe("a saved URL string (edit/view-mode prefill, no File instance available)", () => {
    it("shows an <img> thumbnail sourced directly from the URL, with no object URL and no size", () => {
      const previewEl = document.createElement("div");
      renderFilePreview(previewEl, "https://contoso.sharepoint.com/sites/luddy/PHOTOS!/Spring%20Fair%20Poster.png", document, () => {});
      const img = previewEl.querySelector<HTMLImageElement>("img.skye-file-upload__thumb");
      expect(img).not.toBeNull();
      expect(img!.src).toBe("https://contoso.sharepoint.com/sites/luddy/PHOTOS!/Spring%20Fair%20Poster.png");
      expect(previewEl.dataset.objectUrl).toBeUndefined();
      expect(previewEl.querySelector(".skye-file-upload__name")?.textContent).toBe("Spring Fair Poster.png");
      expect(previewEl.querySelector(".skye-file-upload__size")).toBeNull();
    });

    it("shows a generic icon for a URL that doesn't look like an image", () => {
      const previewEl = document.createElement("div");
      renderFilePreview(previewEl, "https://contoso.sharepoint.com/sites/luddy/report.pdf", document, () => {});
      expect(previewEl.querySelector("img")).toBeNull();
      expect(previewEl.querySelector(".skye-file-upload__icon")).not.toBeNull();
      expect(previewEl.querySelector(".skye-file-upload__name")?.textContent).toBe("report.pdf");
    });

    it("still wires the remove button", () => {
      const previewEl = document.createElement("div");
      let removed = false;
      renderFilePreview(previewEl, "https://contoso.sharepoint.com/sites/luddy/x.png", document, () => {
        removed = true;
      });
      previewEl.querySelector<HTMLButtonElement>(".skye-file-upload__remove")!.click();
      expect(removed).toBe(true);
    });
  });

  describe("a blob URL with an explicit { name, isImage } override (a fetched-via-Graph preview)", () => {
    it("uses the override's name/isImage instead of deriving either from the (extensionless) blob URL itself", () => {
      const previewEl = document.createElement("div");
      renderFilePreview(previewEl, "blob:http://localhost/ade1fb08-886b-4f3f-8079-81a1e8ec0000", document, () => {}, {
        name: "poster.png",
        isImage: true,
      });
      const img = previewEl.querySelector<HTMLImageElement>("img.skye-file-upload__thumb");
      expect(img).not.toBeNull();
      expect(img!.src).toBe("blob:http://localhost/ade1fb08-886b-4f3f-8079-81a1e8ec0000");
      expect(previewEl.querySelector(".skye-file-upload__name")?.textContent).toBe("poster.png");
      // Not created by renderFilePreview itself (the caller already made this blob URL and owns
      // its lifecycle) — so it must not be tracked for auto-revocation on the next render.
      expect(previewEl.dataset.objectUrl).toBeUndefined();
    });

    it("without an override, a blob URL (no recognizable extension) falls back to the generic icon — this is exactly the bug an override fixes", () => {
      const previewEl = document.createElement("div");
      renderFilePreview(previewEl, "blob:http://localhost/ade1fb08-886b-4f3f-8079-81a1e8ec0000", document, () => {});
      expect(previewEl.querySelector("img")).toBeNull();
      expect(previewEl.querySelector(".skye-file-upload__icon")).not.toBeNull();
    });
  });
});

describe("wireFileDropZone", () => {
  function setup() {
    const wrapper = document.createElement("div");
    const input = document.createElement("input");
    input.type = "file";
    const previewEl = document.createElement("div");
    previewEl.hidden = true;
    wrapper.append(input, previewEl);
    wireFileDropZone(wrapper, input, previewEl, document);
    return { wrapper, input, previewEl };
  }

  it("adds a dragover-highlight class on dragenter and removes it once every dragleave balances out", () => {
    const { wrapper } = setup();
    wrapper.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
    wrapper.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true })); // e.g. moving over a child element
    expect(wrapper.classList.contains("skye-file-upload--dragover")).toBe(true);

    wrapper.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }));
    expect(wrapper.classList.contains("skye-file-upload--dragover")).toBe(true); // still one enter unmatched

    wrapper.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }));
    expect(wrapper.classList.contains("skye-file-upload--dragover")).toBe(false);
  });

  it("clears the dragover-highlight class on drop, even when the environment can't hand it a real FileList", () => {
    // jsdom has no DataTransfer/FileList implementation at all, so a synthetic drop here can't
    // exercise the real `input.files = event.dataTransfer.files` assignment (that line is
    // standard, documented cross-browser behavior — see fileUploadZone.ts's own comment) — but
    // the drop handler must still degrade gracefully rather than throwing.
    const { wrapper } = setup();
    wrapper.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { files: [new File(["x"], "a.txt")] } });
    expect(() => wrapper.dispatchEvent(dropEvent)).not.toThrow();
    expect(wrapper.classList.contains("skye-file-upload--dragover")).toBe(false);
  });

  it("renders the preview once the input's own change event fires (a native pick)", () => {
    const { input, previewEl } = setup();
    const file = new File(["hi"], "hi.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(previewEl.hidden).toBe(false);
    expect(previewEl.querySelector(".skye-file-upload__name")?.textContent).toBe("hi.txt");
  });

  it("clears the input's value and re-dispatches change when the preview's remove button is clicked", () => {
    // jsdom's `.files` getter can only be simulated via Object.defineProperty (a plain assignment
    // is rejected unless it's a real FileList — confirmed directly against jsdom 30), which
    // permanently shadows that property for the rest of this test and decouples it from
    // `.value`'s real clearing behavior. So this asserts the two genuinely-observable effects of
    // clicking remove — `input.value` is reset, and `change` fires again — rather than the
    // downstream preview-clearing, which the earlier "hides and clears" test already covers
    // directly against `renderFilePreview`.
    const { input, previewEl } = setup();
    const file = new File(["hi"], "hi.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));

    let changeCount = 0;
    input.addEventListener("change", () => changeCount++);
    previewEl.querySelector<HTMLButtonElement>(".skye-file-upload__remove")!.click();
    expect(input.value).toBe("");
    expect(changeCount).toBe(1);
  });
});
