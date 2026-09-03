import { describe, it, expect, afterEach } from "vitest";
import { showConfirmDialog } from "../shared/ui/confirmDialog.js";
import { mountComponents } from "./helpers/astroFixture.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("showConfirmDialog", () => {
  it("fills the native <dialog>, shows one button per option, resolves with the clicked value, and closes", async () => {
    mountComponents("ConfirmDialog");
    const promise = showConfirmDialog(document, {
      title: "Run post-submission actions?",
      body: "This is a Form Preview.",
      options: [
        { label: "Don't Run Actions", value: "skip" },
        { label: "Run Actions", value: "run", primary: true },
      ],
    });

    const dialog = document.querySelector("dialog.skye-dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector(".skye-dialog__heading")?.textContent).toBe("Run post-submission actions?");
    expect(dialog.querySelector(".skye-dialog__body")?.textContent).toBe("This is a Form Preview.");
    const buttons = Array.from(dialog.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Don't Run Actions", "Run Actions"]);
    expect(buttons[1].classList.contains("skye-dialog__primary")).toBe(true);
    expect(buttons[0].classList.contains("skye-dialog__primary")).toBe(false);

    buttons[1].click();
    await expect(promise).resolves.toBe("run");
    expect(dialog.open).toBe(false);
  });

  it("accepts a pre-built element as the body (e.g. a diff view)", async () => {
    mountComponents("ConfirmDialog");
    const bodyEl = document.createElement("div");
    bodyEl.textContent = "custom body content";
    const promise = showConfirmDialog(document, {
      title: "Review changes",
      body: bodyEl,
      options: [{ label: "OK", value: "ok" }],
    });
    expect(document.querySelector(".skye-dialog__body")?.textContent).toBe("custom body content");
    (document.querySelector(".skye-dialog__actions button") as HTMLButtonElement).click();
    await expect(promise).resolves.toBe("ok");
  });

  it('resolves with "" when the dialog is dismissed without a button (Esc / native close)', async () => {
    mountComponents("ConfirmDialog");
    const promise = showConfirmDialog(document, { title: "t", body: "b", options: [{ label: "Cancel", value: "cancel" }] });
    // A native Esc dismiss fires a `close` event with no button having been clicked.
    (document.querySelector("dialog.skye-dialog") as HTMLDialogElement).dispatchEvent(new Event("close"));
    await expect(promise).resolves.toBe("");
  });
});
