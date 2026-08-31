import { describe, it, expect, vi, afterEach } from "vitest";
import {
  wireAddSitePanel,
  fillPermissionsStep,
  wireCreateSiteAssetsStep,
  buildLibraryPermissionsUrl,
  buildFolderPermissionsUrl,
  buildCreateSiteAssetsUrl,
} from "../lib/routing/siteSwitcher.js";
import { mountComponents } from "./helpers/astroFixture.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wireAddSitePanel", () => {
  function panel() {
    const host = mountComponents("AddSitePanel");
    return { host, section: host.querySelector<HTMLElement>(".skye-add-site")! };
  }

  it("has a URL input and a submit button in the .astro skeleton", () => {
    const { host, section } = panel();
    wireAddSitePanel(section, vi.fn());
    expect(section.querySelector<HTMLInputElement>("input")!.type).toBe("url");
    expect(section.querySelector("button")?.textContent).toBe("Continue");
    expect(host.textContent).toContain("Set up SKYE on another site");
  });

  it("calls onSubmit with the trimmed URL when the form is submitted", () => {
    const onSubmit = vi.fn();
    const { section } = panel();
    wireAddSitePanel(section, onSubmit);
    const input = section.querySelector<HTMLInputElement>("input")!;
    input.value = "  https://contoso.sharepoint.com/sites/Team  ";
    section.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onSubmit).toHaveBeenCalledWith("https://contoso.sharepoint.com/sites/Team");
  });

  it("does not call onSubmit for an empty input", () => {
    const onSubmit = vi.fn();
    const { section } = panel();
    wireAddSitePanel(section, onSubmit);
    section.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("setStatus / setBusy drive the status line and disabled state", () => {
    const { section } = panel();
    const { setStatus, setBusy } = wireAddSitePanel(section, vi.fn());
    const status = section.querySelector<HTMLElement>('[data-el="status"]')!;
    const input = section.querySelector<HTMLInputElement>("input")!;
    const button = section.querySelector<HTMLButtonElement>("button")!;

    setStatus("Checking that site…", "info");
    expect(status.textContent).toBe("Checking that site…");
    setStatus("Nope", "error");
    expect(status.dataset.level).toBe("error");
    setStatus("");
    expect(status.dataset.level).toBeUndefined();

    setBusy(true);
    expect(input.disabled).toBe(true);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Working…");
    setBusy(false);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Continue");
  });
});

describe("buildLibraryPermissionsUrl", () => {
  it("builds the classic library permissions URL with a brace-wrapped, encoded GUID", () => {
    expect(buildLibraryPermissionsUrl("https://indiana.sharepoint.com/sites/msteams_79e519", "abc-123")).toBe(
      "https://indiana.sharepoint.com/sites/msteams_79e519/_layouts/15/user.aspx?obj=%7Babc-123%7D,doclib&List=%7Babc-123%7D"
    );
  });

  it("strips a trailing slash from the site URL", () => {
    expect(buildLibraryPermissionsUrl("https://x.sharepoint.com/sites/y/", "g")).toContain("/sites/y/_layouts/15/");
  });
});

describe("buildFolderPermissionsUrl", () => {
  it("builds a LISTITEM-scoped permissions URL with percent-encoded dashes and no braces", () => {
    expect(buildFolderPermissionsUrl("https://indiana.sharepoint.com/sites/msteams_79e519", "836137fa-0292-423c-a1f0-8979b64ee621", 9)).toBe(
      "https://indiana.sharepoint.com/sites/msteams_79e519/_layouts/15/user.aspx?List=836137fa%2D0292%2D423c%2Da1f0%2D8979b64ee621&obj=836137fa%2D0292%2D423c%2Da1f0%2D8979b64ee621,9,LISTITEM&noredirect=true"
    );
  });
});

describe("buildCreateSiteAssetsUrl", () => {
  it("points at the SharePoint 'add a page' layout under the site", () => {
    expect(buildCreateSiteAssetsUrl("https://x.sharepoint.com/sites/y/")).toBe("https://x.sharepoint.com/sites/y/_layouts/15/CreatePage.aspx");
  });
});

describe("fillPermissionsStep", () => {
  const opts = {
    siteName: "Campus Events",
    libraryName: "Site Assets",
    manageAccessUrl: "https://x.sharepoint.com/sites/y/_layouts/15/user.aspx?obj=%7Bg%7D,doclib&List=%7Bg%7D",
  };
  function step() {
    return mountComponents("PermissionsStep").querySelector<HTMLElement>("#step-permissions")!;
  }

  it("names the site + library, links to the skye_data folder's permission settings in a new tab, and warns about Member edit access", () => {
    const el = step();
    fillPermissionsStep(el, { ...opts, onContinue: vi.fn() });
    expect(el.textContent).toContain("Campus Events");
    expect(el.textContent).toContain("Site Assets");
    expect(el.textContent).toMatch(/Members.*can\s+edit/i);
    const link = el.querySelector("a") as HTMLAnchorElement;
    expect(link.href).toBe(opts.manageAccessUrl);
    expect(link.hidden).toBe(false);
    expect(link.textContent).toMatch(/skye_data folder/i);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  it("removes the link when there's no list id", () => {
    const el = step();
    fillPermissionsStep(el, { ...opts, manageAccessUrl: null, onContinue: vi.fn() });
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toMatch(/inheritance on the skye_data folder/i);
  });

  it("calls onContinue when 'I'm finished setting permissions' is clicked", () => {
    const onContinue = vi.fn();
    const el = step();
    fillPermissionsStep(el, { ...opts, onContinue });
    (el.querySelector<HTMLButtonElement>('[data-el="done"]')!).click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("wireCreateSiteAssetsStep", () => {
  const opts = { siteName: "Campus Events", createUrl: "https://x.sharepoint.com/sites/y/_layouts/15/CreatePage.aspx" };
  function step() {
    return mountComponents("CreateSiteAssetsStep").querySelector<HTMLElement>("#step-create-assets")!;
  }

  it("explains the Site Assets requirement and links to the add-a-page flow in a new tab", () => {
    const el = step();
    wireCreateSiteAssetsStep(el, { ...opts, onRetry: vi.fn(), onCancel: vi.fn() });
    expect(el.textContent).toMatch(/Site Assets library/i);
    const link = el.querySelector("a") as HTMLAnchorElement;
    expect(link.href).toBe(opts.createUrl);
    expect(link.target).toBe("_blank");
    expect(el.textContent).toContain("Campus Events");
  });

  it("wires the Check again and Cancel buttons", () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    const el = step();
    wireCreateSiteAssetsStep(el, { ...opts, onRetry, onCancel });
    (el.querySelector<HTMLButtonElement>('[data-el="retry"]')!).click();
    (el.querySelector<HTMLButtonElement>('[data-el="cancel"]')!).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("setBusy toggles the retry button label + disabled state", () => {
    const el = step();
    const { setBusy } = wireCreateSiteAssetsStep(el, { ...opts, onRetry: vi.fn(), onCancel: vi.fn() });
    const retry = el.querySelector<HTMLButtonElement>('[data-el="retry"]')!;
    setBusy(true);
    expect(retry.disabled).toBe(true);
    expect(retry.textContent).toBe("Checking…");
    setBusy(false);
    expect(retry.textContent).toBe("Check again");
  });
});
