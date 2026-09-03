import { describe, it, expect, vi, afterEach } from "vitest";
import { populateSitePicker, populateFormPicker } from "../features/switcher/siteSwitcher.js";
import { mountComponents } from "./helpers/astroFixture.js";
import type { SiteResult, SkyeFormSummary } from "../shared/sharepoint/types.js";

const sites: SiteResult[] = [
  { siteId: "site-a", displayName: "Site A", webUrl: "https://example.sharepoint.com/sites/a" },
  { siteId: "site-b", displayName: "Site B", webUrl: "https://example.sharepoint.com/sites/b" },
];

const forms: SkyeFormSummary[] = [
  { formId: "event-signup", title: "Event Sign-up" },
  { formId: "budget-request", title: "Budget Request" },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("populateSitePicker", () => {
  it("fills the SitePicker skeleton with one row per site", () => {
    const section = mountComponents("SitePicker").querySelector<HTMLElement>("#step-site-picker")!;
    populateSitePicker(section, sites, vi.fn());
    const buttons = section.querySelectorAll("li button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("Site A");
    expect(buttons[1].textContent).toBe("Site B");
    expect(section.querySelector<HTMLElement>('[data-slot="empty"]')!.hidden).toBe(true);
  });

  it("calls onSelect with the chosen site when clicked", () => {
    const onSelect = vi.fn();
    const section = mountComponents("SitePicker").querySelector<HTMLElement>("#step-site-picker")!;
    populateSitePicker(section, sites, onSelect);
    (section.querySelectorAll("li button")[1] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith(sites[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows the empty-state message and no rows when there are no sites", () => {
    const section = mountComponents("SitePicker").querySelector<HTMLElement>("#step-site-picker")!;
    populateSitePicker(section, [], vi.fn());
    expect(section.querySelectorAll("li button")).toHaveLength(0);
    const empty = section.querySelector<HTMLElement>('[data-slot="empty"]')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain("No sites with SKYE turned up.");
    expect(section.querySelector<HTMLElement>('[data-slot="list"]')!.hidden).toBe(true);
  });
});

describe("populateFormPicker", () => {
  it("renders one row per form, labeled by title", () => {
    const section = mountComponents("FormPicker").querySelector<HTMLElement>("#step-form-picker")!;
    populateFormPicker(section, forms, vi.fn());
    const buttons = section.querySelectorAll("li button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("Event Sign-up");
    expect(buttons[1].textContent).toBe("Budget Request");
  });

  it("calls onSelect with the chosen form when clicked", () => {
    const onSelect = vi.fn();
    const section = mountComponents("FormPicker").querySelector<HTMLElement>("#step-form-picker")!;
    populateFormPicker(section, forms, onSelect);
    (section.querySelectorAll("li button")[1] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith(forms[1]);
  });

  it("shows the empty-state message when there are no forms", () => {
    const section = mountComponents("FormPicker").querySelector<HTMLElement>("#step-form-picker")!;
    populateFormPicker(section, [], vi.fn());
    const empty = section.querySelector<HTMLElement>('[data-slot="empty"]')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain("No SKYE forms were found on this site.");
  });
});
