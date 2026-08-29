import type { FieldConfig } from "@skye/config";
import { getControlDefinition } from "./fieldRegistry.js";
import { applyAttributes, applyStyle } from "./applyAttributes.js";

export interface RenderedField {
  /** The wrapping element placed into the page's grid — this is what layoutEngine assigns a grid-area to. */
  container: HTMLElement;
  /** The actual input/select/custom-element control, for attaching listeners and reading/writing values. */
  control: HTMLElement;
  /** Where a validation message is shown — populated by the validation layer, not by renderField itself. */
  messageEl: HTMLElement;
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

  const container = document.createElement("div");
  container.className = "skye-field";
  container.style.gridArea = fieldKey;

  if (field.label) {
    const label = document.createElement("label");
    label.textContent = field.label;
    label.htmlFor = fieldKey;
    control.id = fieldKey;
    container.appendChild(label);
  }
  if (field.subtitle) {
    const subtitle = document.createElement("div");
    subtitle.className = "skye-field__subtitle";
    subtitle.textContent = field.subtitle;
    container.appendChild(subtitle);
  }

  container.appendChild(control);

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

  return { container, control, messageEl };
}
