import { describe, it, expect, vi } from "vitest";
import { renderFormOrViewPicker, toPickerEntries } from "../lib/routing/siteSwitcher.js";
import type { SkyeFormSummary, SkyeViewSummary } from "../lib/graph/types.js";

const forms: SkyeFormSummary[] = [{ formId: "signup", title: "Sign-up" }];
const views: SkyeViewSummary[] = [{ viewId: "calendar", title: "Calendar" }];

describe("toPickerEntries", () => {
  it("lists forms first, then views, each tagged with its kind", () => {
    expect(toPickerEntries(forms, views)).toEqual([
      { kind: "form", id: "signup", title: "Sign-up" },
      { kind: "view", id: "calendar", title: "Calendar" },
    ]);
  });
});

describe("renderFormOrViewPicker", () => {
  it("renders a button per entry with a kind label", () => {
    const el = renderFormOrViewPicker(toPickerEntries(forms, views), vi.fn(), document);
    const buttons = el.querySelectorAll("li button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain("Sign-up");
    expect(buttons[0].querySelector(".skye-picker-kind")?.textContent).toBe("form");
    expect(buttons[1].querySelector(".skye-picker-kind")?.textContent).toBe("view");
  });

  it("calls onSelect with the chosen entry", () => {
    const onSelect = vi.fn();
    const el = renderFormOrViewPicker(toPickerEntries(forms, views), onSelect, document);
    (el.querySelectorAll("li button")[1] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith({ kind: "view", id: "calendar", title: "Calendar" });
  });

  it("shows an empty state when there are no forms or views", () => {
    const el = renderFormOrViewPicker([], vi.fn(), document);
    expect(el.querySelector("ul")).toBeNull();
    expect(el.textContent).toContain("No SKYE forms or views were found");
  });
});
