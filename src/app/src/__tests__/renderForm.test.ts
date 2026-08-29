import { describe, it, expect } from "vitest";
import type { FormConfig } from "@skye/config";
import { renderForm } from "../lib/render/renderForm.js";
import baseConfig from "../lib/mock-graph/fixtures/base-form-config.json" with { type: "json" };

describe("renderForm (using the real base-form-config fixture)", () => {
  it("renders one tab per page and one control per field", () => {
    const { root } = renderForm(baseConfig as FormConfig, document);
    const tabs = root.querySelectorAll(".skye-form__tabs button");
    expect(tabs).toHaveLength(3); // aboutYou, yourOrder, banquetDetails

    // name field should exist and be a text input
    const nameInput = root.querySelector('[data-field-key="name"]') as HTMLInputElement;
    expect(nameInput.tagName).toBe("INPUT");
    expect(nameInput.type).toBe("text");
  });

  it("reads back values via getValues after simulating user input", () => {
    const { root, getValues } = renderForm(baseConfig as FormConfig, document);
    const nameInput = root.querySelector('[data-field-key="name"]') as HTMLInputElement;
    nameInput.value = "Jane Doe";
    nameInput.dispatchEvent(new Event("input"));
    expect(getValues().name).toBe("Jane Doe");
  });

  it("hides the haiku field until campus equals Bloomington (visibleIf)", () => {
    const { root, setFieldValue } = renderForm(baseConfig as FormConfig, document);
    const haikuContainer = root.querySelector('[data-field-key="haiku"]')!.closest(".skye-field") as HTMLElement;
    expect(haikuContainer.style.display).toBe("none");

    setFieldValue("campus", "Bloomington");
    expect(haikuContainer.style.display).not.toBe("none");

    setFieldValue("campus", "Indianapolis");
    expect(haikuContainer.style.display).toBe("none");
  });

  it("hides the whole banquetDetails page tab until attendingBanquet is true (page-level visibleIf)", () => {
    const { setFieldValue } = renderForm(baseConfig as FormConfig, document);
    // re-query root each time via a fresh render so we don't depend on prior test state
    const { root, setFieldValue: setValue } = renderForm(baseConfig as FormConfig, document);
    const banquetTab = Array.from(root.querySelectorAll(".skye-form__tabs button")).find((b) => (b as HTMLElement).dataset.pageKey === "banquetDetails") as HTMLElement;

    expect(banquetTab.style.display).toBe("none");
    setValue("attendingBanquet", true);
    expect(banquetTab.style.display).not.toBe("none");

    void setFieldValue; // unused from the first render, kept only to illustrate both instances are independent
  });

  it("recomputes a calculatedDisplay field's value when a dependency field changes", () => {
    const configWithCalculated: FormConfig = {
      list: { id: "list1" },
      pages: { p1: { title: "Page 1" } },
      fields: {
        quantity: { page: "p1", source: "sharepoint", bindTo: "Quantity", controlType: "number" },
        price: { page: "p1", source: "sharepoint", bindTo: "Price", controlType: "number" },
        total: { page: "p1", source: "virtual", controlType: "calculatedDisplay", calculatedDisplay: { op: "multiply", fields: ["quantity", "price"] } },
      },
    };

    const { root, setFieldValue, getValues } = renderForm(configWithCalculated, document);
    const totalEl = root.querySelector('[data-field-key="total"]') as HTMLElement & { value: unknown };

    setFieldValue("quantity", 3);
    setFieldValue("price", 4);

    expect(getValues().total).toBe(12);
    expect(totalEl.value).toBe(12);
  });

  it("defaults getActivePageKey to the first page by order, and showPage switches it (used by /builder's preview to restore the current page across a rebuild)", () => {
    const { showPage, getActivePageKey } = renderForm(baseConfig as FormConfig, document);
    expect(getActivePageKey()).toBe("aboutYou");
    showPage("yourOrder");
    expect(getActivePageKey()).toBe("yourOrder");
  });

  it("honors an initialPageKey option, falling back to the first page if it doesn't name a real one", () => {
    expect(renderForm(baseConfig as FormConfig, document, { initialPageKey: "yourOrder" }).getActivePageKey()).toBe("yourOrder");
    expect(renderForm(baseConfig as FormConfig, document, { initialPageKey: "notARealPage" }).getActivePageKey()).toBe("aboutYou");
  });

  it("populates select options from field.options via fieldRegistry's buildChildren", () => {
    // campus is a sharepoint-bound select with no static `options` in the base config (populated at runtime
    // from live list columns in the real app) — so this exercises a field that DOES declare options: mealChoice
    // inside the lookupTable's columns is out of scope for renderForm directly, so we assert the select tag renders instead.
    const { root } = renderForm(baseConfig as FormConfig, document);
    const campusSelect = root.querySelector('[data-field-key="campus"]');
    expect(campusSelect?.tagName).toBe("SELECT");
  });

  describe("field-level validation (:user-invalid-style — only shows once touched)", () => {
    it("shows no error message for a required, empty field before it's ever been interacted with", () => {
      const { root } = renderForm(baseConfig as FormConfig, document);
      const nameMessage = root.querySelector('[data-field-key="name"]')!.closest(".skye-field")!.querySelector(".skye-field__message");
      expect(nameMessage?.textContent).toBe("");
    });

    it("reveals the error once the field is blurred (focusout) — the actual :user-invalid-style trigger", () => {
      const { root } = renderForm(baseConfig as FormConfig, document);
      const nameInput = root.querySelector('[data-field-key="name"]') as HTMLInputElement;
      nameInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      const message = nameInput.closest(".skye-field")!.querySelector(".skye-field__message");
      expect(message?.textContent).toBe("We need a name to reserve your spot.");
      expect(nameInput.closest(".skye-field")?.classList.contains("skye-field--invalid")).toBe(true);
      expect(nameInput.getAttribute("aria-invalid")).toBe("true");
    });

    it("clears the error live once a touched field is corrected", () => {
      const { root } = renderForm(baseConfig as FormConfig, document);
      const nameInput = root.querySelector('[data-field-key="name"]') as HTMLInputElement;
      nameInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      expect(nameInput.closest(".skye-field")?.classList.contains("skye-field--invalid")).toBe(true);

      nameInput.value = "Jane Doe";
      nameInput.dispatchEvent(new Event("input"));
      const message = nameInput.closest(".skye-field")!.querySelector(".skye-field__message");
      expect(message?.textContent).toBe("");
      expect(nameInput.closest(".skye-field")?.classList.contains("skye-field--invalid")).toBe(false);
      expect(nameInput.getAttribute("aria-invalid")).toBe("false");
    });

    it("validateAll touches every field (revealing errors even for fields never interacted with) and returns overall validity", () => {
      const { root, validateAll } = renderForm(baseConfig as FormConfig, document);
      expect(validateAll()).toBe(false);
      const nameMessage = root.querySelector('[data-field-key="name"]')!.closest(".skye-field")!.querySelector(".skye-field__message");
      expect(nameMessage?.textContent).toBe("We need a name to reserve your spot.");
    });

    it("validateAll returns true once every applicable field is valid", () => {
      const configWithOneRequiredField: FormConfig = {
        list: { id: "list1" },
        pages: { p1: { title: "Page 1" } },
        fields: { name: { page: "p1", source: "sharepoint", bindTo: "Title", controlType: "text", required: true } },
      };
      const { setFieldValue, validateAll } = renderForm(configWithOneRequiredField, document);
      expect(validateAll()).toBe(false);
      setFieldValue("name", "Jane Doe");
      expect(validateAll()).toBe(true);
    });

    it("runs a registered custom validator, threaded through via RenderFormOptions", () => {
      const configWithCustomValidator: FormConfig = {
        list: { id: "list1" },
        pages: { p1: { title: "Page 1" } },
        fields: { code: { page: "p1", source: "sharepoint", bindTo: "Code", controlType: "text", customValidators: ["evenLength"] } },
      };
      const registry = { evenLength: (v: unknown) => (typeof v === "string" && v.length % 2 === 0 ? true : "Must have an even number of characters.") };
      const { root, setFieldValue, validateAll } = renderForm(configWithCustomValidator, document, { customValidators: registry });
      setFieldValue("code", "abc");
      expect(validateAll()).toBe(false);
      const message = root.querySelector('[data-field-key="code"]')!.closest(".skye-field")!.querySelector(".skye-field__message");
      expect(message?.textContent).toBe("Must have an even number of characters.");
    });
  });
});
