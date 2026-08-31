import { describe, it, expect, vi, afterEach } from "vitest";
import { populateFormOrViewPicker, toPickerEntries } from "../lib/routing/siteSwitcher.js";
import { mountComponents } from "./helpers/astroFixture.js";
import type { SkyeFormSummary, SkyeViewSummary } from "../lib/graph/types.js";

const forms: SkyeFormSummary[] = [{ formId: "signup", title: "Sign-up" }];
const views: SkyeViewSummary[] = [{ viewId: "calendar", title: "Calendar" }];

function picker(): HTMLElement {
  return mountComponents("FormOrViewPicker").querySelector<HTMLElement>("#step-form-or-view-picker")!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("toPickerEntries", () => {
  it("lists forms first, then views, each tagged with its kind", () => {
    expect(toPickerEntries(forms, views)).toEqual([
      { kind: "form", id: "signup", title: "Sign-up" },
      { kind: "view", id: "calendar", title: "Calendar" },
    ]);
  });
});

describe("populateFormOrViewPicker", () => {
  it("renders a button per entry with a kind label", () => {
    const section = picker();
    populateFormOrViewPicker(section, toPickerEntries(forms, views), vi.fn());
    const buttons = section.querySelectorAll("li button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain("Sign-up");
    expect(buttons[0].querySelector(".skye-picker-kind")?.textContent).toBe("form");
    expect(buttons[1].querySelector(".skye-picker-kind")?.textContent).toBe("view");
  });

  it("calls onSelect with the chosen entry", () => {
    const onSelect = vi.fn();
    const section = picker();
    populateFormOrViewPicker(section, toPickerEntries(forms, views), onSelect);
    (section.querySelectorAll("li button")[1] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith({ kind: "view", id: "calendar", title: "Calendar" });
  });

  it("shows an empty state when there are no forms or views", () => {
    const section = picker();
    populateFormOrViewPicker(section, [], vi.fn());
    expect(section.querySelectorAll("li button")).toHaveLength(0);
    expect(section.querySelector<HTMLElement>('[data-slot="empty"]')!.hidden).toBe(false);
    expect(section.textContent).toContain("No SKYE forms or views were found");
  });

  it("reveals the 'Create New Form Config' control only when onCreateNew is passed, and calls it on click", () => {
    const withoutCb = picker();
    populateFormOrViewPicker(withoutCb, toPickerEntries(forms, views), vi.fn());
    expect(withoutCb.querySelector<HTMLElement>('[data-el="create"]')!.hidden).toBe(true);

    const onCreateNew = vi.fn();
    const section = picker();
    populateFormOrViewPicker(section, toPickerEntries(forms, views), vi.fn(), onCreateNew);
    const create = section.querySelector<HTMLElement>('[data-el="create"]')!;
    expect(create.hidden).toBe(false);
    expect(create.textContent).toMatch(/create new form config/i);
    create.dispatchEvent(new Event("click"));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it("still reveals the 'Create New Form Config' control when there are no forms or views", () => {
    const section = picker();
    populateFormOrViewPicker(section, [], vi.fn(), vi.fn());
    expect(section.querySelector<HTMLElement>('[data-el="create"]')!.hidden).toBe(false);
    expect(section.textContent).toContain("No SKYE forms or views were found");
  });
});
