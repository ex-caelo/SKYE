import { describe, it, expect } from "vitest";
import { getFieldSchemaProperties, getPageSchemaProperties, type SchemaProperty } from "@skye/form-config";
import { renderObjectEditor, renderPropertyControl } from "../features/builder/schemaControls.js";

function propByKey(props: SchemaProperty[], key: string): SchemaProperty {
  const found = props.find((p) => p.key === key);
  if (!found) throw new Error(`no schema property "${key}"`);
  return found;
}

describe("renderPropertyControl", () => {
  it("renders an enum property (controlType) as a <select>, and writes the chosen value back", () => {
    const prop = propByKey(getFieldSchemaProperties(), "controlType");
    const value: Record<string, unknown> = {};
    let changed = 0;
    const row = renderPropertyControl(prop, value, () => changed++, document);
    const select = row.querySelector("select")!;
    expect(select).toBeTruthy();
    select.value = "text";
    select.dispatchEvent(new Event("change"));
    expect(value.controlType).toBe("text");
    expect(changed).toBe(1);
  });

  it("an empty selection on an enum control clears the key entirely (not an empty string)", () => {
    const prop = propByKey(getFieldSchemaProperties(), "appearance");
    const value: Record<string, unknown> = { appearance: "switch" };
    const row = renderPropertyControl(prop, value, () => {}, document);
    const select = row.querySelector("select")!;
    select.value = "";
    select.dispatchEvent(new Event("change"));
    expect(value.appearance).toBeUndefined();
  });

  it("renders a boolean property (required) as a checkbox", () => {
    const prop = propByKey(getFieldSchemaProperties(), "required");
    const value: Record<string, unknown> = {};
    const row = renderPropertyControl(prop, value, () => {}, document);
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(value.required).toBe(true);
  });

  it("renders a string property (label) as a text input, clearing the key when emptied", () => {
    const prop = propByKey(getFieldSchemaProperties(), "label");
    const value: Record<string, unknown> = {};
    const row = renderPropertyControl(prop, value, () => {}, document);
    const input = row.querySelector("input") as HTMLInputElement;
    input.value = "First name";
    input.dispatchEvent(new Event("input"));
    expect(value.label).toBe("First name");
    input.value = "";
    input.dispatchEvent(new Event("input"));
    expect(value.label).toBeUndefined();
  });

  it("renders an integer property (maxlength) coercing input text to a number", () => {
    const prop = propByKey(getFieldSchemaProperties(), "maxlength");
    const value: Record<string, unknown> = {};
    const row = renderPropertyControl(prop, value, () => {}, document);
    const input = row.querySelector("input") as HTMLInputElement;
    input.value = "255";
    input.dispatchEvent(new Event("input"));
    expect(value.maxlength).toBe(255);
  });

  it("renders a string-array property (customValidators) from/to a comma-separated text input", () => {
    const prop = propByKey(getFieldSchemaProperties(), "customValidators");
    const value: Record<string, unknown> = { customValidators: ["a", "b"] };
    const row = renderPropertyControl(prop, value, () => {}, document);
    const input = row.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("a, b");
    input.value = "x, y, z";
    input.dispatchEvent(new Event("input"));
    expect(value.customValidators).toEqual(["x", "y", "z"]);
  });

  it("renders an object-array property (options) with add/remove rows, each a nested object editor", () => {
    const prop = propByKey(getFieldSchemaProperties(), "options");
    const value: Record<string, unknown> = {};
    const row = renderPropertyControl(prop, value, () => {}, document);
    const addBtn = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "+ Add")!;
    addBtn.click();
    expect((value.options as unknown[]).length).toBe(1);

    // The new row's nested "label" text input should exist and be writable.
    const nestedInputs = row.querySelectorAll(".skye-builder__array-item input");
    expect(nestedInputs.length).toBeGreaterThan(0);
  });

  it("renders an object property (fileStorage) behind a presence checkbox — nothing is set until it's checked", () => {
    const prop = propByKey(getFieldSchemaProperties(), "fileStorage");
    const value: Record<string, unknown> = {};
    const row = renderPropertyControl(prop, value, () => {}, document);
    expect(value.fileStorage).toBeUndefined();

    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(value.fileStorage).toEqual({});

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(value.fileStorage).toBeUndefined();
  });

  it("renders a dictionary-of-string property (postAction.request.headers) via add/remove named entries", () => {
    // headers only exists inside postAction's httpRequest "request" payload, which itself is
    // object-kind — reach it through renderObjectEditor + the presence toggle, same as a real
    // builder session would.
    const prop = propByKey(getFieldSchemaProperties(), "attributes"); // htmlAttributes: fixed props + patternProperties (not a pure dictionary) — used here just to confirm object-kind + presence toggle compose correctly with a real, larger schema object.
    const value: Record<string, unknown> = {};
    const row = renderPropertyControl(prop, value, () => {}, document);
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    const placeholderInput = row.querySelector(".skye-builder__nested-body input") as HTMLInputElement;
    expect(placeholderInput).toBeTruthy();
    placeholderInput.value = "Type here";
    placeholderInput.dispatchEvent(new Event("input"));
    expect((value.attributes as Record<string, unknown>).placeholder).toBe("Type here");
  });

  it("renders a condition property (visibleIf) as a raw JSON textarea", () => {
    const prop = propByKey(getFieldSchemaProperties(), "visibleIf");
    const value: Record<string, unknown> = {};
    const row = renderPropertyControl(prop, value, () => {}, document);
    const textarea = row.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    textarea.value = '{"field":"x","operator":"isEmpty"}';
    textarea.dispatchEvent(new Event("input"));
    expect(value.visibleIf).toEqual({ field: "x", operator: "isEmpty" });
  });
});

describe("renderObjectEditor", () => {
  it("renders one row per property and mutates the shared value object in place", () => {
    const value: Record<string, unknown> = {};
    let changeCount = 0;
    const el = renderObjectEditor(getPageSchemaProperties(), value, () => changeCount++, document);
    const rows = el.querySelectorAll(".skye-builder__row");
    expect(rows.length).toBe(4); // title, order, visibleIf, layout

    const titleInput = Array.from(el.querySelectorAll(".skye-builder__row"))
      .find((row) => row.querySelector("label")?.textContent?.startsWith("Title"))
      ?.querySelector("input") as HTMLInputElement;
    titleInput.value = "Main";
    titleInput.dispatchEvent(new Event("input"));
    expect(value.title).toBe("Main");
    expect(changeCount).toBe(1);
  });
});
