import type { FieldConfig } from "@skye/form-config";

export type ValueAccessor = "value" | "checked" | "none";

export interface ControlDefinition {
  /** The tag to create — a native HTML tag ("input", "select", ...) or a registered custom element ("skye-people-picker", ...). */
  tag: string;
  /**
   * Maps the field config to the native/custom-element attributes to apply
   * via applyAttributes. Kept separate from attribute *application* so this
   * stays a pure, easily-testable function.
   */
  mapAttributes: (field: FieldConfig) => Record<string, unknown>;
  /**
   * For controls with structural children (select/option, radio groups,
   * checkbox groups) — builds those child elements. Absent for controls
   * with no children.
   */
  buildChildren?: (field: FieldConfig, document: Document) => HTMLElement[];
  /** How renderField reads/writes this control's current value for validation and form state. "none" for content-only controls (heading/paragraph/divider). */
  valueAccessor: ValueAccessor;
  /** DOM events that mean "the value changed" for this control. */
  changeEvents: string[];
  /**
   * For custom elements needing structured config that can't be expressed
   * as a plain HTML attribute (lookupPicker's `relatedList`, lookupTable's
   * `table`) — called once right after the element is created, before it's
   * attached to the DOM's connectedCallback fires.
   */
  configureElement?: (el: HTMLElement, field: FieldConfig) => void;
}

/** Shared attribute mapping for the handful of properties nearly every native input-like control accepts identically. */
function commonInputAttributes(field: FieldConfig): Record<string, unknown> {
  return {
    required: field.required,
    readonly: field.readonly,
    ...field.attributes,
  };
}

function optionElement(document: Document, value: unknown, label?: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = String(value);
  option.textContent = label ?? String(value);
  return option;
}

/**
 * A `<select>`'s first option is selected by default the instant it renders, with no user
 * action — without this, a field with no `defaultValue` would silently submit whatever its
 * first real option happens to be, never having actually been "filled in". Disabled so it
 * can't be re-selected once left, and its empty value fails native `required` validation
 * until a real option is chosen — the same contract a required `<input>` already has. A
 * `defaultValue`, if set, still wins: renderField.ts sets `.value` directly after this,
 * which deselects this placeholder in favor of the matching real option.
 */
function selectPlaceholderOption(document: Document): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Select an option…";
  option.disabled = true;
  option.selected = true;
  return option;
}

/** Builds a labeled radio or checkbox group inside a <fieldset> — the one case where a single field key maps to several real inputs, matching how the schema's `radio`/`checkboxGroup` controlTypes are described. */
function buildChoiceGroup(inputType: "radio" | "checkbox") {
  return (field: FieldConfig, document: Document): HTMLElement[] => {
    return (field.options ?? []).map((opt) => {
      const wrapper = document.createElement("label");
      const input = document.createElement("input");
      input.type = inputType;
      input.name = field.bindTo ?? "";
      input.value = String(opt.value);
      wrapper.appendChild(input);
      wrapper.append(opt.label ?? String(opt.value));
      return wrapper;
    });
  };
}

export const fieldRegistry: Record<string, ControlDefinition> = {
  // --- Native controls: controlType matches the real HTML input type ---
  text: {
    tag: "input",
    mapAttributes: (f) => ({ type: "text", ...commonInputAttributes(f), minlength: f.minlength, maxlength: f.maxlength, pattern: f.pattern }),
    valueAccessor: "value",
    changeEvents: ["input"],
  },
  textarea: {
    tag: "textarea",
    mapAttributes: (f) => ({ ...commonInputAttributes(f), minlength: f.minlength, maxlength: f.maxlength }),
    valueAccessor: "value",
    changeEvents: ["input"],
  },
  number: {
    tag: "input",
    mapAttributes: (f) => ({ type: "number", ...commonInputAttributes(f), min: f.min, max: f.max }),
    valueAccessor: "value",
    changeEvents: ["input"],
  },
  currency: {
    tag: "input",
    mapAttributes: (f) => ({ type: "number", inputmode: "decimal", step: "0.01", ...commonInputAttributes(f), min: f.min, max: f.max }),
    valueAccessor: "value",
    changeEvents: ["input"],
  },
  date: {
    tag: "input",
    mapAttributes: (f) => ({ type: "date", ...commonInputAttributes(f), min: f.min, max: f.max }),
    valueAccessor: "value",
    changeEvents: ["change"],
  },
  "datetime-local": {
    tag: "input",
    mapAttributes: (f) => ({ type: "datetime-local", ...commonInputAttributes(f), min: f.min, max: f.max }),
    valueAccessor: "value",
    changeEvents: ["change"],
  },
  url: {
    tag: "input",
    mapAttributes: (f) => ({ type: "url", ...commonInputAttributes(f), pattern: f.pattern }),
    valueAccessor: "value",
    changeEvents: ["input"],
  },
  file: {
    tag: "input",
    mapAttributes: (f) => ({ type: "file", ...commonInputAttributes(f) }),
    valueAccessor: "none", // file inputs are handled specially by the submit pipeline, not the generic value accessor
    changeEvents: ["change"],
  },
  hidden: {
    tag: "input",
    mapAttributes: (f) => ({ type: "hidden", value: f.defaultValue }),
    valueAccessor: "value",
    changeEvents: [],
  },
  checkbox: {
    tag: "input",
    mapAttributes: (f) => ({ type: "checkbox", ...commonInputAttributes(f), class: f.appearance === "switch" ? "skye-switch" : undefined }),
    valueAccessor: "checked",
    changeEvents: ["change"],
  },

  // --- Native controls with structural children ---
  select: {
    tag: "select",
    mapAttributes: (f) => commonInputAttributes(f),
    buildChildren: (f, document) => [selectPlaceholderOption(document), ...(f.options ?? []).map((opt) => optionElement(document, opt.value, opt.label))],
    valueAccessor: "value",
    changeEvents: ["change"],
  },
  radio: {
    tag: "fieldset",
    mapAttributes: () => ({}),
    buildChildren: buildChoiceGroup("radio"),
    // The <fieldset> itself has no `.value`; renderForm's readControlValue/writeControlValue
    // special-case an HTMLFieldSetElement and read/write the checked radio's value.
    valueAccessor: "value",
    changeEvents: ["change"],
  },
  checkboxGroup: {
    // A dropdown-style multi-select (see registerElements.ts's SkyeMultiSelect) rather than an
    // always-expanded column of checkboxes. Options come from the field's `options` (filled from
    // the bound SharePoint Choice column), threaded in via configureElement.
    tag: "skye-multi-select",
    mapAttributes: (f) => commonInputAttributes(f),
    configureElement: (el, f) => {
      (el as unknown as { options?: FieldConfig["options"] }).options = f.options ?? [];
    },
    valueAccessor: "value",
    changeEvents: ["skye-change"],
  },

  // --- Content-only virtual controls ---
  heading: { tag: "h3", mapAttributes: () => ({}), valueAccessor: "none", changeEvents: [] },
  paragraph: { tag: "p", mapAttributes: () => ({}), valueAccessor: "none", changeEvents: [] },
  divider: { tag: "hr", mapAttributes: () => ({}), valueAccessor: "none", changeEvents: [] },

  // --- Non-native controls: Web Components (see packages/app/src/elements) ---
  richtext: {
    tag: "skye-richtext",
    mapAttributes: (f) => commonInputAttributes(f),
    valueAccessor: "value",
    changeEvents: ["skye-change"],
  },
  peoplePicker: {
    tag: "skye-people-picker",
    mapAttributes: (f) => commonInputAttributes(f),
    valueAccessor: "value",
    changeEvents: ["skye-change"],
  },
  lookupPicker: {
    tag: "skye-lookup-picker",
    mapAttributes: (f) => commonInputAttributes(f),
    configureElement: (el, f) => {
      (el as unknown as { relatedList?: FieldConfig["relatedList"] }).relatedList = f.relatedList;
    },
    valueAccessor: "value",
    changeEvents: ["skye-change"],
  },
  lookupTable: {
    tag: "skye-lookup-table",
    mapAttributes: (f) => commonInputAttributes(f),
    configureElement: (el, f) => {
      (el as unknown as { tableConfig?: FieldConfig["table"] }).tableConfig = f.table;
    },
    valueAccessor: "value",
    changeEvents: ["skye-change"],
  },
  calculatedDisplay: {
    tag: "skye-calculated-display",
    mapAttributes: (f) => commonInputAttributes(f),
    valueAccessor: "none", // derived, never user-edited or read back for validation the normal way
    changeEvents: [],
  },
  // A real <button>, not a value-bearing control — renderField.ts gives it its own bespoke
  // rendering branch (a status output alongside it, no label/help-text chrome), the same way it
  // already special-cases heading/paragraph/divider, so this entry mainly exists for registry
  // completeness (getControlDefinition, schema introspection) rather than being built generically
  // from mapAttributes/configureElement the way most controls are.
  button: {
    tag: "button",
    // Deliberately doesn't read `f.readonly` — view mode forces every OTHER field's `readonly`
    // to protect a value from being changed, which has no meaning for a button (nothing on it to
    // protect). A button's whole point can be a "quick action" a viewer takes without switching
    // to edit mode (e.g. an approver clicking "Approve" while just viewing an item) — see
    // page-scripts/form.ts, which deliberately excludes controlType "button" from its own
    // view-mode readonly-forcing loop for the same reason.
    mapAttributes: () => ({ type: "button" }),
    valueAccessor: "none",
    changeEvents: [],
  },
};

/** Looks up a control definition, throwing a clear error for an unknown controlType rather than silently rendering nothing. */
export function getControlDefinition(controlType: string): ControlDefinition {
  const def = fieldRegistry[controlType];
  if (!def) throw new Error(`No control definition registered for controlType "${controlType}".`);
  return def;
}
