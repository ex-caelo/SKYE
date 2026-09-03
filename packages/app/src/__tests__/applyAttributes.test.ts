import { describe, it, expect, vi } from "vitest";
import { applyAttributes, applyStyle } from "../features/form/render/applyAttributes.js";

describe("applyAttributes", () => {
  it("applies plain string/number attributes", () => {
    const el = document.createElement("input");
    applyAttributes(el, { placeholder: "Jane Doe", maxlength: 255 });
    expect(el.getAttribute("placeholder")).toBe("Jane Doe");
    expect(el.getAttribute("maxlength")).toBe("255");
  });

  it("treats boolean attributes as present/absent, not string true/false", () => {
    const el = document.createElement("input");
    applyAttributes(el, { required: true, disabled: false });
    expect(el.hasAttribute("required")).toBe(true);
    expect(el.hasAttribute("disabled")).toBe(false);
  });

  it("skips undefined/null values", () => {
    const el = document.createElement("input");
    applyAttributes(el, { placeholder: undefined, min: null });
    expect(el.hasAttribute("placeholder")).toBe(false);
    expect(el.hasAttribute("min")).toBe(false);
  });

  it("REFUSES to set any on* attribute, regardless of case, and warns instead of throwing", () => {
    const el = document.createElement("input");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyAttributes(el, { onclick: "alert(1)", onerror: "steal()", ONMOUSEOVER: "x" } as Record<string, unknown>);
    expect(el.hasAttribute("onclick")).toBe(false);
    expect(el.hasAttribute("onerror")).toBe(false);
    expect(el.hasAttribute("onmouseover")).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    warnSpy.mockRestore();
  });
});

describe("applyStyle", () => {
  it("applies camelCase style properties via CSSStyleDeclaration", () => {
    const el = document.createElement("div");
    applyStyle(el, { color: "#6b7280", fontWeight: 600 });
    expect(el.style.color).toBe("rgb(107, 114, 128)");
    expect(el.style.fontWeight).toBe("600");
  });
});
