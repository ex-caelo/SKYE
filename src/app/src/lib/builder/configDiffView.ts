import type { ConfigDiff, DiffEntry } from "@skye/config";

const STATUS_LABEL: Record<DiffEntry["status"], string> = { added: "Added", removed: "Removed", changed: "Changed" };
const VISIBILITY_LABEL: Record<NonNullable<DiffEntry["visibilityChange"]>, string> = {
  added: "visibility condition added",
  removed: "visibility condition removed",
  changed: "visibility condition changed",
};

function renderDiffEntry(entry: DiffEntry, document: Document): HTMLElement {
  const li = document.createElement("li");
  li.dataset.status = entry.status;

  let text = `${entry.key} — ${STATUS_LABEL[entry.status]}`;
  if (entry.status === "changed" && entry.changedProperties?.length) {
    text += ` (${entry.changedProperties.join(", ")})`;
  }
  if (entry.visibilityChange) {
    text += ` — ${VISIBILITY_LABEL[entry.visibilityChange]}`;
  }
  li.textContent = text;
  return li;
}

/** Renders one dictionary's entries as a plain list, or (for fields) grouped under a sub-heading per page — "by page/field", per how this diff is meant to be reviewed. */
function renderEntryList(entries: DiffEntry[], document: Document, groupByPage: boolean): HTMLElement {
  const wrapper = document.createElement("div");
  if (!groupByPage) {
    const list = document.createElement("ul");
    for (const entry of entries) list.appendChild(renderDiffEntry(entry, document));
    wrapper.appendChild(list);
    return wrapper;
  }

  const byPage = new Map<string, DiffEntry[]>();
  for (const entry of entries) {
    const pageKey = entry.pageKey ?? "(no page)";
    if (!byPage.has(pageKey)) byPage.set(pageKey, []);
    byPage.get(pageKey)!.push(entry);
  }
  for (const [pageKey, pageEntries] of [...byPage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const pageHeading = document.createElement("h5");
    pageHeading.textContent = pageKey;
    wrapper.appendChild(pageHeading);
    const list = document.createElement("ul");
    for (const entry of pageEntries) list.appendChild(renderDiffEntry(entry, document));
    wrapper.appendChild(list);
  }
  return wrapper;
}

function renderSection(title: string, entries: DiffEntry[], document: Document, groupByPage = false): HTMLElement | null {
  if (entries.length === 0) return null;
  const section = document.createElement("div");
  section.className = "skye-diff__section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.appendChild(heading);
  section.appendChild(renderEntryList(entries, document, groupByPage));
  return section;
}

/**
 * Renders a full ConfigDiff (see @skye/config's configDiff.ts) for /builder's
 * "review changes before saving" step — grouped by section (Form settings,
 * Pages, Fields-by-page, Post Actions), each entry showing its status
 * (Added/Removed/Changed), which properties changed, and whether a
 * visibility condition was specifically added/removed/changed.
 */
export function renderConfigDiff(diff: ConfigDiff, document: Document): HTMLElement {
  const container = document.createElement("div");
  container.className = "skye-diff";

  if (diff.settings.changedProperties.length > 0) {
    const section = document.createElement("div");
    section.className = "skye-diff__section";
    const heading = document.createElement("h4");
    heading.textContent = "Form settings";
    section.appendChild(heading);
    const p = document.createElement("p");
    p.textContent = `Changed: ${diff.settings.changedProperties.join(", ")}`;
    section.appendChild(p);
    container.appendChild(section);
  }

  const pagesSection = renderSection("Pages", diff.pages, document);
  if (pagesSection) container.appendChild(pagesSection);

  const fieldsSection = renderSection("Fields", diff.fields, document, true);
  if (fieldsSection) container.appendChild(fieldsSection);

  const postActionsSection = renderSection("Post Actions", diff.postActions, document);
  if (postActionsSection) container.appendChild(postActionsSection);

  if (container.children.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No changes.";
    container.appendChild(p);
  }

  return container;
}
