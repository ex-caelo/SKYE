import { describe, it, expect } from "vitest";
import type { FormConfig } from "@skye/config";
import { renderFormSettingsEditor } from "../lib/builder/formSettingsEditor.js";
import type { GraphListColumn } from "../lib/graph/types.js";

function makeConfig(): FormConfig {
  return { title: "Test", list: { id: "list1" }, pages: {}, fields: {} };
}

const REQUIRED_COLUMNS: GraphListColumn[] = [
  { name: "Title", displayName: "Title", columnType: "text", required: true },
  { name: "Start_x0020_Date", displayName: "Start Date", columnType: "dateTime", required: true },
  { name: "Notes", displayName: "Notes", columnType: "note" },
];

const ACTION_NAMES = ["teams.sendMessage", "teams.createChat", "outlook.sendEmail", "engage.createEvent"];

/** Finds a trigger-phase <section> by its heading text. */
function phaseSection(root: HTMLElement, label: string): HTMLElement {
  const section = Array.from(root.querySelectorAll<HTMLElement>("section.skye-builder__phase")).find(
    (s) => s.querySelector("h4")?.textContent === label
  );
  if (!section) throw new Error(`no phase section titled "${label}"`);
  return section;
}

/**
 * Adds an action with the given key inside a phase section and returns its
 * (freshly re-queried) card element — adding triggers a full re-render, so
 * the section/card the test held before is detached.
 */
function addAction(root: HTMLElement, phaseLabel: string, key: string): HTMLElement {
  const addRow = phaseSection(root, phaseLabel).querySelector(".skye-builder__phase-add")!;
  (addRow.querySelector("input") as HTMLInputElement).value = key;
  (addRow.querySelector("button") as HTMLButtonElement).click();
  const card = Array.from(phaseSection(root, phaseLabel).querySelectorAll<HTMLElement>(".skye-builder__action-card")).find(
    (c) => c.dataset.actionKey === key
  );
  if (!card) throw new Error(`card "${key}" not found after add`);
  return card;
}

function rowByLabel(card: HTMLElement, prefix: string): HTMLElement | undefined {
  return Array.from(card.querySelectorAll<HTMLElement>(".skye-builder__row")).find((r) => r.querySelector("label")?.textContent?.startsWith(prefix));
}

describe("renderFormSettingsEditor — form settings + pages", () => {
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
});

describe("renderFormSettingsEditor — missing required SharePoint columns", () => {
  it("is not shown without the requiredColumnCheck option", () => {
    const el = renderFormSettingsEditor(makeConfig(), () => {}, document, { listColumns: REQUIRED_COLUMNS });
    expect(el.querySelector(".skye-builder__required-warn")).toBeNull();
  });

  it("lists each required column that no field binds to, and an 'Add all' when more than one", () => {
    const el = renderFormSettingsEditor(makeConfig(), () => {}, document, { listColumns: REQUIRED_COLUMNS, requiredColumnCheck: true, defaultPageKey: "main" });
    const panel = el.querySelector(".skye-builder__required-warn") as HTMLElement;
    expect(panel.hidden).toBe(false);
    const items = Array.from(panel.querySelectorAll("li span")).map((s) => s.textContent);
    expect(items).toEqual(["Title", "Start Date (Start_x0020_Date)"]); // Notes is not required
    expect(panel.querySelector(".skye-builder__required-addall")?.textContent).toBe("Add all 2 fields");
  });

  it("'Add field' drops in a correctly-shaped source:sharepoint field and calls onFieldsChanged", () => {
    const config = makeConfig();
    let fieldsChanged = 0;
    const el = renderFormSettingsEditor(config, () => {}, document, {
      listColumns: REQUIRED_COLUMNS,
      requiredColumnCheck: true,
      defaultPageKey: "main",
      onFieldsChanged: () => fieldsChanged++,
    });
    const panel = el.querySelector(".skye-builder__required-warn")!;
    const startRow = Array.from(panel.querySelectorAll("li")).find((li) => li.textContent?.includes("Start_x0020_Date"))!;
    (startRow.querySelector("button") as HTMLButtonElement).click();

    const added = Object.values(config.fields).find((f) => (f as { bindTo?: string }).bindTo === "Start_x0020_Date")!;
    expect(added).toMatchObject({ source: "sharepoint", bindTo: "Start_x0020_Date", controlType: "date", label: "Start Date", required: true, page: "main" });
    expect(fieldsChanged).toBe(1);
  });

  it("'Add all' covers every missing required column at once and then hides itself", () => {
    const config = makeConfig();
    const el = renderFormSettingsEditor(config, () => {}, document, { listColumns: REQUIRED_COLUMNS, requiredColumnCheck: true, defaultPageKey: "main" });
    const panel = el.querySelector(".skye-builder__required-warn") as HTMLElement;
    (panel.querySelector(".skye-builder__required-addall") as HTMLButtonElement).click();

    const boundColumns = Object.values(config.fields).map((f) => (f as { bindTo?: string }).bindTo);
    expect(boundColumns).toEqual(expect.arrayContaining(["Title", "Start_x0020_Date"]));
    expect(panel.hidden).toBe(true); // nothing missing anymore
  });

  it("counts a field with no explicit source as covering its required column (schema default is sharepoint)", () => {
    const config = makeConfig();
    config.fields = { t: { bindTo: "Title", controlType: "text" }, s: { bindTo: "Start_x0020_Date", controlType: "date" } };
    const el = renderFormSettingsEditor(config, () => {}, document, { listColumns: REQUIRED_COLUMNS, requiredColumnCheck: true });
    expect((el.querySelector(".skye-builder__required-warn") as HTMLElement).hidden).toBe(true);
  });
});

describe("renderFormSettingsEditor — post actions grouped by trigger phase", () => {
  it("renders a section for each of the four trigger phases", () => {
    const el = renderFormSettingsEditor(makeConfig(), () => {}, document);
    const titles = Array.from(el.querySelectorAll("section.skye-builder__phase h4")).map((h) => h.textContent);
    expect(titles).toEqual(["Before submit", "After submit", "On success", "On error"]);
  });

  it("adding an action inside a phase section presets its trigger and files it under that section", () => {
    const config = makeConfig();
    const el = renderFormSettingsEditor(config, () => {}, document);
    addAction(el, "After submit", "notify");
    expect(config.postActions!.notify.trigger).toBe("afterSubmit");
    // the card lives in the After-submit section, not any other
    const inAfter = phaseSection(el, "After submit").querySelector('.skye-builder__action-card[data-action-key="notify"]');
    const inBefore = phaseSection(el, "Before submit").querySelector('.skye-builder__action-card[data-action-key="notify"]');
    expect(inAfter).toBeTruthy();
    expect(inBefore).toBeNull();
  });

  it("choosing type 'script' renders functionName as a dropdown of the real registered actions, grouped by service", () => {
    const config = makeConfig();
    const el = renderFormSettingsEditor(config, () => {}, document, { scriptActionNames: ACTION_NAMES });
    const card = addAction(el, "After submit", "runIt");

    const typeSelect = rowByLabel(card, "Type")!.querySelector("select") as HTMLSelectElement;
    typeSelect.value = "script";
    typeSelect.dispatchEvent(new Event("change"));

    const fnRow = rowByLabel(card, "Function name")!;
    const fnControl = fnRow.querySelector("select") as HTMLSelectElement;
    expect(fnControl).toBeTruthy();
    expect(fnRow.querySelector("input")).toBeNull(); // not a free-text box
    expect(Array.from(fnControl.querySelectorAll("optgroup")).map((g) => g.label)).toEqual(["teams", "outlook", "engage"]);
    expect(Array.from(fnControl.querySelectorAll("option")).map((o) => o.value)).toContain("engage.createEvent");

    fnControl.value = "engage.createEvent";
    fnControl.dispatchEvent(new Event("change"));
    expect(config.postActions!.runIt.functionName).toBe("engage.createEvent");
  });

  it("choosing type 'redirect' still reveals that type's own payload (the 'To' field)", () => {
    const config = makeConfig();
    const el = renderFormSettingsEditor(config, () => {}, document);
    const card = addAction(el, "On success", "go");
    const typeSelect = rowByLabel(card, "Type")!.querySelector("select") as HTMLSelectElement;
    typeSelect.value = "redirect";
    typeSelect.dispatchEvent(new Event("change"));
    expect(rowByLabel(card, "To")).toBeTruthy();
    expect(config.postActions!.go.type).toBe("redirect");
  });

  it("dependsOn is a checkbox list of the other actions in the same phase, and drives the sequencing view", () => {
    const config = makeConfig();
    const el = renderFormSettingsEditor(config, () => {}, document);
    addAction(el, "After submit", "first");
    const second = addAction(el, "After submit", "second");

    // "Runs after" row on `second` should offer `first` as a checkbox.
    const runsAfter = rowByLabel(second, "Runs after")!;
    const firstCheckbox = Array.from(runsAfter.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
      (cb) => cb.parentElement?.textContent?.includes("first")
    )!;
    expect(firstCheckbox).toBeTruthy();
    firstCheckbox.checked = true;
    firstCheckbox.dispatchEvent(new Event("change"));

    expect(config.postActions!.second.dependsOn).toEqual(["first"]);

    // After the re-render: `second` shows a "Waits for" line and sits in a later wave than `first`.
    const afterAgain = phaseSection(el, "After submit");
    const secondCard = afterAgain.querySelector('.skye-builder__action-card[data-action-key="second"]')!;
    expect(secondCard.querySelector(".skye-builder__seq--after")?.textContent).toContain("Waits for: first");
    expect(afterAgain.querySelectorAll(".skye-builder__wave-sep").length).toBe(1); // a "↓ then" separator now exists
    const waves = Array.from(afterAgain.querySelectorAll<HTMLElement>(".skye-builder__wave"));
    expect(waves[0].querySelector('[data-action-key="first"]')).toBeTruthy();
    expect(waves[1].querySelector('[data-action-key="second"]')).toBeTruthy();
  });

  it("the per-card phase selector moves an action to another phase", () => {
    const config = makeConfig();
    const el = renderFormSettingsEditor(config, () => {}, document);
    const card = addAction(el, "Before submit", "mover");
    const moveSelect = card.querySelector(".skye-builder__phase-move select") as HTMLSelectElement;
    moveSelect.value = "onError";
    moveSelect.dispatchEvent(new Event("change"));
    expect(config.postActions!.mover.trigger).toBe("onError");
    expect(phaseSection(el, "On error").querySelector('[data-action-key="mover"]')).toBeTruthy();
    expect(phaseSection(el, "Before submit").querySelector('[data-action-key="mover"]')).toBeNull();
  });

  it("an existing action with an unknown trigger is surfaced in a 'Not assigned to a phase' section, not hidden", () => {
    const config = makeConfig();
    config.postActions = { weird: { trigger: "whenever" as never, type: "showMessage", message: "hi" } };
    const el = renderFormSettingsEditor(config, () => {}, document);
    const orphan = Array.from(el.querySelectorAll<HTMLElement>("section.skye-builder__phase")).find(
      (s) => s.querySelector("h4")?.textContent === "Not assigned to a phase"
    );
    expect(orphan?.querySelector('[data-action-key="weird"]')).toBeTruthy();
  });
});
