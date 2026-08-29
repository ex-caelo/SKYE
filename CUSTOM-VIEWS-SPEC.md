# SKYE Custom Views — Implementation Spec

**Audience:** engineer/agent extending the existing sandboxed custom-view prototype into a production-ready feature.
**Status of the existing code:** the prototype (`index.html`, `skye-host.js`, `skye-runtime.js`, `skye.css`, `mock-graph.js`, plus a `calendar` and `security-probes` demo view) already implements and has verified the core isolation boundary. This spec extends it — it does not replace the security model, which should be treated as correct and preserved exactly.

---

## 1. What this system is

SKYE lets SharePoint site users author custom UI ("views" — calendars, charts, dashboards) as plain HTML/CSS/JS files stored on the SharePoint site itself, without needing access to SKYE's own source or deploy pipeline. Because view authors are not vetted developers and their files are edited outside any code review process, the app treats view code as **untrusted at runtime**, isolates it in a sandboxed iframe with no origin, no network, and no DOM access to the host, and mediates every capability the view gets through a private, structured message channel to a trusted host script that holds the real Microsoft Graph credentials.

Read the existing `README.md` in the prototype in full before making changes — it documents the load sequence, the handshake, the message shapes, and a table of 17 specific attacks the current design already blocks (verified by the included `security-probes` demo view). Any change described below must not regress any row in that table.

---

## 2. Governing assumptions (confirmed with product owner — build against these)

- **Only SharePoint Site Owners can author/edit views.** Members can view the rendered output but cannot edit view files. This is expected to be enforced by SharePoint's own library permissions on wherever `skye_data/views/` lives (verify this holds for your provisioning setup) — SKYE does not need to independently re-check "can this person edit this file."
- **Custom Views are read-only.** Views never write to Graph/SharePoint. There is no create/update/delete capability for views, ever. (Forms, a separate part of the system driven by `form.config.json`, are the write path — see `form_config_schema.json` — and are out of scope for this spec.)
- **The threat direction is author → viewer, not author → host.** An Owner authoring a view already has far more access than the sandbox could ever grant them (they can edit SharePoint directly). The sandbox's job is protecting the **Member who views the page** from a view that is buggy, compromised, or malicious — specifically from having their own legitimately-readable data exfiltrated to somewhere they didn't consent to, or from the view acting as a confused deputy. It is *not* trying to stop an Owner from accessing anything, since SharePoint's ACLs already gate every actual data access, per-user, on every single call.
- **Every read executes as the viewing user's own delegated Graph token** (`Sites.ReadWrite.All`, delegated — not application permissions). The host never uses its own elevated identity on a view's behalf. This means: whatever the sandbox/config allows a view to *ask for*, SharePoint still independently decides whether that specific signed-in user may see it. Nothing described below is a substitute for that; it's all shape/vocabulary validation layered in front of it.

---

## 3. Non-negotiable security invariants — preserve exactly

These are already implemented in the prototype. Do not change them as part of adding new features. Any PR that touches these needs explicit sign-off, not just a passing test.

1. **`sandbox="allow-scripts"` only.** Never add `allow-same-origin` (combined with `allow-scripts` this hands the frame the host's real origin and lets it rewrite its own sandbox attribute). Never add `allow-popups`, `allow-forms`, `allow-top-navigation`, or `allow-top-navigation-by-user-activation`. Navigation is handled entirely through the message channel (see §4.1) — it must never become a granted browser capability.
2. **The frame's `srcdoc` never contains anything author-written.** It contains only the CSP meta tag, SKYE's own CSS, and SKYE's own runtime JS, all fetched by the host itself. The three view files (`view.html`, `view.css`, `view.js`) are delivered later, over the message port, and are installed via `innerHTML`/`textContent`/`Function()` constructor — never concatenated into the `srcdoc` string.
3. **The frame's CSP stays `default-src 'none'`**, with narrowly scoped exceptions only for what's needed to run the runtime (`script-src`/`style-src 'unsafe-inline'` (+ `'unsafe-eval'` for the AsyncFunction constructor), `img-src data:`). Do not add `connect-src`, remote `script-src`/`style-src`, or any other network-capable exception without a specific design for it (see §6, "external resource domains" — deferred).
4. **The handshake fail-closed check must remain**: before handing over the message port, the host must attempt to read `frame.contentWindow.document` and refuse to mount (`teardown()`) if that read succeeds instead of throwing. This is the proof the opaque-origin boundary is actually in place; do not skip or weaken it for convenience.
5. **Identify the frame by `e.source`, never by origin.** A sandboxed frame's origin is the literal string `"null"`, so an origin check would match any sandboxed frame on the page.
6. **The host is the only code that ever holds a Graph token or makes a real Graph call.** Nothing sent from a view can carry a raw Graph path, arbitrary OData string, or arbitrary URL. Every message type the host accepts must take structured, host-validated parameters (a list name, a structured filter array, an item id) — never a string the host would pass through unvalidated to Graph.
7. **`frame-src` on the top-level page (not just the frame's own CSP) must remain**, since that's what stops the view from navigating itself to an external URL — a plain CSP `connect-src`/`default-src` restriction inside the frame does not cover navigation.
8. Any new message type added to the host's dispatch table must go through the same validation discipline as the existing ones (`checkQuery`-style structural validation) — see §4 for what specifically needs validating for each new feature.

**Regression test requirement:** before merging, re-run (or extend) the `security-probes` demo view and confirm all existing probes still report BLOCKED, plus add probes for each new capability below (see §7).

---

## 4. New features to implement

### 4.1 Navigation

Views currently have no way to send a user anywhere. Add this as a mediated capability, not a browser permission.

- New runtime-facing method, e.g. `skye.navigate(destination, params)`, sending a new message type (e.g. `skye:navigate`) over the existing port.
- **The host decides what navigation actually means** — this must not be a pass-through:
  - **Internal SKYE destinations** (another form or view by id): host performs the real navigation on its own window. Safe by construction, since the host navigating itself isn't a sandbox-relevant action.
  - **External URLs**: host must apply a policy before following it. Minimum bar: show the actual destination URL to the user before navigating (so a mismatch between a button's label and its real target is visible), rather than silently following it. Stronger options to consider: an explicit allowlist of external domains, or opening in a new tab with `noopener`/`noreferrer` so the app itself is never navigated away.
- The message must carry parameters alongside the destination (e.g., an item id, a filter state) — not just a bare destination string — so a view can express "go to the detail view for item X," not only "go to view X." Retrofitting params later is more disruptive than including them now.
- **Do not** implement this via any `allow-top-navigation*` sandbox flag. That flag only proves a real user click occurred; it says nothing about where the click sends them, so a deliberately mislabeled "See details" button could pass that check while still exfiltrating data via the URL. Routing through the host, which can inspect/display the real destination, is the only version of this that's actually safe. (This mirrors `ui/open-link` in Anthropic's MCP Apps spec, worth reading as independent prior art for this exact problem: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)

### 4.2 Config-driven list allowlist

- Move the current hardcoded readable-list allowlist (`READABLE` in `mock-graph.js`, and its equivalent in the real Graph integration) into a config file the host reads — e.g. `skye_data/config/skye.config.json`, per the directory structure doc.
- **This config is a shape/vocabulary guardrail, not a permission boundary.** Document this distinction clearly in code comments and any developer docs: SharePoint still independently authorizes every read per-user regardless of what's in this file. Widening this config doesn't grant access to anything a given viewer couldn't already open directly in SharePoint — it only changes which of *that viewer's own readable lists* a given view is allowed to surface. Its actual job is preventing structural/shape attacks (arbitrary paths, malformed queries), not access control.
- Since this config will be Owner-editable (same library permissions as the view files themselves), it should be treated similarly to view files for versioning/audit purposes — SharePoint version history on the config file is sufficient; no additional review gate is required by this spec, but flag to product if a stricter posture (e.g., a separate "config steward" role) is wanted later.

### 4.3 Query capability gaps

The current query shape (`{filter: [...], orderby, select, top}`, all filter conditions ANDed) needs to grow before real (non-demo-sized) lists are usable:

- **OR logic**: filters currently only support implicit AND across the array. Add a way to express OR — most naturally by extending the structured condition shape to support `{any: [...]}` / `{all: [...]}` grouping (this mirrors the `condition` shape already defined in `form.config.schema.json` for form visibility rules — reuse that shape/vocabulary here for consistency rather than inventing a second condition grammar).
- **Sort direction**: `orderby` currently always sorts ascending. Add ascending/descending.
- **Pagination**: `top` exists but there's no `skip`/cursor. Add real paging support so a list of meaningful size doesn't require fetching everything at once.
- **Count**: no way to get "how many rows matched" without fetching all matching rows. Add a count/total capability.
- All of the above must go through the same host-side structural validation discipline as today's `checkQuery` (allowlisted operators, typed values, no free-form strings) — do not let any of this become a path to a raw OData filter string.

### 4.4 Client-side validation / DX

- Before sending a query, validate referenced field names against `skye.schema(listName)` client-side (inside the sandbox runtime, which already has access to schema) so a typo'd field name surfaces a clear, specific error to the author instead of silently returning zero matching rows.
- Add request cancellation (an `AbortController`-equivalent message, or a client-side "ignore stale responses" mechanism) so rapid repeated calls (e.g., fast clicking through a calendar) don't race and show stale data.
- Consider light in-session caching for `schema()`/`lists()` results specifically (these change rarely within a session) — do not cache `list()`/`item()` results without a product decision, since that affects data freshness expectations.

### 4.5 Read-only enforcement (structural, not a permission check)

- The host's message dispatch table (`API` in `skye-host.js`) must simply **have no handler at all** for any write-shaped operation (create/update/delete) for the view execution context. An author calling something write-shaped should get a plain "not a function" JS error, because the capability doesn't exist here — not a checked-and-denied 403. This is a stronger guarantee than a permission check and should be preferred structurally.
- Do not add any write message types to this code path as part of this work, even behind a flag. If/when forms need a write path, that should be designed and reviewed as its own effort, not bolted onto the read-only view runtime.

### 4.6 Operational hardening

- **Watchdog interval**: currently 4 seconds, explicitly flagged in the existing code comments as too aggressive for a genuinely slow (not hung) real-world render. Tune this for production load, and confirm it doesn't false-positive on legitimate chart/dashboard views doing real work.
- **Rate limiting**: currently an accepted, unaddressed gap (a view spamming calls in a loop can degrade the host page). Revisit whether this needs addressing now that this is heading toward production use rather than staying a demo-scale concern.
- **Batching**: if dashboard/chart views end up firing many small queries per render or interaction (this is likely — see §6), consider adding a batch message type so multiple queries can round-trip in a single request rather than N sequential `postMessage` round trips.

---

## 5. Explicitly NOT in scope for this pass

Do not build these now; they're flagged so they're not accidentally precluded by design choices made in this pass, but building them is future work pending product decisions:

- Any write capability for views (see §4.5).
- Cross-site queries (a single view pulling from more than one SharePoint site) — current design implicitly scopes to one site per view instance.
- Loading external JS/CSS/font resources into the sandbox (chart libraries, CDN fonts) — would require a CSP-exception mechanism (e.g., a view/config declaring needed origins, host building CSP from that declaration) that doesn't exist yet and needs its own security review before implementation. Don't add ad hoc `connect-src`/`script-src` exceptions without that design.
- Persistent state/storage for a view across reloads (e.g., "remember the last month viewed") — would require a new host-mediated storage message type, scoped per-view/per-user. Not present today; do not use any browser storage API directly inside the sandbox context (it has none available to it by design, and should stay that way for this pass).
- Multiple simultaneous view instances / composed multi-widget dashboards on one page — the current design (`skye-host.js`) assumes one view = one frame = one port = the whole page. Do not need to solve this now, but avoid introducing single-instance-only assumptions into new code that would make this harder later than necessary.
- Declarative `data-api-*` attribute bindings / custom-element-based authoring — a possible future ease-of-authoring layer discussed and deferred. See Appendix A for what that would require if picked up later; nothing in this pass should preclude it (in practice, that means: keep the message vocabulary name-based, e.g. list names not raw paths, since the declarative layer would rely on that same vocabulary).

---

## 6. Design context worth knowing (not requirements, but explains the "why")

- The message-vocabulary decision (list names + structured queries, never raw Graph paths or OData strings) was made deliberately after comparing it against exposing real Graph SDK paths directly. Real paths would require the host to parse and validate arbitrary OData query strings — a meaningfully larger and more error-prone security surface (path-encoding bypasses, `$expand` scope creep, batch-request smuggling) than validating a small, closed set of structured message types. Don't reverse this decision without re-opening that comparison.
- Chart/dashboard-style views are an explicit target use case (not just calendars), which is why §4.3 (query expressiveness) and the external-resource-loading question in §5 are called out — those are the two areas most likely to be hit hard by that view type specifically.

---

## 7. Testing expectations

- Extend the existing `security-probes` demo view with new probes covering each new capability:
  - Attempt to navigate to an external URL and confirm it does not silently succeed without going through host mediation.
  - Attempt to reference a list name not present in the config allowlist and confirm a clean, structural rejection (not a Graph-level error leaking implementation details).
  - Attempt to smuggle an OR/grouped condition or malformed filter shape into the new query grammar and confirm it's rejected the same way today's `checkQuery` rejects bad operators.
- Confirm all 17 existing probes in the current `security-probes` view still report BLOCKED after your changes — this is a regression gate, not optional.
- For the config allowlist: write a test confirming that a list absent from `mock-graph.js`'s `READABLE` array (or its config-driven equivalent) still 403s at the Graph layer even if a bug were to let it through the shape-validation layer — i.e., confirm defense-in-depth, not just that the primary check works.

---

## Appendix A — Forward-compatibility notes for a possible future declarative authoring layer

Not part of this implementation pass. Included so nothing built now closes this door.

- A future `data-api-*` attribute-binding system (and/or bundled custom elements like `<skye-bar-chart>`) would be implemented as an additional binding pass inside `skye-runtime.js`, executed after `mount()`, translating attributes into calls against the same `skye.*` functions this spec extends. It would require **no changes to `skye-host.js`, the CSP, the sandbox attribute, or the message envelope** — provided the message vocabulary stays list-name-based as specified above.
- No HTML sanitizer (e.g., DOMPurify) would be needed for this if it stays inside the existing sandbox — the sandbox already guarantees inert `<script>` execution and blocks network egress via CSP, which is what a sanitizer would otherwise need to separately guarantee in a same-origin context.
- If picked up later, it would additionally need: a directive-vocabulary spec, per-directive error handling (vs. today's whole-view error dump), and ideally a publish-time static validator that scans a view's HTML for all `data-api-*` references and checks them against the config allowlist before the view goes live.
