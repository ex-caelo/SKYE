# Authoring a SKYE Custom View

A **Custom View** is a small web page you write — `view.html`, plus
optionally `view.css` and `view.js` — that SKYE renders as a read-only UI
(a calendar, a chart, a dashboard) backed by your SharePoint lists. You
put the file(s) in a folder under your site's `skye_data/views/` library:

```
skye_data/views/team-calendar/
  view.html
  view.css       (optional)
  view.js        (optional)
  view.json      (optional — { "title": "Team calendar" } for the switcher label)
```

**Two ways to lay this out, both fully supported:**

- **Three files** — `view.css` for styles, `view.js` for code, `view.html`
  for structure. Good for a longer view where separate files stay easier
  to navigate.
- **One file** — skip `view.css`/`view.js` entirely and write a `<style>`
  and a `<script>` directly inside `view.html`. Good for a short view
  where three tiny files are more overhead than help.

You can also mix them (some CSS/JS in the separate files, more inline in
`view.html`) — SKYE runs whatever it finds in either place. See "How it
runs" below for why an inline `<script>` here behaves exactly like a
separate `view.js`, not like a normal web page's script tag.

Then it's reachable at `/view?siteId=<id>&applicationId=<id>#team-calendar`.

Only **site owners** can add or edit view files. Anyone who can see the
site can open the rendered view.

---

## How it runs (and why the API looks the way it does)

Your code runs in a locked-down iframe:

- **no network** — `fetch`, `XMLHttpRequest`, `WebSocket`, remote images,
  remote scripts, and remote fonts are all blocked;
- **no access to the SKYE page** around it — no cookies, no tokens, no
  reading the parent DOM;
- **no navigation** — you can't set `location`, open popups, or submit
  forms out of the frame.

Everything your view needs comes through one global object, `skye`, which
talks to SKYE's trusted host code. The host holds the Microsoft Graph
token; your view never sees it. Every read the host makes runs as **the
signed-in viewer's own permissions** — a view can't show someone data
they couldn't already open in SharePoint themselves.

A `<script>` tag SKYE finds inside `view.html` is inert the instant the
page installs it — that's a normal, hard rule of how browsers handle
`<script>` elements inserted this way, true on any web page, not
something SKYE adds. So SKYE pulls that already-dead code's text back out
and runs it itself, the exact same way it runs a separate `view.js` —
whichever one you use (or both — they're just concatenated), you get
top-level `await` either way.

You don't need to style basic elements — the view inherits SKYE's
stylesheet (typography, buttons, tables). A `<style>` tag works fine
directly inside `view.html` (unlike `<script>`, a `<style>` inserted this
way takes effect immediately, no special handling needed) — `view.css` is
just the alternative for when you'd rather keep styles in their own file.

---

## The `skye` API

### `await skye.lists()`
Returns the list names this view is allowed to read (from the site's
`skye.config.json`). Naming any other list throws `listNotAllowed`.

### `await skye.schema(name)`
Returns the list's columns: `[{ name, label, type, required, choices? }]`.
`name` is the internal column name — that's what you use everywhere else.
Cached for the session.

### `await skye.list(name, query, opts?)`
Returns `{ items: [{ id, fields }], cursor?, totalCount? }`.

`query` is a structured object — there is **no** OData string:

```js
const page = await skye.list("Events", {
  where: {
    all: [
      { field: "Category", operator: "equals", value: "talk" },
      { any: [
        { field: "Capacity", operator: "greaterThan", value: 100 },
        { field: "Featured", operator: "isNotEmpty" },
      ] },
    ],
  },
  orderBy: [{ field: "Start", direction: "asc" }],
  select: ["Title", "Start", "Location"],
  top: 50,
});
```

**Filter grammar** (the same one SKYE forms use for `visibleIf`):

| shape | meaning |
|---|---|
| `{ field, operator, value }` | one condition |
| `{ all: [ … ] }` | every sub-condition true |
| `{ any: [ … ] }` | at least one true |
| `{ not: { … } }` | sub-condition false |

**Operators:** `equals`, `notEquals`, `in`, `notIn`, `greaterThan`,
`greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `contains` (string),
`isEmpty`, `isNotEmpty` (no `value`). `in` / `notIn` take an array.

**Paging:** pass `top` for a page size (max 200). The result's `cursor`,
if present, is an opaque token — pass it back as `query.cursor` for the
next page (all other query fields are then ignored).

**Bad field names** are caught before the query is sent and throw
`unknownField`, so a typo is a clear error, not a silently empty result.

**Rapid calls** to the same list supersede each other: if you fire a new
`skye.list("Events", …)` before the previous one resolves, the older
promise rejects with `AbortError`. Pass `opts.keepStale = true` to turn
that off, or `opts.key` to group differently.

### `await skye.count(name, query)`
Returns just the number of matching rows.

### `await skye.item(name, id)`
Returns `{ id, fields }` for one row.

### `await skye.image(name, id, field)`
Returns a `data:` URI for an image stored in (or linked from) a list
item's field — assign it straight to `img.src`. Rejects if the field
isn't a column on the list.

### `await skye.navigate(target)`
Sends the viewer somewhere. `target` is exactly one of:

```js
skye.navigate({ view: "other-view" });                 // another view on this site
skye.navigate({ form: "event-signup" });               // a form, create mode
skye.navigate({ form: "event-signup", itemId: "42" }); // edit an item
skye.navigate({ form: "event-signup", itemId: "42", mode: "view" });
skye.navigate({ url: "https://intranet.example.org/x" }); // external
```

Internal targets navigate the SKYE page. An **external** URL only works if
its exact origin (`https://host[:port]`) is listed in the site's
`skye.config.json` → `navigation.allowedExternalOrigins`, and it opens in
a new tab. Anything else throws `navBlocked`.

### `skye.report(label, verdict, ok)`
Only used by the `security-probes` demo view. Ignore it.

---

## The site config a view depends on

`skye_data/config/skye.config.json` (site owners edit this):

```json
{
  "views": {
    "allowedLists": ["Events", "EventDetails"]
  },
  "navigation": {
    "allowedExternalOrigins": ["https://intranet.example.org"]
  },
  "home": { "type": "view", "id": "team-calendar" }
}
```

- **`views.allowedLists`** — which lists any view on the site may name.
  Adding a list here doesn't grant anyone new access; it only lets a view
  *surface* a list the viewer can already read. It exists to keep views to
  a known, reviewed vocabulary.
- **`navigation.allowedExternalOrigins`** — origins `skye.navigate({ url })`
  may send someone to.
- **`home`** (optional) — a view or form the site opens to directly; when
  it's set, the site chooser is skipped.

Higher-permission overlays in `skye_data/config/[permission]/skye.config.json`
can only **add** to the allowlists, never remove.

If a site has no `skye.config.json` at all, views show "SKYE isn't set up
here yet."

---

## A minimal example

`view.html`
```html
<h2 id="title">Upcoming events</h2>
<ul id="list"></ul>
```

`view.js`
```js
const rows = await skye.list("Events", {
  where: { field: "Start", operator: "greaterThanOrEqual", value: "2026-09-01" },
  orderBy: [{ field: "Start", direction: "asc" }],
  top: 20,
});

const ul = document.getElementById("list");
for (const { fields } of rows.items) {
  const li = document.createElement("li");
  li.textContent = `${fields.Start} — ${fields.Title}`;
  ul.append(li);
}
```

The same view as a single file:

`view.html`
```html
<h2 id="title">Upcoming events</h2>
<ul id="list"></ul>

<script>
  const rows = await skye.list("Events", {
    where: { field: "Start", operator: "greaterThanOrEqual", value: "2026-09-01" },
    orderBy: [{ field: "Start", direction: "asc" }],
    top: 20,
  });

  const ul = document.getElementById("list");
  for (const { fields } of rows.items) {
    const li = document.createElement("li");
    li.textContent = `${fields.Start} — ${fields.Title}`;
    ul.append(li);
  }
</script>
```

---

## Limits to know about

- One view = one page. No composing multiple views on a screen (yet).
- No persistent state — a view can't "remember the last month" across
  reloads (yet).
- No external libraries or fonts — bundle what you need into your three
  files, or do without.
- A view that stops responding (an infinite loop, a hang) is torn down
  after ~15 seconds.
- Calls are rate-limited; a tight loop of `skye.list()` calls will start
  getting `429` errors.
