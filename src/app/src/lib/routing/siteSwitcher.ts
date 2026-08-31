import type { SiteResult, SkyeFormSummary, SkyeViewSummary } from "../graph/types.js";

/**
 * Runtime wiring for the site-switcher screens. The MARKUP for every
 * screen now lives in `.astro` components (SitePicker, FormPicker,
 * FormOrViewPicker, AddSitePanel, PermissionsStep, CreateSiteAssetsStep),
 * composed into pages/switcher.astro and pages/builder.astro. The
 * functions here take the already-rendered `<section>` for a screen and
 * populate its data-driven parts (`[data-slot="list"]` from a `<template>`,
 * `[data-slot=…]` text, `[data-el=…]` controls) and attach event
 * listeners. The entry scripts pick which screen is visible with
 * `showState` (src/lib/ui/pageState.ts).
 */

// --- shared list population ---------------------------------------------------

/**
 * Fills a picker screen's `<ul data-slot="list">` with one row per item,
 * cloned from the screen's `<template data-tpl="row">`, and toggles the
 * `[data-slot="empty"]` message. `configureRow` gets the cloned `<li>` and
 * the item to set text/attributes and wire the row's `<button>`.
 */
function populateList<T>(
  section: HTMLElement,
  items: T[],
  configureRow: (li: HTMLElement, item: T) => void
): void {
  const list = section.querySelector<HTMLElement>('[data-slot="list"]')!;
  const template = section.querySelector<HTMLTemplateElement>('[data-tpl="row"]')!;
  const empty = section.querySelector<HTMLElement>('[data-slot="empty"]');
  const intro = section.querySelector<HTMLElement>('[data-slot="intro"]');

  list.replaceChildren();
  for (const item of items) {
    const li = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    configureRow(li, item);
    list.appendChild(li);
  }

  const isEmpty = items.length === 0;
  if (empty) empty.hidden = !isEmpty;
  if (intro) intro.hidden = isEmpty;
  list.hidden = isEmpty;
}

/** Step 1: fill the "choose a site" screen (SitePicker.astro). */
export function populateSitePicker(section: HTMLElement, sites: SiteResult[], onSelect: (site: SiteResult) => void): void {
  populateList(section, sites, (li, site) => {
    const button = li.querySelector("button")!;
    button.textContent = site.displayName;
    button.addEventListener("click", () => onSelect(site));
  });
}

/** Step 2 (builder): fill the "choose a form" screen (FormPicker.astro). */
export function populateFormPicker(section: HTMLElement, forms: SkyeFormSummary[], onSelect: (form: SkyeFormSummary) => void): void {
  populateList(section, forms, (li, form) => {
    const button = li.querySelector("button")!;
    button.textContent = form.title;
    button.addEventListener("click", () => onSelect(form));
  });
}

/** One row in the combined form-or-view picker. */
export interface PickerEntry {
  kind: "form" | "view";
  id: string;
  title: string;
}

/** Merges a site's forms and views into one ordered list of picker entries (forms first, then views). */
export function toPickerEntries(forms: SkyeFormSummary[], views: SkyeViewSummary[]): PickerEntry[] {
  return [
    ...forms.map((f): PickerEntry => ({ kind: "form", id: f.formId, title: f.title })),
    ...views.map((v): PickerEntry => ({ kind: "view", id: v.viewId, title: v.title })),
  ];
}

/**
 * Step 2 (switcher): fill the combined form/view picker (FormOrViewPicker.astro).
 * When `onCreateNew` is passed (the signed-in user can write into this
 * site's `skye_data`), the "Create New Form Config" link is revealed and
 * wired; otherwise it stays hidden.
 */
export function populateFormOrViewPicker(
  section: HTMLElement,
  entries: PickerEntry[],
  onSelect: (entry: PickerEntry) => void,
  onCreateNew?: () => void
): void {
  populateList(section, entries, (li, entry) => {
    const button = li.querySelector("button")!;
    button.querySelector(".skye-picker-label")!.textContent = entry.title;
    button.querySelector(".skye-picker-kind")!.textContent = entry.kind === "view" ? "view" : "form";
    button.addEventListener("click", () => onSelect(entry));
  });

  const create = section.querySelector<HTMLElement>('[data-el="create"]')!;
  if (onCreateNew) {
    create.hidden = false;
    create.addEventListener("click", (e) => {
      e.preventDefault();
      onCreateNew();
    });
  } else {
    create.hidden = true;
  }
}

// --- add-site panel ---------------------------------------------------------

/** Controller a screen hands back so the install flow (entry-switcher.ts) can report progress. */
export interface StepReporter {
  /** Show a status line (empty string clears it). */
  setStatus(message: string, level?: "info" | "error" | "success"): void;
  /** Disable/enable the screen's inputs while a check/install is in flight. */
  setBusy(busy: boolean): void;
}

/**
 * Wires AddSitePanel.astro: calls `onSubmit(trimmedUrl)` on form submit
 * (ignoring an empty value), and returns a {@link StepReporter} driving the
 * status line + the input/button disabled state.
 */
export function wireAddSitePanel(section: HTMLElement, onSubmit: (siteUrl: string) => void): StepReporter {
  const form = section.querySelector<HTMLFormElement>('[data-el="form"]')!;
  const input = section.querySelector<HTMLInputElement>('[data-el="input"]')!;
  const button = section.querySelector<HTMLButtonElement>('[data-el="submit"]')!;
  const status = section.querySelector<HTMLElement>('[data-el="status"]')!;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (value) onSubmit(value);
  });

  return {
    setStatus(message, level) {
      status.textContent = message;
      if (level) status.dataset.level = level;
      else delete status.dataset.level;
    },
    setBusy(busy) {
      input.disabled = busy;
      button.disabled = busy;
      button.textContent = busy ? "Working…" : "Continue";
    },
  };
}

// --- URL builders (pure — unchanged) --------------------------------------

/**
 * Builds the classic SharePoint "manage permissions" URL for a whole
 * document library — `.../\_layouts/15/user.aspx?obj={listId},doclib&List={listId}`,
 * GUID brace-wrapped and percent-encoded. A fallback when the specific
 * folder's item id isn't known; prefer buildFolderPermissionsUrl.
 */
export function buildLibraryPermissionsUrl(siteWebUrl: string, listId: string): string {
  const braced = encodeURIComponent(`{${listId}}`); // -> %7B...%7D
  return `${siteWebUrl.replace(/\/+$/, "")}/_layouts/15/user.aspx?obj=${braced},doclib&List=${braced}`;
}

/**
 * Builds the classic "manage permissions" URL for one FOLDER (list item) —
 * `.../\_layouts/15/user.aspx?List={listId}&obj={listId},{itemId},LISTITEM&noredirect=true`
 * (GUID dashes percent-encoded, no braces — the format SharePoint's own
 * "Manage access → Advanced" produces for an item). This scopes the
 * permissions page to the `skye_data` folder specifically, not the whole
 * Site Assets library.
 */
export function buildFolderPermissionsUrl(siteWebUrl: string, listId: string, itemId: string | number): string {
  const g = listId.replace(/-/g, "%2D");
  return `${siteWebUrl.replace(/\/+$/, "")}/_layouts/15/user.aspx?List=${g}&obj=${g},${itemId},LISTITEM&noredirect=true`;
}

/** The SharePoint "add a page" URL — the quickest way for a user to get Site Assets provisioned on a site that has none. */
export function buildCreateSiteAssetsUrl(siteWebUrl: string): string {
  return `${siteWebUrl.replace(/\/+$/, "")}/_layouts/15/CreatePage.aspx`;
}

// --- permissions step -----------------------------------------------------

export interface PermissionsStepOptions {
  siteName: string;
  libraryName: string;
  /** Null when no list id resolved — the link is then removed and the prose alone describes the manual step. */
  manageAccessUrl: string | null;
  onContinue: () => void;
}

/** Fills PermissionsStep.astro and wires its "finished" button. */
export function fillPermissionsStep(section: HTMLElement, opts: PermissionsStepOptions): void {
  section.querySelectorAll<HTMLElement>('[data-slot="site-name"]').forEach((el) => (el.textContent = opts.siteName));
  section.querySelector<HTMLElement>('[data-slot="library-name"]')!.textContent = opts.libraryName;

  const link = section.querySelector<HTMLAnchorElement>('[data-el="manage-link"]')!;
  if (opts.manageAccessUrl) {
    link.href = opts.manageAccessUrl;
    link.hidden = false;
  } else {
    link.remove();
  }

  section.querySelector<HTMLButtonElement>('[data-el="done"]')!.addEventListener("click", () => opts.onContinue());
}

// --- create-Site-Assets step -------------------------------------------------

export interface CreateSiteAssetsStepOptions {
  siteName: string;
  createUrl: string;
  onRetry: () => void;
  onCancel: () => void;
}

/** Fills CreateSiteAssetsStep.astro, wires its buttons, and returns a {@link StepReporter}. */
export function wireCreateSiteAssetsStep(section: HTMLElement, opts: CreateSiteAssetsStepOptions): StepReporter {
  section.querySelector<HTMLElement>('[data-slot="site-name"]')!.textContent = opts.siteName;

  const link = section.querySelector<HTMLAnchorElement>('[data-el="create-link"]')!;
  link.href = opts.createUrl;

  const retry = section.querySelector<HTMLButtonElement>('[data-el="retry"]')!;
  const cancel = section.querySelector<HTMLButtonElement>('[data-el="cancel"]')!;
  const status = section.querySelector<HTMLElement>('[data-el="status"]')!;
  retry.addEventListener("click", () => opts.onRetry());
  cancel.addEventListener("click", () => opts.onCancel());

  return {
    setStatus(message, level) {
      status.textContent = message;
      if (level) status.dataset.level = level;
      else delete status.dataset.level;
    },
    setBusy(busy) {
      retry.disabled = busy;
      cancel.disabled = busy;
      retry.textContent = busy ? "Checking…" : "Check again";
    },
  };
}
