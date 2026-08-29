/**
 * A small reusable modal confirmation dialog with custom button labels —
 * shared across every "ask before doing something consequential" moment in
 * the app (currently: /builder's save-review diff, and /form's
 * draft-preview "run post-submission actions?" gate). Deliberately a plain
 * TS/DOM module, not an Astro component — this whole app is static-output
 * (no SSR), so anything whose content depends on runtime state (which is
 * every real use of a confirm dialog) has to be built by client JS anyway;
 * an .astro file can't help here. See CLAUDE.md's "Form Config Builder"
 * section for the fuller reasoning.
 */

export interface DialogOption {
  label: string;
  value: string;
  /** Visually emphasized (e.g. the "do the real thing" choice) — purely cosmetic, doesn't change behavior. */
  primary?: boolean;
}

export interface ConfirmDialogOptions {
  title: string;
  /** Plain text body, or a pre-built element (e.g. a diff view) for richer content. */
  body: string | HTMLElement;
  options: DialogOption[];
}

/**
 * Shows the dialog and resolves with the `value` of whichever option the
 * user clicked. There's no "dismiss without choosing" — every option array
 * should include an explicit cancel-shaped choice if that's a valid outcome
 * (matches how every caller of this function is written).
 */
export function showConfirmDialog(document: Document, opts: ConfirmDialogOptions): Promise<string> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "skye-dialog-overlay";

    const dialog = document.createElement("div");
    dialog.className = "skye-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");

    const heading = document.createElement("h2");
    heading.textContent = opts.title;
    dialog.appendChild(heading);

    const bodyEl = document.createElement("div");
    bodyEl.className = "skye-dialog__body";
    if (typeof opts.body === "string") bodyEl.textContent = opts.body;
    else bodyEl.appendChild(opts.body);
    dialog.appendChild(bodyEl);

    const actions = document.createElement("div");
    actions.className = "skye-dialog__actions";
    for (const option of opts.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      if (option.primary) button.className = "skye-dialog__primary";
      button.addEventListener("click", () => {
        overlay.remove();
        resolve(option.value);
      });
      actions.appendChild(button);
    }
    dialog.appendChild(actions);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    (actions.querySelector("button") as HTMLButtonElement | null)?.focus();
  });
}
