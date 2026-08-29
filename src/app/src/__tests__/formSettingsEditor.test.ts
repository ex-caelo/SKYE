import { describe, it, expect } from "vitest";
import type { FormConfig } from "@skye/config";
import { renderFormSettingsEditor } from "../lib/builder/formSettingsEditor.js";

function makeConfig(): FormConfig {
  return { title: "Test", list: { id: "list1" }, pages: {}, fields: {} };
}

describe("renderFormSettingsEditor", () => {
  it("renders form-level settings (title etc.) that write straight back into the config", () => {
    const config = makeConfig();
    const el = renderFormSettingsEditor(config, () => {}, document);
    const titleRow = Array.from(el.querySelectorAll(".skye-builder__row")).find((r) => r.querySelector("label")?.textContent?.startsWith("Title"))!;
    const input = titleRow.querySelector("input") as HTMLInputElement;
    input.value = "Renamed";
    input.dispatchEvent(new Event("input"));
    expect(config.title).toBe("Renamed");
  });

  it("adds a new page via the Pages dictionary editor", () => {
    const config = makeConfig();
    let changes = 0;
    const el = renderFormSettingsEditor(config, () => changes++, document);
    const keyInput = el.querySelector(".skye-builder__dict-add input") as HTMLInputElement;
    const addBtn = el.querySelector(".skye-builder__dict-add button") as HTMLButtonElement;
    keyInput.value = "main";
    addBtn.click();
    expect(config.pages.main).toEqual({});
    expect(changes).toBeGreaterThan(0);
  });

  it("rejects an invalid page key (must start with a letter) without adding it", () => {
    const config = makeConfig();
    const el = renderFormSettingsEditor(config, () => {}, document);
    const keyInput = el.querySelector(".skye-builder__dict-add input") as HTMLInputElement;
    const addBtn = el.querySelector(".skye-builder__dict-add button") as HTMLButtonElement;
    keyInput.value = "1bad";
    addBtn.click();
    expect(Object.keys(config.pages)).toHaveLength(0);
  });

  it("adding a postAction and choosing its type reveals that type's own payload properties (e.g. redirect's 'to')", () => {
    const config = makeConfig();
    const el = renderFormSettingsEditor(config, () => {}, document);
    const dictSections = el.querySelectorAll(".skye-builder__dict");
    const postActionsDict = dictSections[1]; // pages dict is [0], postActions dict is [1]
    const keyInput = postActionsDict.querySelector(".skye-builder__dict-add input") as HTMLInputElement;
    const addBtn = postActionsDict.querySelector(".skye-builder__dict-add button") as HTMLButtonElement;
    keyInput.value = "goToOutlook";
    addBtn.click();

    const entry = postActionsDict.querySelector(".skye-builder__dict-entry")!;
    const typeRow = Array.from(entry.querySelectorAll(".skye-builder__row")).find((r) => r.querySelector("label")?.textContent?.startsWith("Type"))!;
    const typeSelect = typeRow.querySelector("select") as HTMLSelectElement;
    expect(Array.from(entry.querySelectorAll(".skye-builder__row")).some((r) => r.querySelector("label")?.textContent?.startsWith("To"))).toBe(false);

    typeSelect.value = "redirect";
    typeSelect.dispatchEvent(new Event("change"));

    const toRow = Array.from(entry.querySelectorAll(".skye-builder__row")).find((r) => r.querySelector("label")?.textContent?.startsWith("To"));
    expect(toRow).toBeTruthy();
    expect(config.postActions!.goToOutlook.type).toBe("redirect");
  });
});
