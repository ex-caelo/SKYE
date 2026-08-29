import { acquireTokenPopupOnly, createAuthProvider, GRAPH_SCOPES } from "../lib/auth/authProvider.js";
import { createRealGraphFetch } from "../lib/graph/rawGraphFetch.js";
import { RealGraphClient } from "../lib/graph/graphClient.js";

/**
 * Entry point loaded by pages/diag.astro. A standalone diagnostic tool, not
 * part of SKYE's real routing — see diag.astro's own comment. Always talks
 * to the REAL Graph API regardless of PUBLIC_MOCK_GRAPH (constructs
 * RealGraphClient/createRealGraphFetch directly, bypassing the mock switch
 * in createGraphClient.ts/createGraphFetch.ts entirely), since the whole
 * point is diagnosing real-tenant auth/permissions issues.
 */

interface CheckRow {
  name: string;
  status: "pending" | "ok" | "fail" | "skipped";
  detail: string;
}

/** Which of the expensive, repeatable sections to run — each is a batch of individual interactive prompts, so once a section's answer is already known, leave it unchecked rather than re-clicking through it every run. */
interface DiagnosticOptions {
  runScopeProbes: boolean;
  runCalendarDeepDive: boolean;
  runExploratoryScopes: boolean;
}

/** Pushes a single "intentionally not run" row for a whole skipped section, so the results table still says what didn't happen and why, rather than just having fewer rows. */
function pushSkippedRow(rows: CheckRow[], tbody: HTMLTableSectionElement, name: string) {
  rows.push({ name, status: "skipped", detail: "Skipped — check the box above to re-run this section." });
  renderRows(tbody, rows);
}

function readableError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Renders the current list of check rows into the results table, called after every state change so progress streams in live rather than appearing all at once at the end. */
function renderRows(tbody: HTMLTableSectionElement, rows: CheckRow[]) {
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = row.name;
    tr.appendChild(nameCell);

    const statusCell = document.createElement("td");
    statusCell.textContent =
      row.status === "pending" ? "…" : row.status === "ok" ? "✅ OK" : row.status === "skipped" ? "⏭️ SKIPPED" : "❌ FAIL";
    statusCell.dataset.level = row.status === "ok" ? "success" : row.status === "fail" ? "error" : undefined;
    tr.appendChild(statusCell);

    const detailCell = document.createElement("td");
    detailCell.textContent = row.detail;
    tr.appendChild(detailCell);

    tbody.appendChild(tr);
  }
}

/** Runs one raw Graph fetch check, recording ok/fail with the actual status code and a snippet of the response body (or thrown error) as the detail — this is what actually distinguishes "consent/auth broken" from "this one scope/site is forbidden" from "everything else". */
async function runFetchCheck(
  rows: CheckRow[],
  tbody: HTMLTableSectionElement,
  name: string,
  makeRequest: () => Promise<Response>
): Promise<void> {
  const row: CheckRow = { name, status: "pending", detail: "" };
  rows.push(row);
  renderRows(tbody, rows);

  try {
    const response = await makeRequest();
    if (response.ok) {
      row.status = "ok";
      row.detail = `${response.status} ${response.statusText}`;
    } else {
      const body = await response.text().catch(() => "");
      row.status = "fail";
      row.detail = `${response.status} ${response.statusText} — ${body.slice(0, 300)}`;
    }
  } catch (err) {
    row.status = "fail";
    row.detail = readableError(err);
  }
  renderRows(tbody, rows);
}

/** Same shape as runFetchCheck, but for checks that go through a GraphClient method (searchPeople, getListColumns) rather than a raw endpoint — exercises the exact method SKYE's real UI calls, not just a hand-rolled fetch. */
async function runClientCheck(rows: CheckRow[], tbody: HTMLTableSectionElement, name: string, run: () => Promise<string>): Promise<void> {
  const row: CheckRow = { name, status: "pending", detail: "" };
  rows.push(row);
  renderRows(tbody, rows);

  try {
    row.detail = await run();
    row.status = "ok";
  } catch (err) {
    row.status = "fail";
    row.detail = readableError(err);
  }
  renderRows(tbody, rows);
}

/** Token-acquisition-only check (no Graph call at all) — used by the per-scope probes below, where the point IS the acquisition itself, isolated from any specific endpoint. Returns whether it succeeded, so a read/write check that depends on this specific scope can skip itself with a clear reason instead of failing confusingly. `label` overrides the display name (e.g. to add a category prefix) without changing the actual scope string requested from MSAL. */
async function runScopeProbe(
  rows: CheckRow[],
  tbody: HTMLTableSectionElement,
  applicationId: string,
  tenantId: string | undefined,
  scope: string,
  label: string = scope
): Promise<boolean> {
  const row: CheckRow = { name: `Acquire token for scope: ${label} (alone)`, status: "pending", detail: "" };
  rows.push(row);
  renderRows(tbody, rows);

  try {
    await acquireTokenPopupOnly(applicationId, tenantId, [scope]);
    row.status = "ok";
    row.detail = "Token acquired for this scope alone.";
  } catch (err) {
    row.status = "fail";
    row.detail = readableError(err);
  }
  renderRows(tbody, rows);
  return row.status === "ok";
}

/**
 * Exploratory scopes for FUTURE actions/postActions — not part of the app's real GRAPH_SCOPES
 * (which reflects what's actually shipped), not yet known to be granted at all. Token-acquisition
 * probes only, same as GRAPH_SCOPES/CALENDAR_SCOPES_TO_TEST's own probes — no read/write Graph call
 * per scope, since most of these (Teams activity, notifications, user activity) have no natural
 * "read" verification anyway, and a full read/write test per scope across this many would mean a
 * lot of real Graph mutations for scopes with no concrete use case yet. Grouped by category so the
 * results table reads in the same groups they were requested in.
 */
const EXPLORATORY_SCOPES_TO_TEST: Array<{ scope: string; category: string }> = [
  { scope: "ChannelMessage.Send", category: "Teams channels" },
  { scope: "Team.ReadBasic.All", category: "Teams channels" },
  { scope: "Channel.ReadBasic.All", category: "Teams channels" },
  { scope: "TeamsActivity.Send", category: "Teams activity feed" },
  { scope: "Presence.Read", category: "Presence" },
  { scope: "Presence.ReadWrite", category: "Presence" },
  { scope: "Presence.Read.All", category: "Presence" },
  { scope: "OnlineMeetings.ReadWrite", category: "Online meetings" },
  { scope: "Files.ReadWrite", category: "Files" },
  { scope: "Files.ReadWrite.AppFolder", category: "Files" },
  { scope: "Tasks.ReadWrite", category: "Tasks/Planner" },
  { scope: "Tasks.ReadWrite.Shared", category: "Tasks/Planner" },
  { scope: "Chat.ReadBasic", category: "Chat read" },
  { scope: "ChatMessage.Read", category: "Chat read" },
  { scope: "Notifications.ReadWrite.CreatedByApp", category: "Notifications" },
  { scope: "People.Read", category: "People" },
  { scope: "UserActivity.ReadWrite.CreatedByApp", category: "User activity" },
  { scope: "UserNotification.ReadWrite.CreatedByApp", category: "User notifications" },
  { scope: "BookingsAppointment.ReadWrite.All", category: "Bookings" },
  { scope: "Bookings.Manage.All", category: "Bookings" },
  { scope: "Bookings.Read.All", category: "Bookings" },
  { scope: "Bookings.ReadWrite.All", category: "Bookings" },
];

/** Calendar-related scopes worth distinguishing individually — deliberately separate from the app's real GRAPH_SCOPES, since only one of these would ever actually ship; this is a one-time comparison to decide which. */
const CALENDAR_SCOPES_TO_TEST = ["Calendars.Read.Shared", "Calendars.ReadBasic", "Calendars.ReadWrite", "Calendars.ReadWrite.Shared"];

/** Summarizes one Graph event's key fields into a short, human-checkable line — enough to visually confirm real data came back, without dumping the whole raw object. */
function summarizeEvent(event: Record<string, unknown>): string {
  const subject = (event.subject as string | undefined) ?? "(no subject)";
  const start = (event.start as { dateTime?: string } | undefined)?.dateTime ?? "?";
  const end = (event.end as { dateTime?: string } | undefined)?.dateTime ?? "?";
  const organizer = (event.organizer as { emailAddress?: { name?: string; address?: string } } | undefined)?.emailAddress;
  const organizerLabel = organizer?.name ?? organizer?.address ?? "unknown organizer";
  return `"${subject}" | ${start} → ${end} | organizer: ${organizerLabel}`;
}

/**
 * For each calendar scope, in isolation: lists the signed-in user's own calendars by name, then
 * samples one event from EACH calendar found, so every calendar's access is individually
 * confirmable rather than just "it worked" once. Deliberately read-only (no event created) —
 * an actual calendar write-test would need an explicit ask and a safe target, same reasoning as
 * the Teams/email scopes elsewhere in this file.
 */
async function runCalendarScopeDeepDive(applicationId: string, tenantId: string | undefined, rows: CheckRow[], tbody: HTMLTableSectionElement) {
  for (const scope of CALENDAR_SCOPES_TO_TEST) {
    const calendarsRow: CheckRow = { name: `GET /me/calendars (scope: ${scope})`, status: "pending", detail: "" };
    rows.push(calendarsRow);
    renderRows(tbody, rows);

    try {
      const token = await acquireTokenPopupOnly(applicationId, tenantId, [scope]);
      const scopedFetch = (path: string) => fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` } });

      const res = await scopedFetch("/me/calendars");
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        calendarsRow.status = "fail";
        calendarsRow.detail = `${res.status} ${res.statusText} — ${body.slice(0, 300)}`;
        renderRows(tbody, rows);
        continue; // no calendars to sample events from for this scope
      }
      const data = await res.json();
      const calendars = (data.value as Array<Record<string, unknown>>).map((c) => ({ id: c.id as string, name: (c.name as string) ?? "(unnamed)" }));
      calendarsRow.status = "ok";
      calendarsRow.detail = calendars.length ? `Calendars: ${calendars.map((c) => c.name).join(", ")}` : "No calendars returned (empty list, not an error).";
      renderRows(tbody, rows);

      for (const calendar of calendars) {
        const eventRow: CheckRow = {
          name: `GET /me/calendars/.../events?$top=1 (scope: ${scope}, calendar: "${calendar.name}")`,
          status: "pending",
          detail: "",
        };
        rows.push(eventRow);
        renderRows(tbody, rows);
        try {
          const eventsRes = await scopedFetch(`/me/calendars/${calendar.id}/events?$top=1`);
          if (!eventsRes.ok) {
            const body = await eventsRes.text().catch(() => "");
            eventRow.status = "fail";
            eventRow.detail = `${eventsRes.status} ${eventsRes.statusText} — ${body.slice(0, 300)}`;
          } else {
            const eventsData = await eventsRes.json();
            const events = eventsData.value as Array<Record<string, unknown>>;
            eventRow.status = "ok";
            eventRow.detail = events.length ? summarizeEvent(events[0]) : "Calendar has no events to sample (empty, not an error).";
          }
        } catch (err) {
          eventRow.status = "fail";
          eventRow.detail = readableError(err);
        }
        renderRows(tbody, rows);
      }
    } catch (err) {
      calendarsRow.status = "fail";
      calendarsRow.detail = readableError(err);
      renderRows(tbody, rows);
    }
  }
}

/**
 * Tests whether calendar data — the signed-in user's own /me/events, AND the specific shared
 * calendar behind the real ICS link tested outside this tool — is reachable using ONLY a scope
 * already confirmed granted, deliberately excluding every Calendars.* / OnlineMeetings scope
 * entirely. Per Graph's documented permission model, Calendars.* should be the ONLY scope family
 * gating this resource — no other scope should incidentally grant it — but that's exactly the
 * kind of assumption worth verifying against the real tenant rather than trusting the docs
 * blindly, especially once a token genuinely has NO calendar-related scope in it at all.
 */
async function runCalendarAccessWithCurrentScopes(
  applicationId: string,
  tenantId: string | undefined,
  rows: CheckRow[],
  tbody: HTMLTableSectionElement
) {
  // Any already-confirmed-working scope would do — User.ReadBasic.All is picked because it's
  // unrelated to calendars/mail/sites, making it obvious this token carries no calendar access
  // by construction, not by accident.
  const NON_CALENDAR_SCOPE = "User.ReadBasic.All";
  // The mailbox behind the real published-ICS link tested earlier this session.
  const SHARED_CALENDAR_OWNER = "f4d4003a2c8f4d76a186ce29f6eab54c@iu.edu";

  const tokenRow: CheckRow = {
    name: `Acquire token for calendar-access test (scope: ${NON_CALENDAR_SCOPE} — deliberately NO Calendars.* scope at all)`,
    status: "pending",
    detail: "",
  };
  rows.push(tokenRow);
  renderRows(tbody, rows);

  let token: string;
  try {
    token = await acquireTokenPopupOnly(applicationId, tenantId, [NON_CALENDAR_SCOPE]);
    tokenRow.status = "ok";
    tokenRow.detail = "Token acquired.";
  } catch (err) {
    tokenRow.status = "fail";
    tokenRow.detail = readableError(err);
    renderRows(tbody, rows);
    return; // no token, nothing else to test with
  }
  renderRows(tbody, rows);

  const scopedFetch = (path: string) => fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` } });

  await runFetchCheck(rows, tbody, "GET /me/events?$top=1 (own calendar, using the non-calendar-scoped token above)", () => scopedFetch("/me/events?$top=1"));

  await runFetchCheck(
    rows,
    tbody,
    `GET /users/${SHARED_CALENDAR_OWNER}/calendar (the shared calendar's own metadata, same token)`,
    () => scopedFetch(`/users/${encodeURIComponent(SHARED_CALENDAR_OWNER)}/calendar`)
  );

  // Sampled + summarized via the same summarizeEvent used by the calendar deep dive above, not a
  // raw dump — near-certainly forbidden here, but stays consistent with that privacy-conscious
  // default in the unlikely case this one unexpectedly succeeds.
  const eventsRow: CheckRow = {
    name: `GET /users/${SHARED_CALENDAR_OWNER}/events?$top=1 (the specific shared calendar you linked, same token)`,
    status: "pending",
    detail: "",
  };
  rows.push(eventsRow);
  renderRows(tbody, rows);
  try {
    const res = await scopedFetch(`/users/${encodeURIComponent(SHARED_CALENDAR_OWNER)}/events?$top=1`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      eventsRow.status = "fail";
      eventsRow.detail = `${res.status} ${res.statusText} — ${body.slice(0, 300)}`;
    } else {
      const data = await res.json();
      const events = data.value as Array<Record<string, unknown>>;
      eventsRow.status = "ok";
      eventsRow.detail = events.length ? summarizeEvent(events[0]) : "Reachable, but no events returned (empty, not an error).";
    }
  } catch (err) {
    eventsRow.status = "fail";
    eventsRow.detail = readableError(err);
  }
  renderRows(tbody, rows);
}

async function runDiagnostics(
  applicationId: string,
  tenantId: string | undefined,
  siteIds: string[],
  listId: string | undefined,
  options: DiagnosticOptions,
  tbody: HTMLTableSectionElement
) {
  const rows: CheckRow[] = [];

  // Step 0: per-scope probes, one at a time, BEFORE the combined request below — isolates which
  // individual scope actually works vs. the combined request as a whole. These two can genuinely
  // differ: Azure AD sometimes requires a fresh consent when scopes are combined even though each
  // is individually already consented, so "each works alone but the combined one fails" is a real,
  // meaningful result here, not a contradiction. Every scope here has an already-known answer from
  // a prior run — re-running it is a whole batch of interactive prompts for no new information, so
  // this whole section is opt-in (see DiagnosticOptions/the form checkbox).
  if (options.runScopeProbes) {
    for (const scope of GRAPH_SCOPES) {
      await runScopeProbe(rows, tbody, applicationId, tenantId, scope);
    }
  } else {
    pushSkippedRow(rows, tbody, `Per-scope probes (${GRAPH_SCOPES.join(", ")})`);
  }

  // Step 1: calendar-scope deep dive — see runCalendarScopeDeepDive's own docstring. Deliberately
  // placed BEFORE the combined-token gate below, not after: this acquires its own isolated tokens
  // per calendar scope and never touches the shared graph/graphFetch built from the combined
  // request, so it has no real dependency on that succeeding. Also opt-in, same reasoning as the
  // scope probes above — the answer for all 4 calendar scopes is already known.
  if (options.runCalendarDeepDive) {
    await runCalendarScopeDeepDive(applicationId, tenantId, rows, tbody);
  } else {
    pushSkippedRow(rows, tbody, `Calendar-scope deep dive (${CALENDAR_SCOPES_TO_TEST.join(", ")})`);
  }

  // Step 1a: does any ALREADY-GRANTED, non-calendar scope incidentally reach calendar data anyway?
  // See runCalendarAccessWithCurrentScopes's own docstring. Independent for the same reason as the
  // deep dive above — its own isolated token, no dependency on the combined request. NOT gated by a
  // checkbox — this is the one thing here whose answer isn't already known yet.
  await runCalendarAccessWithCurrentScopes(applicationId, tenantId, rows, tbody);

  // Step 1b: exploratory scopes for future actions — see EXPLORATORY_SCOPES_TO_TEST's own comment.
  // Same independence reasoning as the calendar deep dive above. Also opt-in — 22 scopes' worth of
  // prompts, already answered once.
  if (options.runExploratoryScopes) {
    for (const { scope, category } of EXPLORATORY_SCOPES_TO_TEST) {
      await runScopeProbe(rows, tbody, applicationId, tenantId, scope, `${scope} [${category}]`);
    }
  } else {
    pushSkippedRow(rows, tbody, `Exploratory scopes for future actions (${EXPLORATORY_SCOPES_TO_TEST.length} scopes)`);
  }

  // Step 2: the combined request — everything from here on depends on THIS succeeding (it's what
  // the real app actually requests in one token; if it fails, there's genuinely no token to make
  // any of the read/write checks below with — that early return is intentional, not a bug). If
  // this fails/hangs even though every scope above worked alone, that itself is the diagnostic
  // answer. Uses acquireTokenPopupOnly, same as the probes above, so a cancelled/denied prompt
  // here reports as a normal failure too, instead of navigating away.
  const tokenRow: CheckRow = { name: "Acquire Graph token, ALL scopes combined (what the real app requests)", status: "pending", detail: "" };
  rows.push(tokenRow);
  renderRows(tbody, rows);
  try {
    await acquireTokenPopupOnly(applicationId, tenantId, GRAPH_SCOPES);
    tokenRow.status = "ok";
    tokenRow.detail = "Token acquired.";
  } catch (err) {
    tokenRow.status = "fail";
    tokenRow.detail = readableError(err);
    renderRows(tbody, rows);
    return; // nothing below can run without a token
  }
  renderRows(tbody, rows);

  const graphFetch = createRealGraphFetch(applicationId, tenantId);
  const graph = new RealGraphClient(createAuthProvider(applicationId, tenantId));

  // Step 3: baseline identity call — needs only openid/profile/email, no Sites.Selected or the
  // other app-specific scopes. If this fails too, the problem isn't scope-specific.
  await runFetchCheck(rows, tbody, "GET /me (baseline identity, no special scope)", () => graphFetch("/me", { method: "GET" }));

  // Step 4: Calendars.ReadWrite.Shared, against the signed-in user's OWN calendar (doesn't need
  // Sites.Selected or any site grant at all).
  await runFetchCheck(rows, tbody, "GET /me/events?$top=1 (Calendars.ReadWrite.Shared)", () => graphFetch("/me/events?$top=1", { method: "GET" }));

  // Step 5: User.ReadBasic.All, via the exact GraphClient method the peoplePicker control uses.
  await runClientCheck(rows, tbody, "searchPeople('') (User.ReadBasic.All, via GraphClient)", async () => {
    const people = await graph.searchPeople("");
    return `Returned ${people.length} result(s).`;
  });

  // Step 6: per-site checks — this is the one that isolates "which sites actually have a working
  // Sites.Selected grant" vs. a blanket scope/consent problem (steps 3-5 would already be failing
  // in that case). Two calls per site: a basic site read, then list enumeration (closer to what
  // getSkyeFormConfigFiles/getListColumns actually need). Graph's hostname:/path site addressing
  // (e.g. "indiana.sharepoint.com:/sites/Foo") needs a SECOND colon before appending a sub-resource
  // — GET /sites/{hostname}:/{path}:/lists, not .../{path}/lists — a raw site GUID needs no colon
  // at all. Missing this produced a confusing "does not represent a site" 404 that looked like a
  // permissions problem but wasn't one.
  const siteSubResourcePath = (siteId: string, subResource: string) => (siteId.includes(":") ? `/sites/${siteId}:${subResource}` : `/sites/${siteId}${subResource}`);
  for (const siteId of siteIds) {
    await runFetchCheck(rows, tbody, `GET /sites/${siteId} (Sites.Selected + this site's grant)`, () => graphFetch(`/sites/${siteId}`, { method: "GET" }));
    await runFetchCheck(rows, tbody, `GET .../lists for ${siteId} (list enumeration)`, () => graphFetch(siteSubResourcePath(siteId, "/lists"), { method: "GET" }));
  }

  // Step 7: the exact call getListColumns makes, if a specific list id was given — proves the full
  // real path SKYE's field-registry/populateChoiceOptions relies on, not just raw site access.
  if (siteIds[0] && listId) {
    await runClientCheck(rows, tbody, `getListColumns(${siteIds[0]}, ${listId})`, async () => {
      const columns = await graph.getListColumns(siteIds[0], listId);
      return `Returned ${columns.length} column(s): ${columns.map((c) => c.name).join(", ")}`;
    });
  }

  // Step 8: write test — reads succeeding doesn't imply writes do (Sites.Selected's per-site grant
  // has a separate read vs. write role, and IT's "Read/Write" label is worth verifying rather than
  // trusting). Runs independently of whether the reads above passed, since read/write access can
  // genuinely be asymmetric — deliberately create-then-immediately-delete, so no test debris is
  // left behind in a real list regardless of the outcome.
  if (siteIds[0] && listId) {
    let createdItemId: string | undefined;
    await runClientCheck(rows, tbody, `createListItem(${siteIds[0]}, ${listId}) — write test`, async () => {
      const item = await graph.createListItem(siteIds[0], listId, { Title: "SKYE diagnostic write test — safe to delete" });
      createdItemId = item.id;
      return `Created item id ${item.id}.`;
    });

    if (createdItemId) {
      const idToDelete = createdItemId;
      await runClientCheck(rows, tbody, `deleteListItem(${siteIds[0]}, ${listId}, ${idToDelete}) — cleanup`, async () => {
        await graph.deleteListItem(siteIds[0], listId, idToDelete);
        return "Deleted the test item — no leftover data in the list.";
      });
    }
  }
}

function main() {
  const appRoot = document.getElementById("skye-app");
  if (!appRoot) throw new Error('entry-diag: missing "#skye-app" mount point in the page.');

  const params = new URLSearchParams(window.location.search);

  appRoot.innerHTML = "";

  const heading = document.createElement("h1");
  heading.textContent = "SKYE — Graph Diagnostics";
  appRoot.appendChild(heading);

  const intro = document.createElement("p");
  intro.textContent =
    "Runs a battery of real Graph calls (never mocked) using SKYE's own auth/GraphClient code: the combined " +
    "request the real app makes, reads (baseline identity, each scope, each site), a write test (create + " +
    "immediate delete of a throwaway item, so nothing is left behind), and a calendar-access check using an " +
    "already-working non-calendar scope. The per-scope probes, calendar-scope deep dive, and exploratory-scope " +
    "batch are each a lot of individual popups and default OFF — their answers are already known from a prior " +
    "run; check a box below only to re-verify one (e.g. after IU grants a new permission). Isolates whether a " +
    "failure is upstream of any scope entirely (token/consent/app-registration), one specific scope, one " +
    "specific site's Sites.Selected grant, or read vs. write access specifically.";
  appRoot.appendChild(intro);

  const form = document.createElement("form");

  function labeledInput(labelText: string, id: string, placeholder: string, prefill: string): HTMLInputElement {
    const wrapper = document.createElement("div");
    wrapper.className = "skye-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    label.htmlFor = id;
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.placeholder = placeholder;
    input.value = prefill;
    wrapper.append(label, input);
    form.appendChild(wrapper);
    return input;
  }

  const applicationIdInput = labeledInput("Application (client) id", "applicationId", "required", params.get("applicationId") ?? "");
  const tenantIdInput = labeledInput("Tenant id (optional — omit for a multi-tenant app registration)", "tenantId", "optional", params.get("tenantId") ?? "");

  const siteIdsWrapper = document.createElement("div");
  siteIdsWrapper.className = "skye-field";
  const siteIdsLabel = document.createElement("label");
  siteIdsLabel.textContent = "Site ids to check (one per line)";
  siteIdsLabel.htmlFor = "siteIds";
  const siteIdsTextarea = document.createElement("textarea");
  siteIdsTextarea.id = "siteIds";
  siteIdsTextarea.rows = 4;
  siteIdsTextarea.value = (params.get("sites") ?? "").split(",").filter(Boolean).join("\n");
  siteIdsWrapper.append(siteIdsLabel, siteIdsTextarea);
  form.appendChild(siteIdsWrapper);

  const listIdInput = labeledInput(
    "List id, for a getListColumns check against the first site above (optional)",
    "listId",
    "optional",
    params.get("listId") ?? ""
  );

  // Each of these is a batch of individual interactive prompts (one popup per scope). Default OFF
  // — re-running an already-answered section every time is exactly the "a bunch of launch windows"
  // problem found during real-tenant testing. Check one back on only when you actually need to
  // re-verify it (e.g. after IU grants a new permission).
  function labeledCheckbox(labelText: string, id: string): HTMLInputElement {
    const wrapper = document.createElement("div");
    wrapper.className = "skye-field";
    const label = document.createElement("label");
    label.htmlFor = id;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    label.append(input, ` ${labelText}`);
    wrapper.appendChild(label);
    form.appendChild(wrapper);
    return input;
  }

  const runScopeProbesCheckbox = labeledCheckbox(`Re-run per-scope probes (${GRAPH_SCOPES.length} popups — already known)`, "runScopeProbes");
  const runCalendarDeepDiveCheckbox = labeledCheckbox(
    `Re-run calendar-scope deep dive (${CALENDAR_SCOPES_TO_TEST.length} popups — already known)`,
    "runCalendarDeepDive"
  );
  const runExploratoryScopesCheckbox = labeledCheckbox(
    `Re-run exploratory scopes for future actions (${EXPLORATORY_SCOPES_TO_TEST.length} popups — already known)`,
    "runExploratoryScopes"
  );

  const runButton = document.createElement("button");
  runButton.type = "submit";
  runButton.className = "skye-form__submit";
  runButton.textContent = "Run diagnostics";
  form.appendChild(runButton);

  appRoot.appendChild(form);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Check</th><th>Status</th><th>Detail</th></tr>";
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  appRoot.appendChild(table);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runButton.disabled = true;
    const applicationId = applicationIdInput.value.trim();
    const tenantId = tenantIdInput.value.trim() || undefined;
    const siteIds = siteIdsTextarea.value.split("\n").map((s) => s.trim()).filter(Boolean);
    const listId = listIdInput.value.trim() || undefined;

    if (!applicationId) {
      tbody.innerHTML = "";
      renderRows(tbody, [{ name: "Application id", status: "fail", detail: "Required — nothing to test without it." }]);
      runButton.disabled = false;
      return;
    }

    const options: DiagnosticOptions = {
      runScopeProbes: runScopeProbesCheckbox.checked,
      runCalendarDeepDive: runCalendarDeepDiveCheckbox.checked,
      runExploratoryScopes: runExploratoryScopesCheckbox.checked,
    };

    runDiagnostics(applicationId, tenantId, siteIds, listId, options, tbody).finally(() => {
      runButton.disabled = false;
    });
  });

  // Deliberately NOT auto-run on load, even when the URL has enough to go on — an interactive
  // MSAL flow (popup/redirect) is fragile against a page reload happening mid-interaction (a stray
  // reload can leave MSAL's "interaction in progress" flag stuck — see authProvider.ts's
  // handleRedirectPromise comment), so always require one explicit, deliberate click instead.
}

main();
