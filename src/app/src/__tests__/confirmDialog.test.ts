import { describe, it, expect } from "vitest";
import { showConfirmDialog } from "../lib/ui/confirmDialog.js";

describe("showConfirmDialog", () => {
  it("renders the title, body, and one button per option, resolving with the clicked option's value", async () => {
    const promise = showConfirmDialog(document, {
      title: "Run post-submission actions?",
      body: "This is a Form Preview.",
      options: [
        { label: "Don't Run Actions", value: "skip" },
        { label: "Run Actions", value: "run", primary: true },
      ],
    });

    const dialog = document.querySelector(".skye-dialog")!;
    expect(dialog.querySelector("h2")?.textContent).toBe("Run post-submission actions?");
    expect(dialog.querySelector(".skye-dialog__body")?.textContent).toBe("This is a Form Preview.");
    const buttons = Array.from(dialog.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Don't Run Actions", "Run Actions"]);

    buttons[1].click();
    await expect(promise).resolves.toBe("run");
    expect(document.querySelector(".skye-dialog-overlay")).toBeNull();
  });

  it("accepts a pre-built element as the body (e.g. a diff view)", async () => {
    const bodyEl = document.createElement("div");
    bodyEl.textContent = "custom body content";
    const promise = showConfirmDialog(document, { title: "Review changes", body: bodyEl, options: [{ label: "OK", value: "ok" }] });
    expect(document.querySelector(".skye-dialog__body")?.textContent).toBe("custom body content");
    document.querySelector("button")!.click();
    await expect(promise).resolves.toBe("ok");
  });
});
