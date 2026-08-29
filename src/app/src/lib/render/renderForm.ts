import type { FormConfig, FieldValues, CustomValidatorFn } from "@skye/config";
import { evaluateCondition, evaluateCalculatedExpression } from "@skye/config";
import { renderField, type RenderedField } from "./renderField.js";
import { getControlDefinition } from "./fieldRegistry.js";
import { applyPageLayout } from "./layoutEngine.js";
import { validateFormValues } from "../validation/validateFormValues.js";

export interface RenderedForm {
  root: HTMLElement;
  getValues: () => FieldValues;
  setFieldValue: (key: string, value: unknown) => void;
  /** Registers a listener fired on every field change, after visibility has been recomputed. */
  onChange: (cb: (values: FieldValues) => void) => void;
  /** The submit button — entry-form.ts (or whatever's orchestrating submission) attaches its own click handler; renderForm doesn't know about Graph/postActions. */
  submitButton: HTMLButtonElement;
  /** Switches the active page tab — exposed so a caller that rebuilds this form from scratch (e.g. /builder's live preview) can restore whichever page was showing before the rebuild, instead of always resetting to the first one. */
  showPage: (pageKey: string) => void;
  /** The currently active page's key, if any pages exist. */
  getActivePageKey: () => string | undefined;
  /**
   * Marks every applicable field "touched" (revealing any current error
   * even for a field the user never interacted with — the same thing a
   * real `<form>`'s submit attempt does for native `:user-invalid`),
   * updates every field's inline message/invalid state, and returns
   * whether the form is currently valid. Every submit path (live
   * create/edit, draft-preview) calls this before proceeding — see
   * entry-form.ts.
   */
  validateAll: () => boolean;
}

export interface RenderFormOptions {
  /** Which page to show initially, if it names a real page on this form — falls back to the first page (by `order`) otherwise, same as before this option existed. */
  initialPageKey?: string;
  /**
   * The app's real customValidators registry (src/validation/customValidators.ts)
   * — threaded through so this one shared validation layer can run BOTH
   * native constraints and custom validators identically everywhere a
   * form renders (live /form, a draft preview, /builder's own live
   * preview). Defaults to no custom validators registered, matching
   * validateFormValues.ts's own default.
   */
  customValidators?: Record<string, CustomValidatorFn>;
}

/** Reads a control's current value using the accessor its field registry entry declares. */
function readControlValue(control: HTMLElement, valueAccessor: "value" | "checked" | "none"): unknown {
  if (valueAccessor === "checked") return (control as HTMLInputElement).checked;
  if (valueAccessor === "value") return (control as HTMLInputElement | HTMLSelectElement).value;
  return undefined;
}

function writeControlValue(control: HTMLElement, valueAccessor: "value" | "checked" | "none", value: unknown): void {
  if (valueAccessor === "checked") (control as HTMLInputElement).checked = Boolean(value);
  else if (valueAccessor === "value") (control as HTMLInputElement | HTMLSelectElement).value = value === undefined || value === null ? "" : String(value);
}

/**
 * Builds the full form DOM from an already-merged FormConfig (base +
 * permission overlays already applied via @skye/config's mergeConfig).
 * Handles page tabs, per-page grid layout, and visibleIf reactivity for
 * both fields and whole pages. Does NOT handle validation or submission —
 * those are separate layers that read/write through the returned API.
 */
export function renderForm(config: FormConfig, document: Document, options: RenderFormOptions = {}): RenderedForm {
  const values: FieldValues = {};
  const changeListeners: Array<(values: FieldValues) => void> = [];
  let activePageKey: string | undefined;
  // Which fields' invalid state is currently allowed to SHOW — mirrors CSS's own :user-invalid
  // semantics (an error only becomes visible once the user has interacted with that field, or
  // once a submit was attempted for the whole form), so a pristine required field never shows red
  // the instant the page loads. The underlying validation itself (validateFormValues) always runs
  // in full every time; this set only gates what's actually DISPLAYED. See validateAll/updateValidationDisplay.
  const touchedFields = new Set<string>();

  const root = document.createElement("div");
  root.className = "skye-form";

  if (config.title) {
    const heading = document.createElement("h1");
    heading.textContent = config.title;
    root.appendChild(heading);
  }
  if (config.description) {
    const desc = document.createElement("p");
    desc.className = "skye-form__description";
    desc.textContent = config.description;
    root.appendChild(desc);
  }

  const tabBar = document.createElement("div");
  tabBar.className = "skye-form__tabs";
  root.appendChild(tabBar);

  const pageEntries = Object.entries(config.pages).sort(([, a], [, b]) => (a.order ?? Infinity) - (b.order ?? Infinity));

  const pageContainers = new Map<string, HTMLElement>();
  const tabButtons = new Map<string, HTMLButtonElement>();
  const renderedFields = new Map<string, { field: (typeof config.fields)[string]; rendered: RenderedField }>();

  for (const [pageKey, page] of pageEntries) {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.textContent = page.title;
    tabButton.dataset.pageKey = pageKey;
    tabButton.addEventListener("click", () => showPage(pageKey));
    tabBar.appendChild(tabButton);
    tabButtons.set(pageKey, tabButton);

    const pageContainer = document.createElement("div");
    pageContainer.className = "skye-form__page";
    pageContainer.dataset.pageKey = pageKey;
    applyPageLayout(pageContainer, page, config.layout);
    root.appendChild(pageContainer);
    pageContainers.set(pageKey, pageContainer);
  }

  const fieldEntries = Object.entries(config.fields).sort(([, a], [, b]) => (a.order ?? Infinity) - (b.order ?? Infinity));

  for (const [fieldKey, field] of fieldEntries) {
    const pageContainer = field.page ? pageContainers.get(field.page) : undefined;
    if (!pageContainer) continue; // a field with no matching page is a config error a lint pass should catch, not something to crash the render over

    const rendered = renderField(fieldKey, field, document);
    pageContainer.appendChild(rendered.container);
    renderedFields.set(fieldKey, { field, rendered });

    if (field.defaultValue !== undefined) values[fieldKey] = field.defaultValue;

    const def = getControlDefinition(field.controlType);
    for (const eventName of def.changeEvents) {
      rendered.control.addEventListener(eventName, () => {
        if (field.controlType === "file") {
          // File inputs use valueAccessor "none" (readControlValue doesn't handle them) — capture the
          // selected File object directly; submitForm.ts's upload step looks for a File instance here.
          values[fieldKey] = (rendered.control as HTMLInputElement).files?.[0];
        } else {
          values[fieldKey] = readControlValue(rendered.control, def.valueAccessor);
        }
        recomputeVisibility();
        recomputeCalculatedFields();
        // Only actually re-renders this field's message if it's already touched — an untouched
        // field typing its very first character doesn't suddenly flash an error (see
        // updateValidationDisplay's own docstring), but a field the user has already blurred once
        // gets its error cleared/updated live as they keep correcting it.
        updateValidationDisplay();
        changeListeners.forEach((cb) => cb(values));
      });
    }
  }

  // Delegated (not one listener per control) since `focusout` bubbles and this needs to work
  // identically for native inputs and custom elements alike (skye-people-picker etc. have no
  // Constraint Validation participation of their own to hook into) — `closest` handles both a
  // shadow-DOM control (whose event target gets retargeted to the host on the way out) and a
  // light-DOM one (where the actual focused element might be a descendant of the tagged control).
  root.addEventListener("focusout", (e) => {
    const fieldKey = (e.target as HTMLElement).closest<HTMLElement>("[data-field-key]")?.dataset.fieldKey;
    if (!fieldKey || !renderedFields.has(fieldKey) || touchedFields.has(fieldKey)) return;
    touchedFields.add(fieldKey);
    updateValidationDisplay();
  });

  /** Re-evaluates every visibleIf (fields and pages) against current values and toggles display accordingly. */
  function recomputeVisibility(): void {
    for (const { field, rendered } of renderedFields.values()) {
      const visible = !field.visibleIf || evaluateCondition(field.visibleIf, values);
      rendered.container.style.display = visible ? "" : "none";
    }
    for (const [pageKey, page] of pageEntries) {
      const visible = !page.visibleIf || evaluateCondition(page.visibleIf, values);
      const tab = tabButtons.get(pageKey);
      if (tab) tab.style.display = visible ? "" : "none";
      // A hidden page's own container display is handled by showPage's active-tab logic; here we just gate the tab itself.
    }
  }

  /**
   * Recomputes every calculatedDisplay field's value from its declared
   * expression and writes it both into `values` (so it's available to
   * postAction templating/submission, same as any other field) and onto
   * its control (so the user actually sees the updated number/string).
   * Called after every field change — cheap enough for a form-sized field
   * count, and simpler than tracking a precise per-field dependency graph.
   */
  function recomputeCalculatedFields(): void {
    for (const { field, rendered } of renderedFields.values()) {
      if (field.controlType !== "calculatedDisplay" || !field.calculatedDisplay) continue;
      const result = evaluateCalculatedExpression(field.calculatedDisplay, values);
      const fieldKey = rendered.control.dataset.fieldKey!;
      values[fieldKey] = result;
      (rendered.control as unknown as { value: unknown }).value = result;
    }
  }

  /**
   * Runs validateFormValues over the WHOLE form (cheap for a form-sized
   * field count — same "just re-walk everything" precedent as
   * recomputeVisibility/recomputeCalculatedFields above) and updates every
   * TOUCHED field's inline message, invalid styling class, and
   * `aria-invalid`. An untouched field's error (if any) is computed but
   * deliberately not shown — see touchedFields' own comment. Also calls
   * the Constraint Validation API's `setCustomValidity` on any control
   * that supports it — every native `<input>`/`<select>`/`<textarea>`
   * always has; every SKYE custom element (skye-people-picker etc.) now
   * does too, via `attachInternals()` (see registerElements.ts's
   * `SkyeValueElement` base class) — so this app's OWN validation
   * (native constraints AND custom validators alike) drives the real
   * `:invalid`/`:user-invalid` CSS pseudo-classes uniformly across every
   * control type, not just this function's own `.skye-field--invalid`
   * class. That class stays as the guaranteed, deterministic layer this
   * app's own `touchedFields` tracking controls directly; the native
   * pseudo-classes are a free, additional, browser/assistive-tech-facing
   * layer on top, not a replacement for it.
   */
  function updateValidationDisplay(): void {
    const errors = validateFormValues(config, values, options.customValidators ?? {});
    const errorByField = new Map(errors.map((e) => [e.fieldKey, e.message]));

    for (const [fieldKey, { rendered }] of renderedFields) {
      const message = touchedFields.has(fieldKey) ? errorByField.get(fieldKey) : undefined;
      rendered.messageEl.textContent = message ?? "";
      rendered.container.classList.toggle("skye-field--invalid", Boolean(message));
      rendered.control.setAttribute("aria-invalid", message ? "true" : "false");
      if (typeof (rendered.control as Partial<HTMLInputElement>).setCustomValidity === "function") {
        (rendered.control as HTMLInputElement).setCustomValidity(message ?? "");
      }
    }
  }

  function showPage(activeKey: string): void {
    activePageKey = activeKey;
    for (const [pageKey, container] of pageContainers) {
      container.style.display = pageKey === activeKey ? "grid" : "none";
      tabButtons.get(pageKey)?.classList.toggle("skye-form__tab--active", pageKey === activeKey);
    }
  }

  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "skye-form__submit";
  submitButton.textContent = "Submit";
  root.appendChild(submitButton);

  recomputeVisibility();
  recomputeCalculatedFields();
  if (pageEntries.length > 0) {
    // Prefer the caller's requested starting page (e.g. /builder's live preview restoring
    // whichever page was showing before this rebuild) if it names a real page here; otherwise
    // fall back to the first page by `order`, same as always.
    const initial = options.initialPageKey && pageContainers.has(options.initialPageKey) ? options.initialPageKey : pageEntries[0][0];
    showPage(initial);
  }

  return {
    root,
    getValues: () => ({ ...values }),
    setFieldValue: (key, value) => {
      values[key] = value;
      const entry = renderedFields.get(key);
      if (entry) {
        const def = getControlDefinition(entry.field.controlType);
        writeControlValue(entry.rendered.control, def.valueAccessor, value);
      }
      recomputeVisibility();
      recomputeCalculatedFields();
      updateValidationDisplay();
      changeListeners.forEach((cb) => cb(values));
    },
    onChange: (cb) => changeListeners.push(cb),
    submitButton,
    showPage,
    getActivePageKey: () => activePageKey,
    validateAll: () => {
      for (const fieldKey of renderedFields.keys()) touchedFields.add(fieldKey);
      updateValidationDisplay();
      return validateFormValues(config, values, options.customValidators ?? {}).length === 0;
    },
  };
}
