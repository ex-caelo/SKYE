# Luddy LLC Event Proposal — form config

Two files:

| File | Who sees it | What it adds |
|---|---|---|
| `form.config.json` | everyone | Basics, Metrics, Purchases pages |
| `admin/form.config.json` | only people who can open the `admin/` folder in SharePoint | the **Approval** page + the approve/deny post-actions |

Upload both to
`Site Assets/skye_data/forms/luddy-llc-event-proposal/` (keep the `admin/`
subfolder). Then break inheritance on `admin/` and grant it only to your
approver group. The folder name `admin` is arbitrary — rename it to
whatever your permission group is, it just has to match on disk.

Open it at:

```
https://<skye-app>/form?siteId=<site-id>&applicationId=<client-id>&tenantId=<tenant-id>#luddy-llc-event-proposal          (new proposal)
https://<skye-app>/form?siteId=<site-id>&applicationId=<client-id>&tenantId=<tenant-id>#luddy-llc-event-proposal/<itemId>  (edit / admin review)
```

---

## 1. Fill in the placeholders

Everything below was reconciled against the live IU tenant on 2026-09 and
is filled in already, **except one**:

| Value | Where | Status |
|---|---|---|
| site id `b5a3efce-2a68-4fa3-9bbb-ba300ede5f73` | `form.config.json` → `list.siteId`; `admin/…` → `recordBeInvolvedIds.request.url` | ✅ set |
| Events list `62e36118-9efa-43b8-a539-18f0d73fff34` | `form.config.json` → `list.id`; `admin/…` → `recordBeInvolvedIds.request.url` | ✅ set |
| Purchases list `3ad9fead-6ec6-473b-93d3-b0aeeaef427c` | `form.config.json` → `purchaseTable.table.relatedList.id` | ✅ set |
| Documents library drive id `b!zu-jtWgqo0-bu7owDt5fc7hFb7GyOOBGk33wD3uiCrAn1ihq4oPKQaTBjm2d_8D2` | `form.config.json` → `poster.fileStorage.library.driveId` | ✅ set |
| `"submittedByOrganizationId": 0` | `admin/…` → `createBeInvolvedEvent.args[0]` | ⚠️ **still a placeholder** — the numeric BeInvolved / Engage organization id that will own the event; **must stay a number, not a string** |

Optional, in `admin/…` → `createBeInvolvedEvent.args[0]`:

- add `"apiKey": "…"` unless your BeInvolved deployment injects the key via a proxy;
- add `"baseUrl": "https://<your-campus>.campuslabs.com/engage/api"` for a whitelabeled host (default is the standard Engage host).

---

## 2. Columns the form expects

`bindTo` is a column's **internal** name — often *not* the display name
(SharePoint encodes spaces/punctuation, e.g. "Photographer(s)" →
`Photographer_x0028_s_x0029_`). The `bindTo` values below were reconciled
against the **live Events list** (`62e36118-…`) on 2026-09, so they should
match as-is.

### Events list (`form.config.json`'s primary list)

| field | `bindTo` (real internal name) | Type on the list | Notes |
|---|---|---|---|
| eventTitle | `Title` | text | shown as "Título" |
| eventDescription | `EventDescription` | note | |
| startTime | `StartTime` | dateTime | |
| endTime | `EndTime` | dateTime | |
| location | `Location` | Choice (allow multiple) | |
| eventType | `HostRole` | Choice — single | no `EventType` column exists; `HostRole`'s choices are exactly `Peer Mentor or Staff` / `EBOARD` / `Townhall` |
| host | `Host` | Person | see person note below |
| cohosts | `Cohosts` | Person (multi) | |
| photographers | `Photographer_x0028_s_x0029_` | Person (multi) | |
| attire | `Attire` | Choice — single | |
| categories | `Categories` | Choice (allow multiple) | |
| studentSuccessDomain | `StudentSuccessDomain` | Choice (allow multiple) | |
| naceCompetencies | `NACECompetencies` | Choice (allow multiple) | |
| studentImpact | `StudentImpact_x002c_EventGoalsan` | note | |
| requiresPurchases | `RequiresPurchases` | Choice | |
| poster | *(none — `source: virtual`)* | `Poster` is an Image/Thumbnail column and a URL write to it 500s, so the field writes to **no column**; the file still uploads to `Documents/PHOTOS!/Event Posters/2026-2027/` |
| **admin overlay** | | | |
| status | `Status` | Choice | |
| purchaseStatus | `PurchaseStatus` | Choice | |
| attendanceCode | `AttendanceScannerAccessCode` | text | filled by the approve action |
| beInvolvedEventId | `BeInvolved_x0020_Event_x0020_Id` | text | (there's also a `BeInvolved_eventId` column — this one is the display "BeInvolved Event Id") |
| approvalComments | `ProposalResponseText` | text | best guess — no `ReviewComments` column exists; verify |

**Multi-value Choice columns.** `Location`, `Categories`,
`StudentSuccessDomain`, `NACECompetencies` are "Casillas / allow multiple
selections" on the list — good. Graph's `/columns` API doesn't reliably
report the multi flag, so SKYE sends `Collection(Edm.String)` for any
`checkboxGroup` field unless Graph *positively* says the column is
single-value; that's the right default here. Their allowed values live on
the SharePoint column — the form pulls them in automatically, no `options`
needed in the config. (If a column ever *is* single-value, the encoder
writes just the first pick and flags it in the "some values need a second
look" message rather than 400ing.)

### Purchases list (`3ad9fead-6ec6-473b-93d3-b0aeeaef427c`)

Column internal names dumped from the live list on 2026-09:

Column internal names + `Store` choices dumped live on 2026-09:

| config column | `bindTo` (real internal name) | Type | Notes |
|---|---|---|---|
| itemTitle | `Title` | Single line of text | |
| store | `Store` | Choice | choices **aren't** auto-loaded for a table column, so the config now carries a static `options` array copied from the live column: `In-Person: Kroger` / `In-Person: Target` / `In-Person: Other` / `Online: Amazon` / `Online: Other` / `Catering/Delivery` / `Software/Digital`. If the list's choices change, update the config too. |
| linkToItem | `LinktoItem` | Hyperlink | lowercase `t` — internal name is *not* `LinkToItem` |
| pricePerUnit | `PriceperUnit` | Currency | lowercase `p` — *not* `PricePerUnit` |
| quantity | `Quantity` | Number | |
| — (parent ref) | `k62e361189_d041078067_rlu` | Lookup → Events list, display name **"Master Item"** | used as `parentReferenceColumn`; the write becomes `k62e361189_d041078067_rluLookupId: <eventItemId>`. The list has a second, orphan-looking lookup to Events (`k62e361189_5dc8796ea4_rlu`, no friendly display name) — "Master Item" is the real one. Not yet write-tested (the live test still ran against the pre-fix deployed config). |

The Purchase Table appears on the Purchases page as soon as **Requires
Purchases = Yes**.

---

## 3. Known rough edges (verified against the live tenant, 2026-09)

- **Sign-in** now lands on a dedicated `/auth` page (no more "mini SKYE"
  in the popup). The SKYE app registration needs `<origin>/auth`
  registered as a **Single-page application** redirect URI —
  `http://localhost:4321/auth` for local, plus your production origin.
- **Person columns.** `Host` / `Cohosts` / `Photographers` are chip
  pickers. The **search is tenant-wide** — you can find any person in the
  directory (unchanged, and it stays that way for other forms). The
  **write** resolves each pick to their id in *this site's* User
  Information List and writes `<col>LookupId` / `Collection(Edm.Int32)`.
  **A person who has never opened this SharePoint site isn't in that
  list**, and Graph can't "ensure" a brand-new site user. When that
  happens the submit is now **blocked** with a red field warning naming
  the person ("… is not a member of this site …") — you remove or replace
  them rather than the item saving without them. (Writing an arbitrary
  tenant person as a new site user would need a SharePoint REST
  `ensureUser` call — a separate token audience — which SKYE doesn't do
  yet.) In live testing, two picked IU users hit this.
- **`EventType`.** There is no `EventType` column; the field is bound to
  `HostRole`, whose choices already match. If you add a real `EventType`
  column later, repoint `bindTo`.
- **Poster column.** If you'd rather make `Poster` an *Image* column than
  a *Hyperlink*, either keep it as Hyperlink, or set the `poster` field's
  `"source"` to `"virtual"` — the file still uploads to the library, it
  just isn't written to a column. The upload itself only needs the
  `write` grant on the Documents library.
- **`list.siteId`.** If a page load fails with *"Invalid hostname for this
  tenancy"*, the `list.siteId` in `form.config.json` is the culprit —
  delete that line (the `?siteId=` in the URL is already the correct
  full `hostname,siteCollectionId,webId` value), or set it to that same
  full 3-part id.
- **Poster file name / folder.** The file is uploaded to
  `Documents/PHOTOS!/Event Posters/2026-2027/` (from
  `fileStorage.library.folderPath` — intermediate folders are created if
  missing) and named from `fileStorage.fileNameTemplate`,
  `"{{date:startTime}} {{fields.eventTitle}} Poster"`, e.g.
  `2026.03.14 Spring Hackathon Poster.png`. The original extension is
  kept. Adjust the template to taste.
- **Attendance scanner code.** `engage.createEvent` today returns only
  `{ eventId, name, startsOn, endsOn }`. `BeInvolvedEventId` populates
  now; `AttendanceScannerAccessCode` stays blank until
  `engage.createEvent` is extended to pass through whatever field the
  live BeInvolved response carries for it. The config already wires
  `{{results.createBeInvolvedEvent.accessCode}}`, so it starts working
  the moment that field is added — no config change needed.
- **`hostEmail` on the Approval page.** The people picker's value is an
  email once a directory result carries one — but BeInvolved's submitter
  and the Teams chat members are read from explicit fields (`hostEmail`,
  `reviewer`) so the approver stays in control of exactly who is
  contacted. Fill both before approving.
- **Approval page in create mode.** Pages can't be gated by
  create-vs-edit, only by field values, so for an admin the Approval tab
  also appears on a brand-new proposal. In practice an approver opens an
  existing item (`#luddy-llc-event-proposal/<itemId>`).
- **Edit / admin review now prefills.** Opening
  `#luddy-llc-event-proposal/<itemId>` (or `…/<itemId>/view`) loads the
  existing item and seeds every bound field — text, dates, multi-choice
  dropdowns, and person chips — so an approver edits real data instead of
  a blank form. Verified live 2026-09 against a real item: title,
  description, both datetimes, all four multi-Choice dropdowns, `HostRole`
  and `Attire`, and person chips all repopulate. A saved person shows as a
  chip; on re-save its already-resolved site-user id is reused rather than
  re-looked-up. If the item can't be loaded the form falls back to blank
  (and logs why).
  - *Known cosmetic wart:* a **single**-person column (`Host`) sometimes
    comes back from Graph as just the numeric id, so its chip label reads
    e.g. "14" instead of the person's name (multi-person columns like
    `Photographer(s)` return the full name and label correctly). The value
    is still correct and re-saves fine; only the label is affected.
- **Approval confirmation message.** `decisionRecorded` ("Decision
  recorded and the host has been notified.") now only fires when **Status
  = Approved or Denied**. Any other admin save shows `changesSaved`
  ("Changes saved. No approval decision was recorded…") instead, so a
  routine edit no longer claims the host was notified.

---

## 4. What the approve / deny actions do

Set **Status** on the Approval page, add a **comment**, pick yourself in
**Notify in Teams**, and Save.

**Status = Approved** →
1. `createBeInvolvedEvent` — `engage.createEvent` with the event details + `hostEmail` as submitter.
2. `recordBeInvolvedIds` — PATCHes `BeInvolvedEventId` (and the access code once available) back onto the SharePoint item.
3. `openTeamsChatApproved` → `sendApprovalMessage` — a Teams group chat with the host + you, carrying the access code, BeInvolved id, and your comment.

**Status = Denied** →
`openTeamsChatDenied` → `sendDenialMessage` — a Teams group chat with the host + you and your comment. Nothing is created in BeInvolved.

**Status = anything else** (a routine edit — comments, purchase status,
etc.) → no Teams chat, no BeInvolved call; `changesSaved` shows "Changes
saved. No approval decision was recorded…".

Run `pnpm lint:configs -- <path-to-skye_data/forms>` after any edit.
