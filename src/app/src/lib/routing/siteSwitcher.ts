import type { SiteResult, SkyeFormSummary, SkyeViewSummary } from "../graph/types.js";

/**
 * Shared DOM-building for a simple "pick one of these" list — used by both
 * renderSiteSwitcher (step 1: pick a site) and renderFormPicker (step 2:
 * pick a form on that site, when a visit arrives with no formId at all).
 * Takes an `onSelect` callback rather than navigating directly, so this
 * stays pure and testable without real browser navigation (jsdom doesn't
 * support `location.assign` by default) — the caller (entry-switcher.ts)
 * decides what "selecting one" actually does.
 */
function renderPickerList<T>(
  heading: string,
  emptyMessage: string,
  introMessage: string,
  items: T[],
  labelFor: (item: T) => string,
  onSelect: (item: T) => void,
  document: Document
): HTMLElement {
  const container = document.createElement("div");
  container.className = "skye-site-switcher";

  const headingEl = document.createElement("h2");
  headingEl.textContent = heading;
  container.appendChild(headingEl);

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return container;
  }

  const intro = document.createElement("p");
  intro.textContent = introMessage;
  container.appendChild(intro);

  const list = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = labelFor(item);
    button.addEventListener("click", () => onSelect(item));
    li.appendChild(button);
    list.appendChild(li);
  }
  container.appendChild(list);

  return container;
}

/**
 * Step 1: pick a site, from the ones Graph's tenant-wide search found with
 * a skye_data directory (see graphClient.ts's searchSitesWithSkyeData —
 * filtering happens there, at the source, so a site with no SKYE
 * configuration never appears here in the first place, rather than being
 * fetched and then hidden).
 */
export function renderSiteSwitcher(sites: SiteResult[], onSelect: (site: SiteResult) => void, document: Document): HTMLElement {
  return renderPickerList(
    "Choose a site",
    "No SharePoint sites with a SKYE configuration were found.",
    "These are the sites in your tenant with a skye_data configuration:",
    sites,
    (site) => site.displayName,
    onSelect,
    document
  );
}

/**
 * Step 2: pick a form configured on an already-chosen site (see
 * graphClient.ts's listSkyeForms). Only reached when a visit arrives with
 * a site but no formId at all — see entry-switcher.ts.
 */
export function renderFormPicker(forms: SkyeFormSummary[], onSelect: (form: SkyeFormSummary) => void, document: Document): HTMLElement {
  return renderPickerList(
    "Choose a form",
    "No SKYE forms were found on this site.",
    "These are the forms configured on this site:",
    forms,
    (form) => form.title,
    onSelect,
    document
  );
}

/** One row in the combined form-or-view picker. */
export interface PickerEntry {
  kind: "form" | "view";
  id: string;
  title: string;
}

/**
 * Step 2, combined: pick a form OR a Custom View on an already-chosen site
 * (TODO §16, Q7). Each row shows its kind. onSelect gets the chosen entry;
 * entry-switcher.ts turns it into a /form or /view navigation.
 */
export function renderFormOrViewPicker(entries: PickerEntry[], onSelect: (entry: PickerEntry) => void, document: Document): HTMLElement {
  const container = document.createElement("div");
  container.className = "skye-site-switcher";

  const heading = document.createElement("h2");
  heading.textContent = "Choose a form or view";
  container.appendChild(heading);

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No SKYE forms or views were found on this site.";
    container.appendChild(empty);
    return container;
  }

  const intro = document.createElement("p");
  intro.textContent = "These are the forms and views configured on this site:";
  container.appendChild(intro);

  const list = document.createElement("ul");
  for (const entry of entries) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.title;
    const kind = document.createElement("span");
    kind.className = "skye-picker-kind";
    kind.textContent = entry.kind === "view" ? "view" : "form";
    button.appendChild(kind);
    button.addEventListener("click", () => onSelect(entry));
    li.appendChild(button);
    list.appendChild(li);
  }
  container.appendChild(list);
  return container;
}

/** Merges a site's forms and views into one ordered list of picker entries (forms first, then views). */
export function toPickerEntries(forms: SkyeFormSummary[], views: SkyeViewSummary[]): PickerEntry[] {
  return [
    ...forms.map((f): PickerEntry => ({ kind: "form", id: f.formId, title: f.title })),
    ...views.map((v): PickerEntry => ({ kind: "view", id: v.viewId, title: v.title })),
  ];
}
