import { describe, it, expect } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import { renderFieldEditor } from "../features/builder/fieldEditor.js";
import type { GraphListColumn } from "../shared/sharepoint/types.js";

describe("renderFieldEditor", () => {
  it("with no list columns supplied, bindTo falls back to the generic text input", () => {
    const field: FieldConfig = { controlType: "text" };
    const el = renderFieldEditor(field as FieldConfig & Record<string, unknown>, () => {}, document, {});
    const bindToRow = Array.from(el.querySelectorAll(".skye-builder__row")).find((r) => r.querySelector("label")?.textContent?.startsWith("Bind To"));
    expect(bindToRow?.querySelector("select")).toBeFalsy();
    expect(bindToRow?.querySelector("input")).toBeTruthy();
  });

  it("with list columns supplied, bindTo renders as a dropdown of the real column names", () => {
    const field: FieldConfig = { controlType: "text", source: "sharepoint" };
    const columns: GraphListColumn[] = [
      { name: "Title", displayName: "Title", columnType: "text" },
      { name: "Favourite_x0020_Campus", displayName: "Favourite Campus", columnType: "choice", choices: ["Bloomington", "Indianapolis"] },
    ];
    const el = renderFieldEditor(field as FieldConfig & Record<string, unknown>, () => {}, document, { listColumns: columns });
    const bindToRow = Array.from(el.querySelectorAll(".skye-builder__row")).find((r) => r.querySelector("label")?.textContent?.startsWith("Bind To"));
    const select = bindToRow?.querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "Title", "Favourite_x0020_Campus"]);

    select.value = "Favourite_x0020_Campus";
    select.dispatchEvent(new Event("change"));
    expect((field as unknown as Record<string, unknown>).bindTo).toBe("Favourite_x0020_Campus");
  });

  it("shows a 'fill options from column choices' button for a choice-bound select field, and it populates options", () => {
    const field = { controlType: "select", source: "sharepoint", bindTo: "Favourite_x0020_Campus" } as FieldConfig & Record<string, unknown>;
    const columns: GraphListColumn[] = [{ name: "Favourite_x0020_Campus", displayName: "Favourite Campus", columnType: "choice", choices: ["Bloomington", "Indianapolis"] }];
    const el = renderFieldEditor(field, () => {}, document, { listColumns: columns });
    const bindToRow = Array.from(el.querySelectorAll(".skye-builder__row")).find((r) => r.querySelector("label")?.textContent?.startsWith("Bind To"))!;
    const select = bindToRow.querySelector("select") as HTMLSelectElement;
    select.value = "Favourite_x0020_Campus";
    select.dispatchEvent(new Event("change"));

    const fillBtn = Array.from(bindToRow.querySelectorAll("button")).find((b) => b.textContent?.includes("Fill options"))!;
    expect(fillBtn).toBeTruthy();
    fillBtn.click();
    expect(field.options).toEqual([
      { value: "Bloomington", label: "Bloomington" },
      { value: "Indianapolis", label: "Indianapolis" },
    ]);
  });

  it("with pageKeys supplied, page renders as a dropdown of the form's real page keys", () => {
    const field: FieldConfig = { controlType: "text" };
    const el = renderFieldEditor(field as FieldConfig & Record<string, unknown>, () => {}, document, { pageKeys: ["main", "review"] });
    const pageRow = Array.from(el.querySelectorAll(".skye-builder__row")).find((r) => r.querySelector("label")?.textContent?.startsWith("Page"));
    const select = pageRow?.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "main", "review"]);
    select.value = "review";
    select.dispatchEvent(new Event("change"));
    expect((field as unknown as Record<string, unknown>).page).toBe("review");
  });

  it("controlType 'button' renders the dedicated, always-shown actions editor (not the generic presence-toggled dictionary)", () => {
    const field = { controlType: "button", label: "Send Reminder" } as FieldConfig & Record<string, unknown>;
    const el = renderFieldEditor(field, () => {}, document, { scriptActionNames: ["teams.sendMessage"] });

    const heading = Array.from(el.querySelectorAll("h4")).find((h) => h.textContent === "Actions (run on click)");
    expect(heading).toBeTruthy();
    // No presence-toggle checkbox for `actions` — it's shown directly, and field.actions is
    // initialized to {} the moment the editor renders (not left undefined).
    expect(field.actions).toEqual({});

    const addRow = heading!.nextElementSibling!.querySelector(".skye-builder__phase-add")!;
    (addRow.querySelector("input") as HTMLInputElement).value = "notify";
    (addRow.querySelector("button") as HTMLButtonElement).click();
    expect((field.actions as Record<string, { trigger?: string }>).notify.trigger).toBe("onClick");
  });

  it("a non-button controlType still gets the generic presence-toggled dictionary editor for 'actions' (unused, but not special-cased away)", () => {
    const field: FieldConfig = { controlType: "text" };
    const el = renderFieldEditor(field as FieldConfig & Record<string, unknown>, () => {}, document, {});
    expect(Array.from(el.querySelectorAll("h4")).some((h) => h.textContent === "Actions (run on click)")).toBe(false);
  });
});
