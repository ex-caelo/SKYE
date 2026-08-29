import { describe, it, expect, vi } from "vitest";
import { renderSiteSwitcher, renderFormPicker } from "../lib/routing/siteSwitcher.js";
import type { SiteResult, SkyeFormSummary } from "../lib/graph/types.js";

const sites: SiteResult[] = [
  { siteId: "site-a", displayName: "Site A", webUrl: "https://example.sharepoint.com/sites/a" },
  { siteId: "site-b", displayName: "Site B", webUrl: "https://example.sharepoint.com/sites/b" },
];

const forms: SkyeFormSummary[] = [
  { formId: "event-signup", title: "Event Sign-up" },
  { formId: "budget-request", title: "Budget Request" },
];

describe("renderSiteSwitcher", () => {
  it("renders one entry per site", () => {
    const el = renderSiteSwitcher(sites, vi.fn(), document);
    const buttons = el.querySelectorAll("li button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("Site A");
    expect(buttons[1].textContent).toBe("Site B");
  });

  it("calls onSelect with the chosen site when clicked", () => {
    const onSelect = vi.fn();
    const el = renderSiteSwitcher(sites, onSelect, document);
    const buttons = el.querySelectorAll("li button");
    (buttons[1] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith(sites[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows an empty-state message and no list when there are no sites", () => {
    const el = renderSiteSwitcher([], vi.fn(), document);
    expect(el.querySelector("ul")).toBeNull();
    expect(el.textContent).toContain("No SharePoint sites with a SKYE configuration were found.");
  });
});

describe("renderFormPicker", () => {
  it("renders one entry per form, labeled by title", () => {
    const el = renderFormPicker(forms, vi.fn(), document);
    const buttons = el.querySelectorAll("li button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("Event Sign-up");
    expect(buttons[1].textContent).toBe("Budget Request");
  });

  it("calls onSelect with the chosen form when clicked", () => {
    const onSelect = vi.fn();
    const el = renderFormPicker(forms, onSelect, document);
    const buttons = el.querySelectorAll("li button");
    (buttons[1] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith(forms[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows an empty-state message and no list when there are no forms", () => {
    const el = renderFormPicker([], vi.fn(), document);
    expect(el.querySelector("ul")).toBeNull();
    expect(el.textContent).toContain("No SKYE forms were found on this site.");
  });
});
