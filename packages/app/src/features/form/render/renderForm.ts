import type { FormConfig, FieldValues, CustomValidatorFn } from "@skye/form-config";
import { evaluateCondition, evaluateCalculatedExpression } from "@skye/form-config";
import { renderField, type RenderedField } from "./renderField.js";
import { getControlDefinition } from "./fieldRegistry.js";
import { applyPageLayout } from "./layoutEngine.js";
import { validateFormValues } from "../validateFormValues.js";
import { renderFilePreview } from "./fileUploadZone.js";

export interface RenderedForm {
  root: HTMLElement;
  getValues: () => FieldValues;
  setFieldValue: (key: string, value: unknown) => void;
  /** Registers a listener fired on every field change, after visibility has been recomputed. */
  onChange: (cb: (values: FieldValues) => void) => void;
  /** The submit button — entry-form.ts (or whatever's orchestrating submission) attaches its own click handler; renderForm doesn't know about Graph/postActions. */
  submitButton: HTMLButtonElement;
  /**
   * Every `controlType: "button"` field, keyed by field key — same "renderForm builds the DOM,
   * the caller wires the actual click behavior" split as submitButton above (renderForm doesn't
   * know about Graph/postActions/runButtonActions either). `button`/`statusEl` are exactly
   * renderField's own `control`/`buttonStatusEl` for that field; `field` is its FieldConfig, so
   * the caller has `field.actions`/`validate`/`confirm` without a second lookup.
   */
  buttons: Record<string, { button: HTMLButtonElement; statusEl: HTMLElement; field: FormConfig["fields"][string] }>;
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
  /**
   * Merges externally-computed, field-keyed error messages on top of the
   * normal validation (they win, and are shown regardless of "touched"),
   * marks those fields invalid, and re-renders. Pass `{}` to clear. Used
   * for checks the DOM layer can't do itself — e.g. "this picked person
   * isn't a member of the site" (see submit/checkPersonFields.ts), which
   * must block the submit with a field warning rather than silently
   * dropping the value. Any subsequent field edit clears them.
   */
  setExternalErrors: (errors: Record<string, string>) => void;
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
  /**
   * Seed values for an edit- or view-mode form — the existing list item's
   * fields, mapped by `mapSharePointFieldsToValues`. Applied after each
   * field renders, overriding any `defaultValue`, and written onto the
   * controls so people pickers / multi-selects show the saved data.
   */
  initialValues?: FieldValues;
  /**
   * `controlType: "file"` fields only — an already-resolved preview to
   * show INSTEAD of trying to render `initialValues[key]` (a raw URL
   * string, e.g. a SharePoint webUrl a browser can't load cross-origin)
   * directly. `initialValues[key]` itself must stay the original saved
   * URL regardless — that's what an unmodified submit re-sends, and
   * swapping it for a blob URL there would make submitForm.ts think a
   * new file needs uploading (its `instanceof File` check would still
   * say no, but the persisted value would become a worthless local blob:
   * URL instead of the real one). `name` is required because a blob URL
   * has no filename of its own to derive one from — see page-scripts/form.ts,
   * the only current populator of this, which fetches the bytes via
   * Graph (a raw cross-origin SharePoint URL 401s/CORS-fails as an `<img
   * src>`) and captures the real name from the URL before replacing it.
   */
  filePreviews?: Record<string, { url: string; name: string }>;
}

/** Reads a control's current value using the accessor its field registry entry declares. */
function readControlValue(control: HTMLElement, valueAccessor: "value" | "checked" | "none"): unknown {
  if (valueAccessor === "checked") return (control as HTMLInputElement).checked;
  if (valueAccessor === "value") {
    // A `radio` control is a <fieldset> of <input type=radio> — its own `.value` is meaningless;
    // the field's value is whichever radio is currently checked (undefined if none yet).
    if (control instanceof HTMLFieldSetElement) {
      const checked = control.querySelector<HTMLInputElement>("input:checked");
      return checked ? checked.value : undefined;
    }
    return (control as HTMLInputElement | HTMLSelectElement).value;
  }
  return undefined;
}

function writeControlValue(control: HTMLElement, valueAccessor: "value" | "checked" | "none", value: unknown): void {
  if (valueAccessor === "checked") {
    (control as HTMLInputElement).checked = Boolean(value);
  } else if (valueAccessor === "value") {
    if (control instanceof HTMLFieldSetElement) {
      for (const input of Array.from(control.querySelectorAll<HTMLInputElement>("input"))) {
        input.checked = input.value === String(value);
      }
      return;
    }
    // Custom elements (skye-people-picker / skye-multi-select) accept a non-string value through
    // their own `value` setter — only stringify for plain native inputs/selects.
    const isCustomElement = control.tagName.includes("-");
    (control as unknown as { value: unknown }).value = isCustomElement
      ? value
      : value === undefined || value === null
        ? ""
        : String(value);
  }
}

/**
 * Builds the full form DOM from an already-merged FormConfig (base +
 * permission overlays already applied via @skye/form-config's mergeConfig).
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
  /** Field-keyed errors set by the caller (setExternalErrors) — e.g. a picked person who isn't a site member. Cleared on the next field edit. */
  const externalErrors = new Map<string, string>();

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
  /** Per page: the field keys its `gridTemplateAreas` actually names. A field not in this set must NOT keep renderField's `grid-area:<key>` — an unresolved area name collapses every such field onto the same cell. */
  const areaPlacedByPage = new Map<string, Set<string>>();

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

    areaPlacedByPage.set(
      pageKey,
      new Set((page.layout?.gridTemplateAreas ?? []).flatMap((row) => row.trim().split(/\s+/)).filter((token) => token && token !== "."))
    );
  }

  /**
   * The shared "a field's value just changed, for a real reason (a user
   * edit, or removing an existing file preview)" side-effect sequence —
   * factored out so the per-field change listener below and a file
   * field's remove button (wired from renderForm, not fileUploadZone,
   * since only renderForm has `values`/`recomputeVisibility`/etc. in
   * scope) run identically rather than drifting apart.
   */
  function commitFieldValue(fieldKey: string, newValue: unknown): void {
    values[fieldKey] = newValue;
    recomputeVisibility();
    recomputeCalculatedFields();
    // An edit invalidates any external error (they're re-checked on the next submit anyway) —
    // so a "not a site member" warning clears the moment the user removes/changes that pick.
    if (externalErrors.size > 0) externalErrors.clear();
    updateValidationDisplay();
    changeListeners.forEach((cb) => cb(values));
  }

  /**
   * Shows or clears a `controlType: "file"` field's preview from a
   * non-File value (a saved item's URL string, or undefined to clear) —
   * used for edit/view-mode seeding and `setFieldValue`, neither of which
   * can hand a real `File` to the native input (browsers don't allow
   * programmatically populating one). The preview's own remove button
   * routes back through `commitFieldValue` with `""` (not `undefined`) so
   * a subsequent save actually clears the bound column rather than
   * silently resending the old value — `JSON.stringify` drops an
   * `undefined` property entirely, `""` doesn't.
   */
  function applyFilePreviewValue(
    fieldKey: string,
    entry: { field: (typeof config.fields)[string]; rendered: RenderedField },
    value: unknown,
    previewOverride?: { url: string; name: string }
  ): void {
    const previewEl = entry.rendered.filePreviewEl;
    if (!previewEl) return;
    const onRemove = () => {
      commitFieldValue(fieldKey, "");
      renderFilePreview(previewEl, undefined, document, () => {}); // hide the preview itself — commitFieldValue only tracks the value
    };
    if (previewOverride) {
      // Already known to be an image — that's the one condition page-scripts/form.ts fetches a
      // preview for at all (see filePreviews's own docs on RenderFormOptions).
      renderFilePreview(previewEl, previewOverride.url, document, onRemove, { name: previewOverride.name, isImage: true });
      return;
    }
    const source = typeof value === "string" && value ? value : undefined;
    renderFilePreview(previewEl, source, document, onRemove);
  }

  const fieldEntries = Object.entries(config.fields).sort(([, a], [, b]) => (a.order ?? Infinity) - (b.order ?? Infinity));
  const buttons: RenderedForm["buttons"] = {};

  for (const [fieldKey, field] of fieldEntries) {
    const pageContainer = field.page ? pageContainers.get(field.page) : undefined;
    if (!pageContainer) continue; // a field with no matching page is a config error a lint pass should catch, not something to crash the render over

    const rendered = renderField(fieldKey, field, document);
    // renderField sets `grid-area:<fieldKey>` unconditionally, which only resolves when the page's
    // gridTemplateAreas names this key. If it doesn't (e.g. a single-column form that just stacks
    // fields by `order`), keeping it would pin every unplaced field to the same grid cell — so drop
    // it and let the field auto-place into the grid flow instead.
    if (!areaPlacedByPage.get(field.page as string)?.has(fieldKey)) {
      rendered.container.style.removeProperty("grid-area");
    }
    pageContainer.appendChild(rendered.container);
    renderedFields.set(fieldKey, { field, rendered });

    if (field.controlType === "button") {
      // rendered.buttonStatusEl always exists for controlType "button" — see renderField.ts.
      buttons[fieldKey] = { button: rendered.control as HTMLButtonElement, statusEl: rendered.buttonStatusEl!, field };
    }

    if (field.defaultValue !== undefined) values[fieldKey] = field.defaultValue;

    const def = getControlDefinition(field.controlType);
    for (const eventName of def.changeEvents) {
      rendered.control.addEventListener(eventName, () => {
        // File inputs use valueAccessor "none" (readControlValue doesn't handle them) — capture the
        // selected File object directly; submitForm.ts's upload step looks for a File instance here.
        // (fileUploadZone.ts's own "change" listener, wired at render time, handles this event's
        // preview update separately — this listener only needs to track the value itself.)
        const newValue = field.controlType === "file" ? (rendered.control as HTMLInputElement).files?.[0] : readControlValue(rendered.control, def.valueAccessor);
        // Only actually re-renders this field's message if it's already touched — an untouched
        // field typing its very first character doesn't suddenly flash an error (see
        // updateValidationDisplay's own docstring), but a field the user has already blurred once
        // gets its error cleared/updated live as they keep correcting it.
        commitFieldValue(fieldKey, newValue);
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
      // An external error (e.g. "not a site member") always shows and always wins; otherwise fall
      // back to the normal validation message, shown only once the field has been touched.
      const message = externalErrors.get(fieldKey) ?? (touchedFields.has(fieldKey) ? errorByField.get(fieldKey) : undefined);
      rendered.messageEl.textContent = message ?? "";
      rendered.container.classList.toggle("skye-field--invalid", Boolean(message));
      rendered.control.setAttribute("aria-invalid", message ? "true" : "false");
      if (typeof (rendered.control as Partial<HTMLInputElement>).setCustomValidity === "function") {
        (rendered.control as HTMLInputElement).setCustomValidity(message ?? "");
      }
    }

    // Flag each tab whose page currently has a shown error, so a problem on a page you're not
    // looking at is still visible (paired with showPage touching a page's fields when you leave it).
    for (const [pageKey, tab] of tabButtons) {
      let hasError = false;
      for (const [fieldKey, entry] of renderedFields) {
        if (entry.field.page !== pageKey) continue;
        if (externalErrors.has(fieldKey) || (touchedFields.has(fieldKey) && errorByField.has(fieldKey))) {
          hasError = true;
          break;
        }
      }
      tab.classList.toggle("skye-form__tab--error", hasError);
    }
  }

  /** Jumps to the page of the first field currently showing an error and scrolls it into view. Called on a failed submit / external-error set so the user isn't left on a page that looks fine. */
  function focusFirstError(): void {
    const errorByField = new Map(validateFormValues(config, values, options.customValidators ?? {}).map((e) => [e.fieldKey, e.message]));
    for (const [fieldKey, entry] of renderedFields) {
      const shown = externalErrors.has(fieldKey) || (touchedFields.has(fieldKey) && errorByField.has(fieldKey));
      if (!shown) continue;
      if (entry.field.page && entry.field.page !== activePageKey) showPage(entry.field.page);
      entry.rendered.container.scrollIntoView?.({ block: "center" }); // not implemented in jsdom
      return;
    }
  }

  function showPage(activeKey: string): void {
    // Leaving a page: touch its fields and re-render validation now, so a problem shows the moment
    // you navigate away — not only when you finally reach Submit. (No-op on the initial render,
    // where activePageKey is still undefined.)
    if (activePageKey && activePageKey !== activeKey) {
      for (const [fieldKey, entry] of renderedFields) {
        if (entry.field.page === activePageKey) touchedFields.add(fieldKey);
      }
      updateValidationDisplay();
    }
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

  // Edit / view mode: seed the existing item's values onto the form (overriding any defaultValue),
  // and push them into the controls so people pickers and multi-selects render the saved data. A
  // `file` field can't be seeded onto its real <input> (no browser allows populating one
  // programmatically) — it gets the same preview UI a fresh pick shows instead, built directly
  // from the saved URL string rather than a File.
  if (options.initialValues) {
    for (const [fieldKey, value] of Object.entries(options.initialValues)) {
      if (value === undefined) continue;
      const entry = renderedFields.get(fieldKey);
      if (entry?.field.controlType === "file") {
        // A file field is exempt from the read-back below by necessity, not just convenience —
        // see RenderFormOptions.filePreviews's own doc comment: a file <input> can't be seeded
        // programmatically at all, so there's no normalised control value to read back, and
        // `values[fieldKey]` staying the original saved URL string is what an unmodified submit
        // is actually supposed to re-send.
        values[fieldKey] = value;
        applyFilePreviewValue(fieldKey, entry, value, options.filePreviews?.[fieldKey]);
        continue;
      }
      if (!entry) {
        values[fieldKey] = value; // no matching rendered field (e.g. a stale/removed config key) — nothing to normalise against
        continue;
      }
      writeControlValue(entry.rendered.control, getControlDefinition(entry.field.controlType).valueAccessor, value);
      // For a CUSTOM element (skye-people-picker, skye-multi-select, ...) — tagName check matches
      // writeControlValue's own distinction above — read its value back rather than trusting the
      // raw seed as-is. A real, live bug this fixes: a peoplePicker's raw seed can be the actual
      // SharePoint `{LookupId, LookupValue, Email}` shape (or an array of them), which
      // writeControlValue normalises into the control's own internal state (its `set value`), but
      // the `values` cache here used to just keep that raw, un-normalised shape forever — until
      // the user happened to re-pick the same person, which is exactly why "if you re-enter the
      // names again it works" was the original symptom. Any caller reading this form's values
      // (checkPersonFieldsResolve, the submit encoder, a button's own {{fields.x}} action
      // templating via rendered.getValues()) now sees what the control itself would report, not a
      // stale pre-normalisation snapshot. Deliberately NOT done for a plain native input/select:
      // its `.value` is always a string, so reading it back would silently turn a numeric seed
      // (e.g. a Number/Currency column's raw JS number) into a string in the cache, a real type
      // regression native controls don't actually need this fix for — writeControlValue already
      // only stringifies for DISPLAY there, the raw seed stays correct to keep as-is.
      const isCustomElement = entry.rendered.control.tagName.includes("-");
      values[fieldKey] = isCustomElement
        ? readControlValue(entry.rendered.control, getControlDefinition(entry.field.controlType).valueAccessor)
        : value;
    }
  }

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
      const entry = renderedFields.get(key);
      if (entry?.field.controlType === "file") applyFilePreviewValue(key, entry, value);
      else if (entry) writeControlValue(entry.rendered.control, getControlDefinition(entry.field.controlType).valueAccessor, value);
      commitFieldValue(key, value);
    },
    onChange: (cb) => changeListeners.push(cb),
    submitButton,
    buttons,
    showPage,
    getActivePageKey: () => activePageKey,
    validateAll: () => {
      for (const fieldKey of renderedFields.keys()) touchedFields.add(fieldKey);
      updateValidationDisplay();
      const ok = validateFormValues(config, values, options.customValidators ?? {}).length === 0;
      if (!ok) focusFirstError();
      return ok;
    },
    setExternalErrors: (errs) => {
      externalErrors.clear();
      for (const [key, msg] of Object.entries(errs)) {
        externalErrors.set(key, msg);
        touchedFields.add(key);
      }
      updateValidationDisplay();
      if (Object.keys(errs).length > 0) focusFirstError();
    },
  };
}
