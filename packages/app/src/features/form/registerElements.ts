/**
 * Web Components backing the non-native controlTypes (see fieldRegistry.ts).
 * Styling is intentionally minimal — the point of this pass is real markup
 * and logic (search-as-you-type, row add/remove), not visual design.
 * `skye-richtext` is a deliberate exception: it's a minimal placeholder by
 * design (plain contenteditable + a purely visual toolbar, no formatting
 * logic at all), meant to be replaced wholesale by a real editor library
 * later — see that class's own docstring and TODO §7.
 */

import type { LookupTable } from "@skye/form-config";
import type { LookupItemResult, PersonResult } from "../../shared/sharepoint/types.js";
import type { LookupTableRow } from "./submit/lookupTableRows.js";

/**
 * Base class giving every SKYE custom element a consistent get/set `value`
 * + change-event contract (so renderForm's generic read/write logic works
 * identically across all of them) AND real participation in the browser's
 * Constraint Validation API via `attachInternals()` — `static formAssociated
 * = true` plus a `setCustomValidity(message)` that mirrors a native
 * `<input>`'s own method exactly (delegates to
 * `ElementInternals.setValidity()`), so renderForm.ts's existing
 * `typeof control.setCustomValidity === "function"` check treats these
 * elements identically to a real form control with NO separate code path —
 * that one shared check is what makes native `:invalid`/`:user-invalid`
 * (and `checkValidity()`/`reportValidity()`/`validity`/`validationMessage`
 * for anything that reads them, e.g. assistive tech) genuinely apply here,
 * not just this app's own `.skye-field--invalid` fallback class.
 *
 * Every ElementInternals call below is feature-detected before use —
 * jsdom (this repo's test environment) implements `attachInternals()`
 * itself but NOT the Constraint Validation portion of the returned object
 * (`setValidity`/`checkValidity`/`validity`/`validationMessage`/
 * `willValidate` are all `undefined` there, confirmed directly against
 * jsdom 25). Without the guards, every test that renders one of these
 * elements would throw. In a real browser (where all of this IS
 * implemented) the guards are simply always-true and never skip anything.
 *
 * Deliberately NOT wired: `ElementInternals.setFormValue()` (the OTHER
 * half of form-association, for participating in a real `<form>`'s
 * FormData on native submission) — this app never wraps a form in an
 * actual `<form>` element and submits entirely through its own JS
 * pipeline (submitForm.ts reads `.value` directly), so there is no
 * native submission event `setFormValue` would ever actually feed. Only
 * the validation half of form-association is relevant here, which is
 * exactly what's implemented.
 */
abstract class SkyeValueElement extends HTMLElement {
  static formAssociated = true;

  protected _value: unknown = "";
  private readonly _internals: ElementInternals | undefined;

  constructor() {
    super();
    try {
      this._internals = this.attachInternals();
    } catch {
      // Some environment doesn't support attachInternals() at all (very old browsers) — degrade
      // to "no Constraint Validation participation", same as before this feature existed.
      this._internals = undefined;
    }
  }

  get value(): unknown {
    return this._value;
  }
  set value(v: unknown) {
    this._value = v;
    this.render();
  }

  protected emitChange(): void {
    this.dispatchEvent(new CustomEvent("skye-change", { bubbles: true }));
  }

  /** Same contract as HTMLInputElement.setCustomValidity: a non-empty message marks the control invalid with that message; an empty string clears it. */
  setCustomValidity(message: string): void {
    if (typeof this._internals?.setValidity !== "function") return;
    if (message) this._internals.setValidity({ customError: true }, message);
    else this._internals.setValidity({});
  }

  checkValidity(): boolean {
    return typeof this._internals?.checkValidity === "function" ? this._internals.checkValidity() : true;
  }
  reportValidity(): boolean {
    return typeof this._internals?.reportValidity === "function" ? this._internals.reportValidity() : true;
  }
  get validity(): ValidityState | undefined {
    return this._internals?.validity;
  }
  get validationMessage(): string {
    return this._internals?.validationMessage ?? "";
  }
  get willValidate(): boolean {
    return this._internals?.willValidate ?? true;
  }

  protected abstract render(): void;
}

/** Debounces a function's invocation — used so search-as-you-type pickers don't fire a request per keystroke. */
function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Shared search-and-select UI for peoplePicker/lookupPicker: a text input,
 * a dropdown of results, and a "selected" chip once something is chosen.
 * Subclasses only need to say how to dispatch a search request and how to
 * label a result — everything else (debounce, dropdown, selection state,
 * clearing) is common.
 */
abstract class SkyeSearchPicker<TResult extends { id: string }> extends SkyeValueElement {
  private input?: HTMLInputElement;
  private dropdown?: HTMLUListElement;
  private selectedLabel = "";
  private results: TResult[] = [];

  protected abstract requestSearch(query: string): void;
  protected abstract resultLabel(result: TResult): string;

  connectedCallback() {
    this.classList.add("skye-search-picker");

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = this.getAttribute("placeholder") ?? "Search…";

    this.dropdown = document.createElement("ul");
    this.dropdown.className = "skye-search-picker__dropdown";
    this.dropdown.hidden = true;

    const debouncedSearch = debounce((q: string) => this.requestSearch(q), 250);

    this.input.addEventListener("input", () => {
      const q = this.input!.value;
      if (q.length === 0) {
        this.setResults([]);
        return;
      }
      debouncedSearch(q);
    });

    this.input.addEventListener("blur", () => {
      // Delay hiding so a click on a dropdown item registers first.
      setTimeout(() => {
        if (this.dropdown) this.dropdown.hidden = true;
      }, 150);
    });

    this.appendChild(this.input);
    this.appendChild(this.dropdown);
    this.render();
  }

  /** Called by the app-level search-event listener (see entry-form.ts) once results come back. */
  setResults(results: TResult[]): void {
    this.results = results;
    if (!this.dropdown) return;
    this.dropdown.innerHTML = "";
    this.dropdown.hidden = results.length === 0;

    for (const result of results) {
      const li = document.createElement("li");
      li.textContent = this.resultLabel(result);
      li.tabIndex = 0;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus so the input's blur-hide doesn't race this selection
        this.select(result);
      });
      this.dropdown!.appendChild(li);
    }
  }

  private select(result: TResult): void {
    this._value = result.id;
    this.selectedLabel = this.resultLabel(result);
    if (this.dropdown) this.dropdown.hidden = true;
    this.render();
    this.emitChange();
  }

  protected render(): void {
    if (this.input) this.input.value = this.selectedLabel || (typeof this._value === "string" ? this._value : "");
  }
}

/**
 * Real peoplePicker: a token/chip multi-picker. Each chosen person is a
 * discrete, removable unit — there is no delimiter the user ever sees or
 * types, and a half-typed name can't end up "in" the value. Searches the
 * directory as the user types (via the "skye-people-search" event, wired
 * to graph.searchPeople in page-scripts/form.ts) and shows results in a
 * dropdown; clicking one adds a chip.
 *
 * `.value` is a `string[]` of stable keys — each person's email when known,
 * else their directory id — which is what the submit pipeline resolves to
 * a SharePoint user id for a Person column (see submit/encodeSharePointFields.ts).
 * `set value` also accepts a single string, or an array of SharePoint
 * person objects (as they come back on an existing item), and normalises
 * them, so an edit-mode prefill of a Person column still shows chips.
 */
interface PickedPerson {
  key: string;
  label: string;
}

class SkyePeoplePicker extends SkyeValueElement {
  private box?: HTMLDivElement;
  private input?: HTMLInputElement;
  private dropdown?: HTMLUListElement;
  private picked: PickedPerson[] = [];
  private results: PersonResult[] = [];

  connectedCallback() {
    this.classList.add("skye-token-picker");
    this.picked = normalisePeopleValue(this._value);

    this.box = document.createElement("div");
    this.box.className = "skye-token-picker__box";

    this.input = document.createElement("input");
    this.input.className = "skye-token-picker__input";
    this.input.type = "text";
    this.input.setAttribute("autocomplete", "off");
    this.input.placeholder = this.getAttribute("placeholder") ?? "Type a name or email…";

    this.dropdown = document.createElement("ul");
    this.dropdown.className = "skye-token-picker__dropdown";
    this.dropdown.hidden = true;

    const debouncedSearch = debounce((q: string) => {
      this.dispatchEvent(new CustomEvent("skye-people-search", { detail: { query: q }, bubbles: true, composed: true }));
    }, 250);

    this.input.addEventListener("input", () => {
      const q = this.input!.value.trim();
      if (q.length === 0) {
        this.setResults([]);
        return;
      }
      debouncedSearch(q);
    });

    // Backspace on an empty input removes the last chip — a standard token-field affordance.
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && this.input!.value === "" && this.picked.length > 0) {
        this.picked = this.picked.slice(0, -1);
        this.commit();
      }
    });

    this.input.addEventListener("blur", () => {
      setTimeout(() => {
        if (this.dropdown) this.dropdown.hidden = true;
      }, 150);
    });

    this.box.appendChild(this.input);
    this.appendChild(this.box);
    this.appendChild(this.dropdown);
    this.render();
  }

  /** Called by page-scripts/form.ts's "skye-people-search" listener once Graph results come back. */
  setResults(results: PersonResult[]): void {
    this.results = results;
    if (!this.dropdown) return;
    this.dropdown.innerHTML = "";
    const already = new Set(this.picked.map((p) => p.key));
    const fresh = results.filter((r) => !already.has(r.email || r.id));
    this.dropdown.hidden = fresh.length === 0;

    for (const result of fresh) {
      const li = document.createElement("li");
      li.textContent = result.email ? `${result.displayName} (${result.email})` : result.displayName;
      li.tabIndex = 0;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus so the input's blur-hide doesn't race this selection
        this.add({ key: result.email || result.id, label: result.displayName || result.email || result.id });
      });
      this.dropdown!.appendChild(li);
    }
  }

  private add(person: PickedPerson): void {
    if (!this.picked.some((p) => p.key === person.key)) this.picked = [...this.picked, person];
    if (this.input) this.input.value = "";
    if (this.dropdown) this.dropdown.hidden = true;
    this.commit();
  }

  private removeChip(key: string): void {
    this.picked = this.picked.filter((p) => p.key !== key);
    this.commit();
  }

  /** Push the current selection into `_value` (a plain string[] of keys) and notify. */
  private commit(): void {
    this._value = this.picked.map((p) => p.key);
    this.render();
    this.emitChange();
  }

  protected render(): void {
    if (!this.box || !this.input) return;
    // Re-sync from an externally-set value (edit-mode prefill / setFieldValue).
    if (!arraysShallowEqual(this.picked.map((p) => p.key), Array.isArray(this._value) ? (this._value as string[]) : [])) {
      this.picked = normalisePeopleValue(this._value);
    }
    for (const chip of Array.from(this.box.querySelectorAll(".skye-token"))) chip.remove();
    for (const person of this.picked) {
      const chip = document.createElement("span");
      chip.className = "skye-token";
      chip.append(person.label);
      const x = document.createElement("button");
      x.type = "button";
      x.className = "skye-token__remove";
      x.setAttribute("aria-label", `Remove ${person.label}`);
      x.textContent = "×";
      x.addEventListener("click", () => this.removeChip(person.key));
      chip.appendChild(x);
      this.box.insertBefore(chip, this.input);
    }
  }
}

/** Normalises whatever got assigned to a people picker's `value` into `{key,label}` chips: a string[], a single string, or SharePoint person objects from an existing item. */
function normalisePeopleValue(value: unknown): PickedPerson[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  return list
    .map((entry): PickedPerson | undefined => {
      if (typeof entry === "string") return { key: entry, label: entry };
      if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        // Key priority puts the numeric `LookupId` ahead of the display name: an edit-mode person
        // seed often has no email, and the submit encoder short-circuits a numeric key straight to
        // an already-resolved site user id — a display-name key would fail to re-resolve on save.
        const key = String(o.Email ?? o.email ?? o.LookupId ?? o.id ?? o.LookupValue ?? "");
        const label = String(o.LookupValue ?? o.displayName ?? o.Email ?? o.email ?? key);
        return key ? { key, label } : undefined;
      }
      return undefined;
    })
    .filter((p): p is PickedPerson => p !== undefined);
}

function arraysShallowEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Real lookupPicker: searches a specific related list (identified by the
 * field's `relatedList` config — see fieldRegistry.ts's configureElement
 * hook, which sets `.relatedList` on this element right after creation)
 * via a "skye-lookup-search" event.
 */
class SkyeLookupPicker extends SkyeSearchPicker<LookupItemResult> {
  /** Set externally by fieldRegistry's configureElement hook — not a plain HTML attribute since it's a structured object. */
  relatedList?: { id: string; siteId?: string; displayField: string };

  protected requestSearch(query: string): void {
    this.dispatchEvent(new CustomEvent("skye-lookup-search", { detail: { query, relatedList: this.relatedList }, bubbles: true, composed: true }));
  }
  protected resultLabel(result: LookupItemResult): string {
    return result.label;
  }
}

/**
 * Real editable lookupTable: renders one row per LookupTableRow, one input
 * per configured column (text/number/select handled generically — no
 * nested visibleIf/validation yet, see TODO), with add/remove controls.
 * `.tableConfig` is set externally by fieldRegistry's configureElement
 * hook right after creation, same pattern as lookupPicker's `.relatedList`.
 */
class SkyeLookupTable extends SkyeValueElement {
  tableConfig?: LookupTable;
  private tbody?: HTMLTableSectionElement;

  connectedCallback() {
    this.classList.add("skye-lookup-table");
    if (!Array.isArray(this._value)) this._value = [];
    this.render();
  }

  private get rows(): LookupTableRow[] {
    return this._value as LookupTableRow[];
  }

  private setRows(rows: LookupTableRow[]): void {
    this._value = rows;
    this.render();
    this.emitChange();
  }

  protected render(): void {
    this.innerHTML = "";
    if (!this.tableConfig) {
      this.textContent = "[lookupTable: not configured]";
      return;
    }

    const columns = Object.entries(this.tableConfig.columns).sort(([, a], [, b]) => (a.order ?? Infinity) - (b.order ?? Infinity));

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const [, col] of columns) {
      const th = document.createElement("th");
      th.textContent = col.label ?? "";
      headRow.appendChild(th);
    }
    headRow.appendChild(document.createElement("th")); // actions column
    thead.appendChild(headRow);
    table.appendChild(thead);

    this.tbody = document.createElement("tbody");
    // Deleted rows are kept in `.value` (so submitForm can still issue the delete) but never shown —
    // map to {row, index} pairs first so remove/update handlers reference the right underlying array slot.
    const visibleRows = this.rows.map((row, index) => ({ row, index })).filter(({ row }) => !row.deleted);

    visibleRows.forEach(({ row, index: rowIndex }) => {
      const tr = document.createElement("tr");
      for (const [colKey, col] of columns) {
        const td = document.createElement("td");
        const input = col.controlType === "select" ? document.createElement("select") : document.createElement("input");

        if (input instanceof HTMLSelectElement) {
          for (const opt of col.options ?? []) {
            const optionEl = document.createElement("option");
            optionEl.value = String(opt.value);
            optionEl.textContent = opt.label ?? String(opt.value);
            input.appendChild(optionEl);
          }
        } else {
          (input as HTMLInputElement).type = col.controlType === "number" || col.controlType === "currency" ? "number" : "text";
        }

        input.value = row.values[colKey] !== undefined ? String(row.values[colKey]) : "";
        input.addEventListener("input", () => {
          const rows = [...this.rows];
          rows[rowIndex] = { ...rows[rowIndex], values: { ...rows[rowIndex].values, [colKey]: input.value } };
          this._value = rows; // update in place without a full re-render (which would drop focus mid-keystroke)
          this.emitChange();
        });

        td.appendChild(input);
        tr.appendChild(td);
      }

      const actionsCell = document.createElement("td");
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.addEventListener("click", () => {
        if (this.tableConfig?.allowDelete === false) return;
        if (row.id) {
          // Existing (already-saved) row: mark deleted and keep it in the array so submitForm
          // actually issues a server-side delete — see writeLookupTableRows.
          this.setRows(this.rows.map((r, i) => (i === rowIndex ? { ...r, deleted: true } : r)));
        } else {
          // Never saved server-side — nothing to delete remotely, just drop it.
          this.setRows(this.rows.filter((_, i) => i !== rowIndex));
        }
      });
      actionsCell.appendChild(removeButton);
      tr.appendChild(actionsCell);

      this.tbody!.appendChild(tr);
    });
    table.appendChild(this.tbody);
    this.appendChild(table);

    if (this.tableConfig.allowAdd !== false) {
      const maxRows = this.tableConfig.maxRows;
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.textContent = "Add row";
      addButton.disabled = maxRows !== undefined && visibleRows.length >= maxRows;
      addButton.addEventListener("click", () => this.setRows([...this.rows, { values: {} }]));
      this.appendChild(addButton);
    }
  }
}

/**
 * Deliberately minimal placeholder for the `richtext` controlType: a
 * plain contenteditable area for basic text entry, plus a toolbar that's
 * PURELY VISUAL (CSS/HTML only, no click handlers, no execCommand, no
 * formatting logic at all) — just enough to signal "a toolbar goes here"
 * for later. This is intentional, not a placeholder that got left
 * unfinished: a real implementation (Tiptap suggested — see TODO §7) is
 * meant to replace this element's internals wholesale, and the smaller
 * the surface area here, the less there is to unwind. The get/set `value`
 * + `skye-change` event contract (inherited from SkyeValueElement) is the
 * one thing a real implementation MUST preserve, since that's what
 * fieldRegistry.ts/renderForm.ts depend on.
 */
class SkyeRichtext extends SkyeValueElement {
  private editor?: HTMLDivElement;

  connectedCallback() {
    this.classList.add("skye-richtext");

    // Visual-only placeholder toolbar — no buttons, no handlers, nothing functional.
    // Swap this whole block out first when upgrading; it exists only so the control
    // doesn't look like a bare text box while it's still a placeholder.
    const toolbar = document.createElement("div");
    toolbar.className = "skye-richtext__toolbar-placeholder";
    toolbar.setAttribute("aria-hidden", "true");
    toolbar.innerHTML = `<span></span><span></span><span></span>`;
    this.appendChild(toolbar);

    this.editor = document.createElement("div");
    this.editor.contentEditable = "true";
    this.editor.className = "skye-richtext__editor";
    this.editor.addEventListener("input", () => {
      this._value = this.editor!.innerHTML;
      this.emitChange();
    });
    this.appendChild(this.editor);
    this.render();
  }

  protected render(): void {
    if (this.editor && this.editor.innerHTML !== this._value) this.editor.innerHTML = String(this._value ?? "");
  }
}

/**
 * `checkboxGroup` controlType: a single dropdown that opens a checkable
 * list, instead of a always-expanded vertical column of checkboxes. Pick
 * as many options as you like; the trigger summarises the selection.
 *
 * `.options` (a `{ value, label? }[]`) is set by fieldRegistry.ts's
 * `configureElement` hook right after creation — it comes from the field's
 * own `options`, which page-scripts/form.ts fills from the bound SharePoint
 * Choice column before render. `.value` is a `string[]`; `set value` also
 * accepts a single string or a "; "/","-joined string and splits it.
 */
class SkyeMultiSelect extends SkyeValueElement {
  options: Array<{ value: unknown; label?: string }> = [];
  private trigger?: HTMLButtonElement;
  private panel?: HTMLUListElement;
  private open = false;

  connectedCallback() {
    this.classList.add("skye-multi-select");

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "skye-multi-select__trigger";
    this.trigger.setAttribute("aria-haspopup", "listbox");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.addEventListener("click", () => this.toggle());

    this.panel = document.createElement("ul");
    this.panel.className = "skye-multi-select__panel";
    this.panel.setAttribute("role", "listbox");
    this.panel.setAttribute("aria-multiselectable", "true");
    this.panel.hidden = true;

    // Clicking away closes the panel.
    document.addEventListener("click", (e) => {
      if (this.open && !this.contains(e.target as Node)) this.setOpen(false);
    });

    this.appendChild(this.trigger);
    this.appendChild(this.panel);
    this.render();
  }

  private get selected(): string[] {
    return Array.isArray(this._value) ? (this._value as string[]).map(String) : [];
  }

  set value(v: unknown) {
    // Accept an array, or a single/joined string (e.g. an edit-mode prefill of a multi-choice column).
    this._value = Array.isArray(v)
      ? v.map(String)
      : v === undefined || v === null || v === ""
        ? []
        : String(v)
            .split(/\s*[;,]\s*/)
            .filter(Boolean);
    this.render();
  }
  get value(): unknown {
    return this._value;
  }

  private toggle(): void {
    this.setOpen(!this.open);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    if (this.panel) this.panel.hidden = !open;
    this.trigger?.setAttribute("aria-expanded", String(open));
  }

  private toggleOption(value: string, checked: boolean): void {
    const next = new Set(this.selected);
    if (checked) next.add(value);
    else next.delete(value);
    this._value = [...next];
    this.render();
    this.emitChange();
  }

  protected render(): void {
    if (!this.trigger || !this.panel) return;
    const selected = this.selected;

    // Trigger label: summarise the current selection.
    this.trigger.textContent = "";
    const text = document.createElement("span");
    if (selected.length === 0) {
      text.className = "skye-multi-select__placeholder";
      text.textContent = "Select options…";
    } else {
      const labelFor = (v: string) => String(this.options.find((o) => String(o.value) === v)?.label ?? v);
      text.textContent = selected.length <= 3 ? selected.map(labelFor).join(", ") : `${selected.length} selected`;
    }
    const caret = document.createElement("span");
    caret.className = "skye-multi-select__caret";
    caret.textContent = "▾";
    this.trigger.append(text, caret);

    // Options list.
    this.panel.innerHTML = "";
    for (const opt of this.options) {
      const value = String(opt.value);
      const li = document.createElement("li");
      li.className = "skye-multi-select__option";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(selected.includes(value)));

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.includes(value);
      cb.addEventListener("change", () => this.toggleOption(value, cb.checked));

      const span = document.createElement("span");
      span.textContent = opt.label ?? value;

      li.append(cb, span);
      li.addEventListener("click", (e) => {
        if (e.target !== cb) {
          cb.checked = !cb.checked;
          this.toggleOption(value, cb.checked);
        }
      });
      this.panel.appendChild(li);
    }
  }
}

/** Read-only display for `calculatedDisplay` fields — value is set externally by renderForm's reactive recomputation whenever a dependency field changes (see renderForm.ts). */
class SkyeCalculatedDisplay extends SkyeValueElement {
  connectedCallback() {
    this.render();
  }
  protected render(): void {
    this.textContent = this._value === undefined || this._value === null ? "" : String(this._value);
  }
}

let registered = false;

/** Idempotent registration — safe to call multiple times (e.g. across hot-reloads in dev). */
export function registerElements(): void {
  if (registered) return;
  registered = true;
  customElements.define("skye-richtext", SkyeRichtext);
  customElements.define("skye-people-picker", SkyePeoplePicker);
  customElements.define("skye-multi-select", SkyeMultiSelect);
  customElements.define("skye-lookup-picker", SkyeLookupPicker);
  customElements.define("skye-lookup-table", SkyeLookupTable);
  customElements.define("skye-calculated-display", SkyeCalculatedDisplay);
}
