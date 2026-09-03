import type { SchemaProperty } from "@skye/form-config";
import { classifySchemaProperty } from "@skye/form-config";

/**
 * Generic, schema-driven property-editor controls for `/builder`. Every
 * function here works the same way: given a `SchemaProperty` (from
 * @skye/form-config's schemaIntrospection) and the plain JS object that owns
 * that property, it builds a control that reads/writes `parent[key]`
 * DIRECTLY (mutating the object in place) and calls `onChange()` (no
 * payload — callers already hold the reference they passed in) after every
 * edit. This is the same "mutate a shared object, then notify" shape
 * lib/render/renderForm.ts already uses for its own `values` object, kept
 * deliberately simple rather than introducing a second state-management
 * pattern just for the builder.
 *
 * Nothing here hardcodes "FieldConfig has a controlType enum" or similar —
 * every control is chosen by `classifySchemaProperty`, so a schema change
 * changes the builder's UI automatically. The one genuinely recursive shape
 * this schema has (`condition`, i.e. `visibleIf`/`when`) is deliberately
 * NOT expanded into a visual tree editor — see classifySchemaProperty's own
 * docstring — and is edited as raw JSON text here instead.
 */

export type ChangeHandler = () => void;

/** "controlType" -> "Control Type"; best-effort camelCase -> Title Case for a human-readable label. No special-casing of acronyms — good enough for this schema's property names. Exported for reuse by per-key overrides (see PropertyControlOverrides) that want the same label convention. */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Best-effort value coercion for an "unknown" (untyped `{}`) schema slot: valid JSON parses to its real type (number/boolean/object/array); anything else is kept as a plain string, so a form author can type either `42` or `Some text` and get what they mean. */
function coerceUnknown(raw: string): unknown {
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function stringifyUnknown(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** A single labeled `<input>`/`<textarea>` row — the leaf-level building block every control below wraps. Exported so a per-key override (see PropertyControlOverrides) can produce a row that looks identical to every generically-rendered one. */
export function wrapRow(labelText: string, description: string | undefined, control: HTMLElement, document: Document): HTMLElement {
  const row = document.createElement("div");
  row.className = "skye-builder__row";
  const label = document.createElement("label");
  label.className = "skye-builder__label";
  label.textContent = labelText;
  if (description) label.title = description;
  row.appendChild(label);
  row.appendChild(control);
  return row;
}

function textInput(document: Document, initial: string, onCommit: (raw: string) => void, type = "text"): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  input.value = initial;
  input.addEventListener("input", () => onCommit(input.value));
  return input;
}

/** Renders the right control for one schema property, reading/writing `parent[prop.key]` in place. `document` is threaded through explicitly (not `globalThis.document`) so this stays testable under jsdom without relying on ambient globals, matching renderField.ts's own convention. */
export function renderPropertyControl(prop: SchemaProperty, parent: Record<string, unknown>, onChange: ChangeHandler, document: Document): HTMLElement {
  const kind = classifySchemaProperty(prop.schema);
  const description = typeof prop.schema.description === "string" ? (prop.schema.description as string) : undefined;
  const label = humanizeKey(prop.key) + (prop.required ? " *" : "");

  switch (kind.kind) {
    case "enum": {
      const select = document.createElement("select");
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "— none —";
      select.appendChild(blank);
      for (const v of kind.values) {
        const opt = document.createElement("option");
        opt.value = String(v);
        opt.textContent = String(v);
        select.appendChild(opt);
      }
      select.value = parent[prop.key] !== undefined ? String(parent[prop.key]) : "";
      select.addEventListener("change", () => {
        parent[prop.key] = select.value === "" ? undefined : select.value;
        onChange();
      });
      return wrapRow(label, description, select, document);
    }

    case "boolean": {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(parent[prop.key]);
      checkbox.addEventListener("change", () => {
        parent[prop.key] = checkbox.checked;
        onChange();
      });
      return wrapRow(label, description, checkbox, document);
    }

    case "string": {
      const input = textInput(document, (parent[prop.key] as string | undefined) ?? "", (raw) => {
        parent[prop.key] = raw === "" ? undefined : raw;
        onChange();
      });
      return wrapRow(label, description, input, document);
    }

    case "integer":
    case "number": {
      const input = textInput(
        document,
        parent[prop.key] !== undefined && parent[prop.key] !== null ? String(parent[prop.key]) : "",
        (raw) => {
          if (raw.trim() === "") {
            parent[prop.key] = undefined;
          } else {
            const n = Number(raw);
            if (!Number.isNaN(n)) parent[prop.key] = kind.kind === "integer" ? Math.trunc(n) : n;
          }
          onChange();
        },
        "number"
      );
      if (kind.kind === "integer") input.step = "1";
      return wrapRow(label, description, input, document);
    }

    case "stringArray": {
      const current = (parent[prop.key] as string[] | undefined) ?? [];
      const input = textInput(document, current.join(", "), (raw) => {
        const items = raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        parent[prop.key] = items.length > 0 ? items : undefined;
        onChange();
      });
      input.placeholder = "comma-separated";
      return wrapRow(label, description, input, document);
    }

    case "oneOfPrimitive": {
      const rawInitial = parent[prop.key];
      const input = textInput(document, rawInitial !== undefined && rawInitial !== null ? String(rawInitial) : "", (raw) => {
        if (raw.trim() === "") {
          parent[prop.key] = undefined;
        } else if (kind.types.includes("integer") && /^-?\d+$/.test(raw.trim())) {
          parent[prop.key] = Number(raw.trim());
        } else {
          parent[prop.key] = raw;
        }
        onChange();
      });
      input.placeholder = "a number, or a raw CSS track list e.g. \"2fr 1fr\"";
      return wrapRow(label, description, input, document);
    }

    case "condition":
    case "unknown": {
      const textarea = document.createElement("textarea");
      textarea.rows = 2;
      textarea.value = stringifyUnknown(parent[prop.key]);
      textarea.placeholder = kind.kind === "condition" ? "raw JSON condition object (see the schema's own docs for the shape)" : "value (JSON if not a plain string)";
      textarea.addEventListener("input", () => {
        parent[prop.key] = coerceUnknown(textarea.value);
        onChange();
      });
      return wrapRow(label, description, textarea, document);
    }

    case "objectArray": {
      const control = renderObjectArrayControl(prop.key, kind.itemProperties, parent, onChange, document);
      return wrapRow(label, description, control, document);
    }

    case "object": {
      const control = renderPresenceToggledEditor(
        prop.key,
        parent,
        onChange,
        document,
        (nested, notify) => renderObjectEditor(kind.properties, nested, notify, document)
      );
      return wrapRow(label, description, control, document);
    }

    case "dictionary": {
      const control = renderPresenceToggledEditor(prop.key, parent, onChange, document, (nested, notify) =>
        renderDictionaryBody(kind.valueKind, kind.valueProperties, nested, notify, document)
      );
      return wrapRow(label, description, control, document);
    }

    default:
      return wrapRow(label, description, document.createTextNode("") as unknown as HTMLElement, document);
  }
}

export type PropertyControlOverrides = Record<string, (prop: SchemaProperty, parent: Record<string, unknown>, onChange: ChangeHandler, document: Document) => HTMLElement>;

/**
 * Builds one object's full property editor — one row per property, in
 * schema order. This is the module's main recursive entry point: object-kind
 * and dictionary-of-object-kind properties both eventually call back into
 * this for their nested shape.
 *
 * `overrides` (keyed by property key) lets a caller swap in a smarter
 * control for a specific, well-known key without forking the whole
 * generic renderer — e.g. lib/builder/fieldEditor.ts renders `bindTo` as a
 * dropdown of the target list's real live columns instead of a freeform
 * text box. Everything not named in `overrides` still comes purely from
 * the schema, so this stays a deliberate, narrow exception rather than a
 * second parallel rendering path.
 */
export function renderObjectEditor(
  properties: SchemaProperty[],
  value: Record<string, unknown>,
  onChange: ChangeHandler,
  document: Document,
  overrides?: PropertyControlOverrides
): HTMLElement {
  const container = document.createElement("div");
  container.className = "skye-builder__object";
  for (const prop of properties) {
    const render = overrides?.[prop.key] ?? renderPropertyControl;
    container.appendChild(render(prop, value, onChange, document));
  }
  return container;
}

/**
 * Wraps an optional nested-object-shaped property (fileStorage, style,
 * attributes, validationMessages, calculatedDisplay, table, relatedList,
 * layout, a postAction's request, a dictionary like columns/headers/params,
 * ...) behind an explicit "set this" checkbox. Deliberately does NOT
 * eagerly create `parent[key] = {}` just because the property exists on
 * the schema — most of these have their OWN required sub-keys (e.g.
 * calculatedExpression needs `op`; lookupTable needs `relatedList`/
 * `linkMode`/`columns`), so eagerly instantiating one for every field
 * regardless of controlType would make nearly every field fail schema
 * validation on Save. The checkbox is the one place presence is decided.
 */
function renderPresenceToggledEditor(
  key: string,
  parent: Record<string, unknown>,
  onChange: ChangeHandler,
  document: Document,
  buildBody: (nested: Record<string, unknown>, notify: ChangeHandler) => HTMLElement
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "skye-builder__nested";

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "skye-builder__toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = typeof parent[key] === "object" && parent[key] !== null;
  toggleLabel.appendChild(checkbox);
  toggleLabel.append(" set");
  wrapper.appendChild(toggleLabel);

  const body = document.createElement("div");
  body.className = "skye-builder__nested-body";
  wrapper.appendChild(body);

  function renderBody(): void {
    body.innerHTML = "";
    if (!checkbox.checked) return;
    if (typeof parent[key] !== "object" || parent[key] === null) parent[key] = {};
    body.appendChild(buildBody(parent[key] as Record<string, unknown>, onChange));
  }

  checkbox.addEventListener("change", () => {
    if (!checkbox.checked) delete parent[key];
    renderBody();
    onChange();
  });

  renderBody();
  return wrapper;
}

/** Repeatable add/remove rows for an "objectArray"-classified property (e.g. a select/radio/checkboxGroup field's `options`). Each row is its own mini object editor built from the array items' own schema properties. */
function renderObjectArrayControl(key: string, itemProperties: SchemaProperty[], parent: Record<string, unknown>, onChange: ChangeHandler, document: Document): HTMLElement {
  const container = document.createElement("div");
  container.className = "skye-builder__array";

  const list = document.createElement("div");
  container.appendChild(list);

  function items(): Record<string, unknown>[] {
    if (!Array.isArray(parent[key])) parent[key] = [];
    return parent[key] as Record<string, unknown>[];
  }

  function renderList(): void {
    list.innerHTML = "";
    items().forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "skye-builder__array-item";
      row.appendChild(renderObjectEditor(itemProperties, item, onChange, document));

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        items().splice(index, 1);
        if (items().length === 0) parent[key] = undefined;
        onChange();
        renderList();
      });
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "+ Add";
  addBtn.addEventListener("click", () => {
    items().push({});
    onChange();
    renderList();
  });
  container.appendChild(addBtn);

  renderList();
  return container;
}

/** This schema's shared key pattern for every dictionary-of-named-things (`pages`, `fields`, `postActions`, `table.columns`): a letter, then letters/digits/underscore. */
const DICTIONARY_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Named add/remove entries, each a full nested object editor built from
 * `itemProperties` — the top-level counterpart to the "dictionary" case
 * inside renderPropertyControl (that one stays behind a presence toggle
 * since it's just one optional property among many; this one is used
 * directly for the builder's dedicated Pages/Post Actions sections, which
 * are always shown). `itemProperties` can be a plain list (pages) or a
 * function of the current entry (postActions, whose real editable
 * properties depend on its own `type` — see postActionsEditor.ts) so a
 * caller can re-derive them after a structural change to one entry.
 */
export function renderNamedObjectDictionary(
  itemProperties: SchemaProperty[] | ((entryKey: string, entry: Record<string, unknown>) => SchemaProperty[]),
  dict: Record<string, unknown>,
  onChange: ChangeHandler,
  document: Document,
  opts?: { overridesFor?: (entryKey: string, rerenderEntry: () => void) => PropertyControlOverrides | undefined }
): HTMLElement {
  const root = document.createElement("div");
  root.className = "skye-builder__dict";
  const entries = document.createElement("div");
  root.appendChild(entries);

  function propertiesFor(entryKey: string): SchemaProperty[] {
    const entry = dict[entryKey] as Record<string, unknown>;
    return typeof itemProperties === "function" ? itemProperties(entryKey, entry) : itemProperties;
  }

  function renderEntries(): void {
    entries.innerHTML = "";
    for (const entryKey of Object.keys(dict)) {
      const row = document.createElement("div");
      row.className = "skye-builder__dict-entry";

      const heading = document.createElement("div");
      heading.className = "skye-builder__dict-entry-heading";
      heading.textContent = entryKey;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        delete dict[entryKey];
        onChange();
        renderEntries();
      });
      heading.appendChild(removeBtn);
      row.appendChild(heading);

      const body = document.createElement("div");
      row.appendChild(body);
      const rerenderEntry = () => {
        body.innerHTML = "";
        if (typeof dict[entryKey] !== "object" || dict[entryKey] === null) dict[entryKey] = {};
        body.appendChild(renderObjectEditor(propertiesFor(entryKey), dict[entryKey] as Record<string, unknown>, onChange, document, opts?.overridesFor?.(entryKey, rerenderEntry)));
      };
      rerenderEntry();

      entries.appendChild(row);
    }
  }

  const addRow = document.createElement("div");
  addRow.className = "skye-builder__dict-add";
  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.placeholder = "key (letters, digits, underscore; must start with a letter)";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "+ Add";
  const errorEl = document.createElement("span");
  errorEl.className = "skye-builder__dict-add-error";
  addBtn.addEventListener("click", () => {
    const newKey = keyInput.value.trim();
    errorEl.textContent = "";
    if (!DICTIONARY_KEY_PATTERN.test(newKey)) {
      errorEl.textContent = "Key must start with a letter and contain only letters, digits, underscore.";
      return;
    }
    if (newKey in dict) {
      errorEl.textContent = "That key already exists.";
      return;
    }
    dict[newKey] = {};
    keyInput.value = "";
    onChange();
    renderEntries();
  });
  addRow.append(keyInput, addBtn, errorEl);
  root.appendChild(addRow);

  renderEntries();
  return root;
}

/**
 * Body of a "dictionary"-classified property — named add/remove entries,
 * each either a plain string value (headers/params-shaped), a full nested
 * object (columns/pages/postActions-shaped, built from `valueProperties`),
 * or a best-effort JSON/string value ("any"-shaped, e.g. a request body
 * template with no fixed structure).
 */
function renderDictionaryBody(
  valueKind: "string" | "object" | "any",
  valueProperties: SchemaProperty[] | undefined,
  dict: Record<string, unknown>,
  onChange: ChangeHandler,
  document: Document
): HTMLElement {
  const root = document.createElement("div");
  root.className = "skye-builder__dict";

  const entries = document.createElement("div");
  root.appendChild(entries);

  function renderEntries(): void {
    entries.innerHTML = "";
    for (const entryKey of Object.keys(dict)) {
      const row = document.createElement("div");
      row.className = "skye-builder__dict-entry";

      const heading = document.createElement("div");
      heading.className = "skye-builder__dict-entry-heading";
      heading.textContent = entryKey;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        delete dict[entryKey];
        onChange();
        renderEntries();
      });
      heading.appendChild(removeBtn);
      row.appendChild(heading);

      if (valueKind === "string") {
        const input = textInput(document, String(dict[entryKey] ?? ""), (raw) => {
          dict[entryKey] = raw;
          onChange();
        });
        row.appendChild(input);
      } else if (valueKind === "object" && valueProperties) {
        if (typeof dict[entryKey] !== "object" || dict[entryKey] === null) dict[entryKey] = {};
        row.appendChild(renderObjectEditor(valueProperties, dict[entryKey] as Record<string, unknown>, onChange, document));
      } else {
        const textarea = document.createElement("textarea");
        textarea.rows = 2;
        textarea.value = stringifyUnknown(dict[entryKey]);
        textarea.addEventListener("input", () => {
          dict[entryKey] = coerceUnknown(textarea.value);
          onChange();
        });
        row.appendChild(textarea);
      }
      entries.appendChild(row);
    }
  }

  const addRow = document.createElement("div");
  addRow.className = "skye-builder__dict-add";
  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.placeholder = "key";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "+ Add";
  addBtn.addEventListener("click", () => {
    const newKey = keyInput.value.trim();
    if (!newKey || newKey in dict) return;
    dict[newKey] = valueKind === "object" ? {} : "";
    keyInput.value = "";
    onChange();
    renderEntries();
  });
  addRow.append(keyInput, addBtn);
  root.appendChild(addRow);

  renderEntries();
  return root;
}
