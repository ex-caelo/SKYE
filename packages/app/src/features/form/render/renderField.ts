import type { FieldConfig } from "@skye/form-config";
import { getControlDefinition } from "./fieldRegistry.js";
import { applyAttributes, applyStyle } from "./applyAttributes.js";
import { humanizeFieldKey } from "./fieldLabels.js";
import { wireFileDropZone } from "./fileUploadZone.js";

export interface RenderedField {
  /** The wrapping element placed into the page's grid — this is what layoutEngine assigns a grid-area to. */
  container: HTMLElement;
  /** The actual input/select/custom-element control, for attaching listeners and reading/writing values. */
  control: HTMLElement;
  /** Where a validation message is shown — populated by the validation layer, not by renderField itself. */
  messageEl: HTMLElement;
  /**
   * Only present for `controlType: "file"` — the preview slot fileUploadZone.ts's
   * `renderFilePreview` renders into. A file input's own value can't be seeded
   * programmatically (browsers don't allow it), so renderForm.ts uses this directly to show an
   * edit-mode field's already-saved value (a URL string, not a File) as a preview instead.
   */
  filePreviewEl?: HTMLElement;
  /**
   * Only present for `controlType: "button"` — an `<output>` renderForm.ts's button-click wiring
   * (see runButtonActions.ts's caller in page-scripts/form.ts) writes this button's own
   * success/error/progress messages into, kept separate from other fields' validation messages
   * and the form's shared submit-status line so multiple buttons never stomp on each other.
   */
  buttonStatusEl?: HTMLElement;
}

/**
 * Renders one field's markup. Content-only controls (heading/paragraph/divider)
 * skip the label/help/validation chrome entirely, since they're not real
 * inputs — see fieldRegistry's valueAccessor: "none" for the same set.
 */
export function renderField(fieldKey: string, field: FieldConfig, document: Document): RenderedField {
  const def = getControlDefinition(field.controlType);
  const control = document.createElement(def.tag);
  control.dataset.fieldKey = fieldKey;

  def.configureElement?.(control, field);
  applyAttributes(control, def.mapAttributes(field));
  applyStyle(control, field.style);

  if (def.buildChildren) {
    for (const child of def.buildChildren(field, document)) control.appendChild(child);
  }

  if (field.defaultValue !== undefined && "value" in control) {
    (control as HTMLInputElement).value = String(field.defaultValue);
  }

  const isContentOnly = def.valueAccessor === "none" && ["heading", "paragraph", "divider"].includes(field.controlType);
  if (isContentOnly) {
    control.textContent = field.label ?? "";
    const container = document.createElement("div");
    container.className = "skye-field skye-field--content";
    container.style.gridArea = fieldKey;
    container.appendChild(control);
    return { container, control, messageEl: document.createElement("span") };
  }

  // A button isn't a value-bearing input (no label-for/help-text/validation-message chrome it
  // needs), but it isn't purely content-only either — it needs its own click-feedback slot
  // (buttonStatusEl), which none of the controls above need. Its own text IS its label.
  if (field.controlType === "button") {
    control.id = fieldKey;
    control.textContent = field.label ?? "";

    const container = document.createElement("div");
    container.className = "skye-field skye-field--button";
    container.style.gridArea = fieldKey;
    container.appendChild(control);

    if (field.helpText) {
      const help = document.createElement("div");
      help.className = "skye-field__help";
      help.textContent = field.helpText;
      container.appendChild(help);
    }

    const buttonStatusEl = document.createElement("output");
    buttonStatusEl.className = "skye-field__button-status";
    container.appendChild(buttonStatusEl);

    return { container, control, messageEl: document.createElement("span"), buttonStatusEl };
  }

  const container = document.createElement("div");
  container.className = "skye-field";
  container.style.gridArea = fieldKey;
  // A file field is styled as a tall drop zone that fills its (often row-spanning) grid cell — see form.css.
  if (field.controlType === "file") container.classList.add("skye-field--file");

  // Every field control is identifiable AND labelled:
  //  - `id` (for the label association) + `name` (form-field semantics; the bound SharePoint
  //    column name, falling back to the field key) on the control itself;
  //  - an associated <label for> — or a <legend> for the <fieldset>-based group controls, where
  //    `<label for>` doesn't associate — with the config's `label`, falling back to a humanised
  //    field key so a config that omits `label` still renders an accessible field.
  // Only `radio` still renders as a <fieldset> of inputs needing a <legend>; `checkboxGroup` is now
  // the skye-multi-select custom element, which takes a normal <label for> like any other control.
  const isGroup = field.controlType === "radio";
  const isHidden = field.controlType === "hidden";
  const labelText = field.label ?? humanizeFieldKey(fieldKey);

  control.id = fieldKey;
  if (!control.getAttribute("name")) control.setAttribute("name", field.bindTo || fieldKey);

  if (isGroup) {
    const legend = document.createElement("legend");
    legend.textContent = labelText;
    control.insertBefore(legend, control.firstChild); // `control` is the <fieldset>; put the label before its options
    // The inner radio/checkbox inputs need a shared, non-empty `name` to behave as one group.
    Array.from(control.querySelectorAll("input")).forEach((input) => {
      if (!input.getAttribute("name")) input.setAttribute("name", field.bindTo || fieldKey);
    });
  } else if (!isHidden) {
    const label = document.createElement("label");
    label.textContent = labelText;
    label.htmlFor = fieldKey;
    container.appendChild(label);
  }

  if (field.subtitle) {
    const subtitle = document.createElement("div");
    subtitle.className = "skye-field__subtitle";
    subtitle.textContent = field.subtitle;
    container.appendChild(subtitle);
  }

  // Only set for controlType "file" — see RenderedField.filePreviewEl.
  let filePreviewEl: HTMLElement | undefined;

  if (field.controlType === "file") {
    // A drag-and-drop zone wrapping the real input, plus a small preview (thumbnail for an
    // image, filename/size otherwise) that appears once a file's picked — see fileUploadZone.ts.
    // The input itself stays exactly what renderForm.ts already reads `.files?.[0]` from.
    const dropZone = document.createElement("div");
    dropZone.className = "skye-file-upload";
    dropZone.appendChild(control);

    filePreviewEl = document.createElement("div");
    filePreviewEl.className = "skye-file-upload__preview";
    filePreviewEl.hidden = true;
    dropZone.appendChild(filePreviewEl);

    container.appendChild(dropZone);
    wireFileDropZone(dropZone, control as HTMLInputElement, filePreviewEl, document);
  } else {
    container.appendChild(control);
  }

  if (field.helpText) {
    const help = document.createElement("div");
    help.className = "skye-field__help";
    help.textContent = field.helpText;
    container.appendChild(help);
  }

  const messageEl = document.createElement("div");
  messageEl.className = "skye-field__message";
  messageEl.setAttribute("role", "alert");
  messageEl.id = `${fieldKey}-message`;
  container.appendChild(messageEl);
  // Always associated (even while empty) rather than toggled per validation pass — an empty,
  // hidden-by-content live region is harmless, and this keeps renderForm's validation layer from
  // needing to touch this attribute at all.
  control.setAttribute("aria-describedby", messageEl.id);

  return { container, control, messageEl, filePreviewEl };
}
