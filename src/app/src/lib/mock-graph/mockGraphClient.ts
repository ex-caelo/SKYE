import type {
  GraphClient,
  GraphListColumn,
  GraphListItem,
  ListItemImage,
  ListItemPage,
  ListItemQuery,
  LookupItemResult,
  PersonResult,
  SiteResult,
  SkyeFormConfigFile,
  SkyeFormDraftSummary,
  SkyeFormSummary,
  SkyeSiteConfigFile,
  SkyeViewFiles,
  SkyeViewSummary,
  UploadedFile,
} from "../graph/types.js";
import { EtagConflictError } from "../graph/types.js";
import listColumnsFixture from "./fixtures/list-columns.json" with { type: "json" };
import baseFormConfigFixture from "./fixtures/base-form-config.json" with { type: "json" };
import adminOverlayFixture from "./fixtures/admin-overlay-form-config.json" with { type: "json" };
import item1Fixture from "./fixtures/item-1.json" with { type: "json" };
import peopleFixture from "./fixtures/people.json" with { type: "json" };
import sitesFixture from "./fixtures/sites.json" with { type: "json" };
import viewListsFixture from "./fixtures/views/lists.json" with { type: "json" };
import skyeConfigFixture from "./fixtures/views/skye.config.json" with { type: "json" };
import skyeConfigAdminFixture from "./fixtures/views/skye.config.admin.json" with { type: "json" };
import calendarHtml from "./fixtures/views/calendar/view.html?raw";
import calendarCss from "./fixtures/views/calendar/view.css?raw";
import calendarJs from "./fixtures/views/calendar/view.js?raw";
import probesHtml from "./fixtures/views/security-probes/view.html?raw";
import probesCss from "./fixtures/views/security-probes/view.css?raw";
import probesJs from "./fixtures/views/security-probes/view.js?raw";

/** In-memory simulated document library, keyed by (driveId, path) — good enough to exercise upload logic without a real drive. */
const driveStore = new Map<string, { driveItemId: string; webUrl: string }>();
let nextDriveItemId = 1;

/**
 * Loads/persists a two-level Map (outer key -> inner key -> JSON value) to
 * `sessionStorage`, so mock form-config/draft edits survive a real page
 * navigation within the same browser tab — e.g. saving a draft in
 * `/builder`, then opening `/form?draft=...` in the SAME mock session to
 * preview it (exactly the workflow TODO §17's draft feature exists for).
 * Plain module-level state alone only lasts for one page's JS execution:
 * this app has no client-side router between pages (see CLAUDE.md), so
 * /builder and /form are genuinely separate script executions with no
 * shared memory. Falls back to a purely in-memory Map (same as before)
 * when sessionStorage isn't reachable — private-browsing contexts that
 * block storage, or any environment with no `sessionStorage` global at
 * all — since this is dev/testing convenience only, never a source of
 * truth, a failure here should degrade quietly, not break the mock.
 */
function loadPersistedStore(storageKey: string): Map<string, Map<string, unknown>> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    return new Map(Object.entries(parsed).map(([k, v]) => [k, new Map(Object.entries(v))]));
  } catch {
    return new Map();
  }
}

function persistStore(storageKey: string, store: Map<string, Map<string, unknown>>): void {
  try {
    const obj = Object.fromEntries([...store.entries()].map(([k, v]) => [k, Object.fromEntries(v)]));
    sessionStorage.setItem(storageKey, JSON.stringify(obj));
  } catch {
    // sessionStorage unavailable/full — this save just won't survive a page navigation; not fatal.
  }
}

/**
 * form.config.json store, keyed by `${siteId}::${formId}`, then by source
 * ("base" or a permission name) — lets `/builder` round-trip (load, edit,
 * save, reload) against the mock without a live tenant, and lets a
 * brand-new form (a formId with no fixture at all) be created and then
 * immediately re-read within the same mock session. Seeded lazily from the
 * static fixtures the first time "test-event-signup" is read, so a save
 * there layers on top of (and can override) the fixture data rather than
 * being invisible to it.
 */
const formConfigStore = loadPersistedStore("skye-mock-form-configs");

function formConfigStoreKey(siteId: string, formId: string): string {
  return `${siteId}::${formId}`;
}

/** Drafts store, same keying convention as formConfigStore, one level deeper (siteId::formId -> draftId -> config). Mirrors RealGraphClient's `_drafts/[draftId]/form.config.json` layout without touching any real drive. */
const draftStore = loadPersistedStore("skye-mock-form-drafts");

type ViewListFixture = Record<string, { columns: GraphListColumn[]; items: Array<{ id: string; fields: Record<string, unknown> }> }>;
const viewLists = viewListsFixture as ViewListFixture;

/**
 * List ids the mock "has". getListColumns throws for anything else, so the
 * Custom Views defense-in-depth test can confirm that a list not on the
 * config allowlist still fails at the Graph layer even if the shape check
 * were bypassed (mirrors a real Graph 404/403). Includes the ids the form
 * tests and the base fixture config use.
 */
const KNOWN_LISTS = new Set<string>(["list1", "guests-list", "66742a26-e579-4314-88b4-f6b62bf36458", ...Object.keys(viewLists)]);

/** The Custom Views the mock serves, by id. */
const MOCK_VIEWS: Record<string, SkyeViewFiles> = {
  calendar: { html: calendarHtml, css: calendarCss, js: calendarJs },
  "security-probes": { html: probesHtml, css: probesCss, js: probesJs },
};

/** A 1x1 transparent PNG — what the mock returns for any skye.image() request. */
const ONE_PX_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

/**
 * In-memory stores, one per (siteId, listId) pair, so create/update calls
 * during a mock dev session behave consistently AND separate lists don't
 * collide with each other's item ids.
 */
const listStores = new Map<string, Map<string, GraphListItem>>();
let nextId = 2;

function storeKey(siteId: string, listId: string): string {
  return `${siteId}::${listId}`;
}

function getStore(siteId: string, listId: string): Map<string, GraphListItem> {
  const key = storeKey(siteId, listId);
  let store = listStores.get(key);
  if (!store) {
    store = new Map<string, GraphListItem>();
    // Seed from whichever fixture set matches this list.
    if (viewLists[listId]) {
      for (const it of viewLists[listId].items) store.set(it.id, { id: it.id, fields: it.fields, etag: `"${it.id}"` });
    } else if (listId === "list1") {
      store.set("1", item1Fixture as GraphListItem);
    }
    listStores.set(key, store);
  }
  return store;
}

/** Simulates real network latency so loading states are visible during dev rather than flashing instantly. */
function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// --- A minimal OData $filter evaluator, just for the mock. Supports the
// --- exact shapes lib/views/compileQueryToOData.ts produces: fields/F <op> V,
// --- contains(fields/F, 'v'), fields/F eq null, and and/or/not/parens. ---

function tokenizeFilter(expr: string): string[] {
  const re = /\s*('(?:[^']|'')*'|\(|\)|,|[^\s(),]+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) out.push(m[1]);
  return out;
}

function odataLiteral(token: string): string | number | boolean | null {
  if (token === "null") return null;
  if (token === "true") return true;
  if (token === "false") return false;
  if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
  const n = Number(token);
  return Number.isNaN(n) ? token : n;
}

function evalODataFilter(expr: string, fields: Record<string, unknown>): boolean {
  const tokens = tokenizeFilter(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];
  const fieldName = (t: string) => t.replace(/^fields\//, "");

  function parseOr(): boolean {
    let left = parseAnd();
    while (peek() === "or") {
      eat();
      left = parseAnd() || left;
    }
    return left;
  }
  function parseAnd(): boolean {
    let left = parseUnary();
    while (peek() === "and") {
      eat();
      left = parseUnary() && left;
    }
    return left;
  }
  function parseUnary(): boolean {
    if (peek() === "not") {
      eat();
      return !parseUnary();
    }
    if (peek() === "(") {
      eat();
      const v = parseOr();
      if (peek() === ")") eat();
      return v;
    }
    if (peek() === "contains") {
      eat();
      eat(); // (
      const field = fieldName(eat());
      eat(); // ,
      const value = odataLiteral(eat());
      if (peek() === ")") eat();
      const actual = fields[field];
      return typeof actual === "string" && actual.includes(String(value));
    }
    const field = fieldName(eat());
    const op = eat();
    const value = odataLiteral(eat());
    const actual = fields[field];
    switch (op) {
      case "eq":
        return value === null ? actual === undefined || actual === null : actual === value;
      case "ne":
        return value === null ? actual !== undefined && actual !== null : actual !== value;
      case "gt":
        return (actual as number) > (value as number);
      case "ge":
        return (actual as number) >= (value as number);
      case "lt":
        return (actual as number) < (value as number);
      case "le":
        return (actual as number) <= (value as number);
      default:
        return false;
    }
  }
  return parseOr();
}

/** Sorts by an OData $orderby like "fields/Start asc,fields/Title desc". */
function sortByOData(items: GraphListItem[], orderby: string): GraphListItem[] {
  const keys = orderby.split(",").map((part) => {
    const [ref, dir] = part.trim().split(/\s+/);
    return { field: ref.replace(/^fields\//, ""), desc: dir === "desc" };
  });
  return [...items].sort((a, b) => {
    for (const k of keys) {
      const av = a.fields[k.field] as string | number;
      const bv = b.fields[k.field] as string | number;
      if (av < bv) return k.desc ? 1 : -1;
      if (av > bv) return k.desc ? -1 : 1;
    }
    return 0;
  });
}

/**
 * A GraphClient implementation backed entirely by local fixtures — no
 * network calls, no auth, no live tenant required. Selected via
 * createGraphClient.ts when PUBLIC_MOCK_GRAPH is set.
 */
export class MockGraphClient implements GraphClient {
  async getListColumns(_siteId: string, listId: string): Promise<GraphListColumn[]> {
    if (viewLists[listId]) return delay(viewLists[listId].columns);
    if (!KNOWN_LISTS.has(listId)) {
      throw new Error(`MockGraphClient: list "${listId}" not found (simulating a Graph 404 for a list the user can't see).`);
    }
    return delay(listColumnsFixture as GraphListColumn[]);
  }

  async getListItem(siteId: string, listId: string, itemId: string): Promise<GraphListItem> {
    const item = getStore(siteId, listId).get(itemId);
    if (!item) throw new Error(`MockGraphClient: no fixture item with id "${itemId}" in list "${listId}".`);
    return delay(item);
  }

  async createListItem(siteId: string, listId: string, fields: Record<string, unknown>): Promise<GraphListItem> {
    const id = String(nextId++);
    const item: GraphListItem = { id, fields, etag: `"${id}"` };
    getStore(siteId, listId).set(id, item);
    return delay(item);
  }

  async updateListItem(siteId: string, listId: string, itemId: string, fields: Record<string, unknown>, ifMatchEtag?: string): Promise<GraphListItem> {
    const store = getStore(siteId, listId);
    const existing = store.get(itemId);
    if (!existing) throw new Error(`MockGraphClient: no fixture item with id "${itemId}" in list "${listId}".`);
    if (ifMatchEtag && existing.etag !== ifMatchEtag) {
      throw new EtagConflictError();
    }
    const updated: GraphListItem = { id: itemId, fields: { ...existing.fields, ...fields }, etag: `"${Date.now()}"` };
    store.set(itemId, updated);
    return delay(updated);
  }

  async deleteListItem(siteId: string, listId: string, itemId: string): Promise<void> {
    getStore(siteId, listId).delete(itemId);
    return delay(undefined);
  }

  async searchListItems(siteId: string, listId: string, query: ListItemQuery): Promise<ListItemPage> {
    // A cursor round-trips the mock's own encoding — decode and continue.
    if (query.cursor) {
      const decoded = JSON.parse(decodeURIComponent(query.cursor.replace(/^mockcursor:/, ""))) as {
        siteId: string;
        listId: string;
        query: ListItemQuery;
      };
      return this.searchListItems(decoded.siteId, decoded.listId, decoded.query);
    }

    let items = [...getStore(siteId, listId).values()];
    if (query.search) {
      const needle = query.search.toLowerCase();
      items = items.filter((item) => JSON.stringify(item.fields).toLowerCase().includes(needle));
    }
    if (query.filter) items = items.filter((item) => evalODataFilter(query.filter!, item.fields));
    if (query.orderby) items = sortByOData(items, query.orderby);

    const totalCount = query.count ? items.length : undefined;
    const skip = query.skip ?? 0;
    const top = query.top ?? items.length;
    const pageItems = items.slice(skip, skip + top);

    const hasMore = skip + top < items.length;
    const nextLink = hasMore
      ? `mockcursor:${encodeURIComponent(JSON.stringify({ siteId, listId, query: { ...query, skip: skip + top } }))}`
      : undefined;

    return delay({ items: pageItems, nextLink, totalCount });
  }

  async searchPeople(query: string): Promise<PersonResult[]> {
    const needle = query.trim().toLowerCase();
    const results = needle
      ? (peopleFixture as PersonResult[]).filter((p) => p.displayName.toLowerCase().includes(needle))
      : (peopleFixture as PersonResult[]);
    return delay(results.slice(0, 10));
  }

  async searchLookupItems(siteId: string, listId: string, displayField: string, query: string): Promise<LookupItemResult[]> {
    const needle = query.trim().toLowerCase();
    const items = [...getStore(siteId, listId).values()];
    const results = items
      .map((item) => ({ id: item.id, label: String(item.fields[displayField] ?? item.id) }))
      .filter((r) => !needle || r.label.toLowerCase().includes(needle));
    return delay(results.slice(0, 10));
  }

  async getSkyeFormConfigFiles(siteId: string, formId: string): Promise<SkyeFormConfigFile[]> {
    const key = formConfigStoreKey(siteId, formId);
    if (!formConfigStore.has(key)) {
      if (formId !== "test-event-signup") {
        throw new Error(`MockGraphClient: no fixture form config for id "${formId}". Only "test-event-signup" has mock coverage.`);
      }
      // First read of the fixture form — seed the store from it so a later save() layers on top
      // of (and can override) this fixture data instead of being invisible to subsequent reads.
      formConfigStore.set(key, new Map<string, unknown>([["base", baseFormConfigFixture], ["admin", adminOverlayFixture]]));
      persistStore("skye-mock-form-configs", formConfigStore);
    }
    const forms = formConfigStore.get(key)!;
    return delay([...forms.entries()].map(([source, config]) => ({ source, config })));
  }

  async saveSkyeFormConfigFile(siteId: string, formId: string, source: string, config: unknown): Promise<void> {
    const key = formConfigStoreKey(siteId, formId);
    if (!formConfigStore.has(key)) formConfigStore.set(key, new Map<string, unknown>());
    formConfigStore.get(key)!.set(source, config);
    persistStore("skye-mock-form-configs", formConfigStore);
    return delay(undefined);
  }

  async listFormDrafts(siteId: string, formId: string): Promise<SkyeFormDraftSummary[]> {
    const drafts = draftStore.get(formConfigStoreKey(siteId, formId));
    if (!drafts) return delay([]);
    return delay(
      [...drafts.entries()].map(([draftId, config]) => ({ draftId, title: (config as { title?: string })?.title ?? draftId }))
    );
  }

  async getFormDraft(siteId: string, formId: string, draftId: string): Promise<unknown> {
    const draft = draftStore.get(formConfigStoreKey(siteId, formId))?.get(draftId);
    if (draft === undefined) throw new Error(`MockGraphClient: no draft "${draftId}" for form "${formId}".`);
    return delay(draft);
  }

  async saveFormDraft(siteId: string, formId: string, draftId: string, config: unknown): Promise<void> {
    const key = formConfigStoreKey(siteId, formId);
    if (!draftStore.has(key)) draftStore.set(key, new Map<string, unknown>());
    draftStore.get(key)!.set(draftId, config);
    persistStore("skye-mock-form-drafts", draftStore);
    return delay(undefined);
  }

  async publishFormDraft(siteId: string, formId: string, draftId: string): Promise<void> {
    const config = await this.getFormDraft(siteId, formId, draftId);
    await this.saveSkyeFormConfigFile(siteId, formId, "base", config);
  }

  async searchSitesWithSkyeData(): Promise<SiteResult[]> {
    return delay(sitesFixture as SiteResult[]);
  }

  async listSkyeForms(siteId: string): Promise<SkyeFormSummary[]> {
    // Forms saved into the in-memory store during this mock session (including brand-new ones
    // created via /builder) take precedence; "test-event-signup" always shows even before its
    // first read seeds the store, so the switcher/builder can find it from a cold start.
    const summaries = new Map<string, string>([[baseFormConfigFixture.id, baseFormConfigFixture.title]]);
    for (const [key, forms] of formConfigStore) {
      if (!key.startsWith(`${siteId}::`)) continue;
      const formId = key.slice(siteId.length + 2);
      const base = forms.get("base") as { title?: string } | undefined;
      if (base) summaries.set(formId, base.title ?? formId);
    }
    return delay([...summaries.entries()].map(([formId, title]) => ({ formId, title })));
  }

  async getSkyeViewFiles(_siteId: string, viewId: string): Promise<SkyeViewFiles> {
    const files = MOCK_VIEWS[viewId];
    if (!files) throw new Error(`MockGraphClient: no fixture Custom View with id "${viewId}". Known: ${Object.keys(MOCK_VIEWS).join(", ")}.`);
    return delay(files);
  }

  async getSkyeSiteConfigFiles(_siteId: string): Promise<SkyeSiteConfigFile[]> {
    // Simulates a user who can see the base config and one admin overlay — drop the second entry to test a non-admin viewer.
    return delay([
      { source: "base", config: skyeConfigFixture },
      { source: "admin", config: skyeConfigAdminFixture },
    ]);
  }

  async listSkyeViews(_siteId: string): Promise<SkyeViewSummary[]> {
    return delay([
      { viewId: "calendar", title: "Events calendar" },
      { viewId: "security-probes", title: "Security probes" },
    ]);
  }

  async getListItemImage(_siteId: string, _listId: string, _itemId: string, _field: string): Promise<ListItemImage> {
    return delay({ contentType: "image/png", bytes: ONE_PX_PNG });
  }

  async uploadToLibrary(siteId: string, driveId: string, folderPath: string | undefined, fileName: string, _data: ArrayBuffer): Promise<UploadedFile> {
    const path = folderPath ? `${folderPath}/${fileName}` : fileName;
    const key = `${siteId}::${driveId}::${path}`;
    const driveItemId = String(nextDriveItemId++);
    const result: UploadedFile = { driveItemId, webUrl: `https://example.sharepoint.com/mock-drive/${driveId}/${path}` };
    driveStore.set(key, result);
    return delay(result);
  }
}
