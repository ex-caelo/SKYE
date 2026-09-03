// SKYE Custom View runtime — injected INTO the sandboxed iframe as the
// entire API an author gets. Holds no token and makes no network calls; it
// only messages the host over a private port. Plain script (no imports) —
// viewHost.ts inlines this file's text verbatim into the frame's srcdoc.
//
// Ported from the prototype's skye-runtime.js, plus: skye.navigate(),
// client-side field-name validation for clearer authoring errors, a
// stale-response guard for rapid repeated list() calls, and a small
// in-session cache for schema()/lists() only.

(() => {
  const waiting = new Map();
  let seq = 0;
  let port;

  // The host hands over the port only after it has proven the sandbox is
  // really in place. Any call made before that queues behind this.
  const ready = new Promise((resolve) => {
    addEventListener("message", (e) => {
      if (port || e.data?.type !== "skye:port") return;
      port = e.ports[0];
      port.onmessage = onMessage;
      resolve();
    });
  });

  function onMessage(e) {
    const msg = e.data ?? {};

    if (msg.type === "skye:ping") return void port.postMessage({ type: "skye:pong" });
    if (msg.type === "skye:mount") return void mount(msg);

    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);

    if (!msg.error) return w.resolve(msg.result);
    const err = new Error(msg.error);
    err.name = msg.code || "Error"; // so a "listNotAllowed" / "429" surfaces as that, not a generic "Error"
    w.reject(err);
  }

  // The view's files arrive as data and are installed with DOM APIs, so
  // none of them is ever parsed as part of this document's source.
  function mount({ html, css, js }) {
    document.body.innerHTML = html; // <script> in view.html will NOT run — put JS in view.js
    const style = document.createElement("style");
    style.textContent = css; // textContent cannot break out of the element
    document.head.append(style);

    // Async so authors get top-level await; sourceURL so stack traces say view.js, not "eval".
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    new AsyncFunction(`${js}\n//# sourceURL=view.js`)().catch((e) => {
      document.body.textContent = e && e.message ? e.message : String(e);
    });
  }

  // Arguments are nested under `args` so nothing a view sends can collide
  // with the envelope's own `type` / `id`.
  async function call(type, args) {
    await ready;
    const id = ++seq;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      port.postMessage({ type, id, args });
    });
  }

  async function send(type, args) {
    await ready;
    port.postMessage({ type, args });
  }

  // --- in-session cache: schema()/lists() only. list()/item()/image() are
  // --- never cached here — that would change data-freshness expectations
  // --- (CUSTOM-VIEWS-SPEC.md §4.4). ---
  let listsCache;
  const schemaCache = new Map();

  async function getSchema(name) {
    if (!schemaCache.has(name)) schemaCache.set(name, call("skye:schema", { name }));
    return schemaCache.get(name);
  }

  // --- stale-response guard: rapid list() calls with the same key (default:
  // --- the list name) supersede each other, so "click fast through a
  // --- calendar" can't paint an older month over a newer one. ---
  const latestByKey = new Map();

  // Collects every field name referenced anywhere in a structured query.
  function fieldsInQuery(query) {
    const names = new Set();
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.all)) node.all.forEach(walk);
      else if (Array.isArray(node.any)) node.any.forEach(walk);
      else if (node.not) walk(node.not);
      else if (typeof node.field === "string") names.add(node.field);
    };
    if (query?.where) walk(query.where);
    for (const o of query?.orderBy ?? []) if (typeof o?.field === "string") names.add(o.field);
    for (const s of query?.select ?? []) if (typeof s === "string") names.add(s);
    return [...names];
  }

  // Client-side DX check: a typo'd field name becomes a clear error here
  // instead of silently matching zero rows. The host re-validates
  // authoritatively regardless.
  async function assertFieldsExist(name, query) {
    const referenced = fieldsInQuery(query);
    if (referenced.length === 0) return;
    const columns = await getSchema(name);
    const known = new Set(columns.map((c) => c.name));
    const missing = referenced.filter((f) => !known.has(f));
    if (missing.length) {
      const err = new Error(`view.js: unknown field(s) on "${name}": ${missing.join(", ")}`);
      err.name = "unknownField";
      throw err;
    }
  }

  window.skye = {
    // The lists this view may read. Nothing here takes a Graph path or a URL.
    lists: async () => {
      if (!listsCache) listsCache = call("skye:lists");
      return listsCache;
    },

    schema: (name) => getSchema(name),

    // query: { where?, orderBy?: [{field, direction}], select?, top?, skip?, count?, cursor? }
    // where reuses SKYE's condition grammar: { all|any|not } over { field, operator, value }.
    // opts: { key?: string, keepStale?: boolean }
    list: async (name, query, opts = {}) => {
      await assertFieldsExist(name, query);
      const key = opts.key ?? `list:${name}`;
      const ticket = (latestByKey.get(key) ?? 0) + 1;
      latestByKey.set(key, ticket);

      const result = await call("skye:list", { name, query });
      if (!opts.keepStale && latestByKey.get(key) !== ticket) {
        const err = new Error("superseded by a newer list() call");
        err.name = "AbortError";
        throw err;
      }
      return result;
    },

    item: (name, id) => call("skye:item", { name, id }),

    // returns "how many rows match" without fetching them all.
    count: async (name, query) => {
      const result = await call("skye:list", { name, query: { ...(query ?? {}), count: true, top: 1 } });
      return result.totalCount ?? 0;
    },

    // returns a data: URI, ready for an <img src>.
    image: (name, id, field) => call("skye:image", { name, id, field }),

    // Host-mediated navigation. target is exactly one of:
    //   { view: "<id>", params? }              -> another view on this site
    //   { form: "<id>", itemId?, mode?, params? } -> a form on this site
    //   { url: "https://..." }                 -> external, only if allowlisted; opens a new tab
    navigate: (target) => call("skye:navigate", { target }),

    // demo only: probe results must be recorded outside the frame, because
    // a navigation probe destroys it either way.
    report: (label, verdict, ok) => send("skye:report", { label, verdict, ok }),
  };

  parent.postMessage({ type: "skye:hello" }, "*");
})();
