import { describe, it, expect } from "vitest";
import { renderButtonActionsEditor } from "../features/builder/buttonActionsEditor.js";
import type { PostActionEntry } from "../features/builder/formSettingsEditor.js";

const ACTION_NAMES = ["teams.sendMessage", "outlook.sendEmail", "engage.createEvent"];

function rowByLabel(root: HTMLElement, prefix: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>(".skye-builder__row")).find((r) => r.querySelector("label")?.textContent?.startsWith(prefix));
}

/** Adds an action and returns its (freshly re-queried) card — adding triggers a full re-render. */
function addAction(root: HTMLElement, key: string): HTMLElement {
  const addRow = root.querySelector(".skye-builder__phase-add")!;
  (addRow.querySelector("input") as HTMLInputElement).value = key;
  (addRow.querySelector("button") as HTMLButtonElement).click();
  const card = Array.from(root.querySelectorAll<HTMLElement>(".skye-builder__action-card")).find((c) => c.dataset.actionKey === key);
  if (!card) throw new Error(`card "${key}" not found after add`);
  return card;
}

describe("renderButtonActionsEditor", () => {
  it("shows an empty-state message and an add control when there are no actions yet", () => {
    const actions: Record<string, PostActionEntry> = {};
    const el = renderButtonActionsEditor(actions, () => {}, document, []);
    expect(el.querySelector(".skye-builder__phase-empty")?.textContent).toMatch(/no actions yet/i);
    expect(el.querySelector(".skye-builder__phase-add")).toBeTruthy();
  });

  it("adding an action sets trigger: 'onClick' automatically — never an editable control", () => {
    const actions: Record<string, PostActionEntry> = {};
    const el = renderButtonActionsEditor(actions, () => {}, document, []);
    const card = addAction(el, "notify");
    expect(actions.notify.trigger).toBe("onClick");
    expect(rowByLabel(card, "Trigger")).toBeUndefined();
  });

  it("rejects a duplicate or invalid action key without adding it", () => {
    const actions: Record<string, PostActionEntry> = { existing: { trigger: "onClick", type: "showMessage" } };
    const el = renderButtonActionsEditor(actions, () => {}, document, []);
    const addRow = el.querySelector(".skye-builder__phase-add")!;
    const input = addRow.querySelector("input") as HTMLInputElement;
    const btn = addRow.querySelector("button") as HTMLButtonElement;

    input.value = "existing";
    btn.click();
    expect(el.querySelector(".skye-builder__dict-add-error")?.textContent).toMatch(/already exists/i);

    input.value = "1bad";
    btn.click();
    expect(el.querySelector(".skye-builder__dict-add-error")?.textContent).toMatch(/start with a letter/i);

    expect(Object.keys(actions)).toEqual(["existing"]);
  });

  it("choosing type 'script' renders functionName as a dropdown of the real registered actions", () => {
    const actions: Record<string, PostActionEntry> = {};
    const el = renderButtonActionsEditor(actions, () => {}, document, ACTION_NAMES);
    const card = addAction(el, "runIt");

    const typeSelect = rowByLabel(card, "Type")!.querySelector("select") as HTMLSelectElement;
    typeSelect.value = "script";
    typeSelect.dispatchEvent(new Event("change"));

    const fnControl = rowByLabel(card, "Function name")!.querySelector("select") as HTMLSelectElement;
    expect(fnControl).toBeTruthy();
    expect(Array.from(fnControl.querySelectorAll("optgroup")).map((g) => g.label)).toEqual(["teams", "outlook", "engage"]);

    fnControl.value = "engage.createEvent";
    fnControl.dispatchEvent(new Event("change"));
    expect(actions.runIt.functionName).toBe("engage.createEvent");
  });

  it("dependsOn is a checkbox list of this button's OTHER actions (no phase concept), and drives the sequencing view", () => {
    const actions: Record<string, PostActionEntry> = {};
    const el = renderButtonActionsEditor(actions, () => {}, document, []);
    addAction(el, "first");
    const second = addAction(el, "second");

    const runsAfter = rowByLabel(second, "Runs after")!;
    const firstCheckbox = Array.from(runsAfter.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((cb) =>
      cb.parentElement?.textContent?.includes("first")
    )!;
    expect(firstCheckbox).toBeTruthy();
    firstCheckbox.checked = true;
    firstCheckbox.dispatchEvent(new Event("change"));

    expect(actions.second.dependsOn).toEqual(["first"]);

    const secondCardAgain = el.querySelector('[data-action-key="second"]')!;
    expect(secondCardAgain.querySelector(".skye-builder__seq--after")?.textContent).toContain("Waits for: first");
    const waves = Array.from(el.querySelectorAll<HTMLElement>(".skye-builder__wave"));
    expect(waves[0].querySelector('[data-action-key="first"]')).toBeTruthy();
    expect(waves[1].querySelector('[data-action-key="second"]')).toBeTruthy();
  });

  it("removing an action drops it from siblings' dependsOn too", () => {
    const actions: Record<string, PostActionEntry> = {
      first: { trigger: "onClick", type: "showMessage", message: "a" },
      second: { trigger: "onClick", type: "showMessage", message: "b", dependsOn: ["first"] },
    };
    const el = renderButtonActionsEditor(actions, () => {}, document, []);
    const firstCard = el.querySelector('[data-action-key="first"]')!;
    (Array.from(firstCard.querySelectorAll("button")).find((b) => b.textContent === "Remove") as HTMLButtonElement).click();

    expect(actions.first).toBeUndefined();
    expect(actions.second.dependsOn).toBeUndefined();
  });
});
