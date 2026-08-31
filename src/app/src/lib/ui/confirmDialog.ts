/**
 * Drives the shared modal confirm dialog (components/ConfirmDialog.astro)
 * — "ask before doing something consequential" moments: /builder's
 * save-review diff and publish confirm, /form's draft-preview "run
 * post-submission actions?" gate, /switcher's "set up SKYE?" confirm.
 *
 * The markup is now a native `<dialog>` authored in the `.astro`
 * component; this module fills it in, opens it, and resolves with the
 * clicked option's `value`. Modern browsers give the backdrop, Esc and
 * focus handling from the platform. Dismissing without a button (Esc, or a
 * programmatic close) resolves with `""`, which every caller treats as
 * "cancel" — each checks for its explicit affirmative value.
 *
 * `showModal()`/`close()` are feature-detected: jsdom < 26 parses
 * `<dialog>` but implements none of its methods, so a minimal
 * open-attribute + `close` event emulation keeps the unit tests (and any
 * other non-browser environment) working. Real browsers always take the
 * native path.
 */
import { CONFIRM_DIALOG } from "./domHooks.js";

export interface DialogOption {
  label: string;
  value: string;
  /** Visually emphasized (e.g. the "do the real thing" choice) — purely cosmetic. */
  primary?: boolean;
}

export interface ConfirmDialogOptions {
  title: string;
  /** Plain text body, or a pre-built element (e.g. a diff view) for richer content. */
  body: string | HTMLElement;
  options: DialogOption[];
}

function requireDialog(doc: Document): HTMLDialogElement {
  const dialog = doc.getElementById(CONFIRM_DIALOG.id) as HTMLDialogElement | null;
  if (!dialog) {
    throw new Error(
      `showConfirmDialog: no <dialog id="${CONFIRM_DIALOG.id}"> on the page — include <ConfirmDialog /> in the .astro page.`
    );
  }
  return dialog;
}

function slot(dialog: HTMLDialogElement, name: string): HTMLElement {
  const el = dialog.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  if (!el) throw new Error(`showConfirmDialog: dialog is missing [data-slot="${name}"].`);
  return el;
}

function openDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    if (dialog.open) dialog.close();
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeDialog(dialog: HTMLDialogElement, value: string): void {
  try {
    dialog.returnValue = value;
  } catch {
    /* returnValue not implemented (old jsdom) — the promise tracks the value itself */
  }
  if (typeof dialog.close === "function") {
    dialog.close(value);
  } else {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  }
}

/**
 * Shows the dialog and resolves with the `value` of whichever option the
 * user picked (or `""` if dismissed). There is no separate "dismiss"
 * result — every `options` array should include an explicit cancel-shaped
 * choice, matching how every caller is written.
 */
export function showConfirmDialog(doc: Document, opts: ConfirmDialogOptions): Promise<string> {
  const dialog = requireDialog(doc);
  const titleEl = slot(dialog, CONFIRM_DIALOG.slotTitle);
  const bodyEl = slot(dialog, CONFIRM_DIALOG.slotBody);
  const actionsEl = slot(dialog, CONFIRM_DIALOG.slotActions);
  const actionTpl = doc.getElementById(CONFIRM_DIALOG.actionTemplateId) as HTMLTemplateElement | null;
  if (!actionTpl) throw new Error(`showConfirmDialog: no <template id="${CONFIRM_DIALOG.actionTemplateId}"> on the page.`);

  titleEl.textContent = opts.title;

  bodyEl.replaceChildren();
  if (typeof opts.body === "string") bodyEl.textContent = opts.body;
  else bodyEl.appendChild(opts.body);

  return new Promise<string>((resolve) => {
    let picked: string | undefined;

    const onClose = (): void => {
      dialog.removeEventListener("close", onClose);
      resolve(picked ?? "");
    };
    dialog.addEventListener("close", onClose);

    actionsEl.replaceChildren();
    for (const option of opts.options) {
      const li = doc.createElement("li");
      const button = actionTpl.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
      button.textContent = option.label;
      button.value = option.value;
      button.classList.toggle("skye-dialog__primary", Boolean(option.primary));
      button.addEventListener("click", () => {
        picked = option.value;
        closeDialog(dialog, option.value);
      });
      li.appendChild(button);
      actionsEl.appendChild(li);
    }

    openDialog(dialog);
    (actionsEl.querySelector("button") as HTMLButtonElement | null)?.focus();
  });
}
