# Setting up SKYE on your SharePoint site

This guide is for a **site owner** who wants to use SKYE to put forms (and
optionally dashboards/calendars) on their SharePoint site. You do **not**
need to install or host anything — you use the SKYE web app your
organisation was given (something like `https://getskye.app`). What you
*do* need to set up lives in two places:

1. **Microsoft 365 (one-time, per organisation)** — a small "app
   registration" so SKYE is allowed to talk to your SharePoint on your
   behalf. This needs someone who administers Microsoft 365 apps. It's
   about 10 minutes and only happens once for the whole org.
2. **Your SharePoint site (per site)** — a `skye_data` folder and a
   config file. SKYE can create these for you from a button; you mostly
   just click through.

Once that's done, a form is just a small JSON file you create with SKYE's
visual builder, and you share it as a link.

---

## The mental model (30 seconds)

- SKYE reads **config files** from a folder called `skye_data` inside your
  site's **Site Assets** library. No config, no forms — the config *is*
  the app.
- Every form points at one **SharePoint list**. Submitting the form
  creates or edits an item in that list. SKYE never stores data itself.
- Everyone acts as **themselves**. SKYE can only see and change what the
  signed-in person could already see and change in SharePoint. There are
  no SKYE accounts.
- A form link looks like this — you'll get these ready-made from SKYE, you
  don't build them by hand:

  ```
  https://getskye.app/form?siteId=…&applicationId=…&tenantId=…#your-form-id
  ```

---

## Part 1 — Microsoft 365 app registration (hand this to your admin)

> **Who:** whoever manages app registrations in Microsoft Entra ID (Azure
> AD) — often IT. **When:** once per organisation. Skip this if your org
> has already done it — just get the two IDs from step 1.5 and move on.

SKYE authenticates as a **single-page app** using *your* organisation's
app registration. Nothing is hard-coded; the SKYE web app takes the IDs
from the URL.

**1.1 — Create the registration.** In the [Entra admin
center](https://entra.microsoft.com) → *Applications* → *App registrations*
→ **New registration**:
- Name: `SKYE`
- Supported account types: **Accounts in this organizational directory
  only** (single-tenant) is fine and simplest.
- Redirect URI: platform **Single-page application (SPA)**, value = the
  exact SKYE web app URL your org uses, e.g. `https://getskye.app`
  (no trailing slash, no path).

**1.2 — Add the API permissions.** *API permissions* → *Add a permission*
→ *Microsoft Graph* → **Delegated permissions**, add all five:

| Permission | Used for |
|---|---|
| `Sites.Selected` | Reading/writing the SharePoint lists your forms use. **Required.** |
| `User.ReadBasic.All` | The "person" picker (search your directory for a name). |
| `Chat.Create` | Optional: a form that sends a Teams chat message when submitted. |
| `ChatMessage.Send` | Same as above. |
| `Mail.Send` | Optional: a form that sends an email when submitted. |

> **Add all five even if you only want basic forms.** SKYE asks for the
> whole set in one go at sign-in; if any one of them hasn't been consented,
> sign-in fails for everyone. The four optional ones do nothing until a
> form uses them.

**1.3 — Grant admin consent.** On the same page, click **Grant admin
consent for \<your org\>**. Every row should show a green tick.

**1.4 — Approve SKYE for your specific site(s).** `Sites.Selected` means
the app has **zero** SharePoint access until a site is explicitly
approved for it. Two ways, either is fine:
- **SharePoint Admin Center → *Advanced* → *API access*** — if your tenant
  shows pending requests here, approve SKYE. (Not all tenants enable
  this.) Or,
- **A `Sites.FullControl.All` script** run once per site by an admin:
  `POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions` with
  body `{ "roles": ["write"], "grantedToIdentities": [{ "application": {
  "id": "<the SKYE client id>", "displayName": "SKYE" } }] }`. Use
  `"write"` (not `"read"`) so site owners can let SKYE create the
  `skye_data` folder; you can tighten specific sites to `"read"` later.

**1.5 — Copy the two IDs** from the app registration's *Overview* page:
- **Application (client) ID** — this is the `applicationId` in every SKYE
  link.
- **Directory (tenant) ID** — this is `tenantId`. Always include it in
  links; it's only strictly required for a single-tenant registration,
  but including it never hurts.

Give both IDs to your site owners.

---

## Part 2 — Turn SKYE on for your site

> **Who:** a **site owner** (you need permission to add files to the
> site). **When:** once per site.

**2.1 — Make sure the site has a Site Assets library.** Most modern Team
and Communication sites already do. If SKYE says it's missing in the next
step, just create and **save** any page on the site (Home → *+ New* →
*Page* → *Save*) — that creates Site Assets automatically — then click
*Check again*.

**2.2 — Open the switcher.** Go to:

```
https://getskye.app/switcher?applicationId=<client-id>&tenantId=<tenant-id>
```

Sign in with your work account when prompted. (First time only, it may ask
for your work email to find your organisation.)

**2.3 — Add your site.** In the **"Set up SKYE on another site"** box,
paste a link to your site — the site home page, a document library, a
Teams channel link, anything on the site works; SKYE trims it down to the
site. Click **Continue**.

- If SKYE isn't set up there yet, it asks to confirm, then creates:
  ```
  Site Assets/
    skye_data/
      config/skye.config.json      ← the site's SKYE settings (starts empty)
      forms/                        ← your form configs go here
      views/                        ← optional dashboards/calendars go here
  ```
- If you see **"you don't have permission to add files here"**, either
  you're not a site owner, or Part 1.4 (approving SKYE for this site)
  hasn't been done — check with your admin.

**2.4 — Lock down the `skye_data` folder.** SKYE then shows a **"Manage
permissions"** step. By default, site **Members** can edit SKYE's config
files. Most teams want Members to only *use* forms, not edit them. Click
the link it gives you (it opens SharePoint's permissions page for the
`skye_data` folder), choose **Stop Inheriting Permissions**, and set
Members to **Read** (leave Owners at Full Control / Edit). Then click
**I'm finished setting permissions**.

That's it — the site is ready. You'll land on the form/view picker (empty
for now).

---

## Part 3 — Create your first form

> **Who:** a site owner, or anyone you've granted edit access (see Part 4).

**3.1 — Open the builder** from the switcher's **"Create New Form
Config"** button, or directly:

```
https://getskye.app/builder?siteId=<site-id>&applicationId=<client-id>&tenantId=<tenant-id>
```

(The switcher hands you links with the right `siteId` filled in — easiest
to start there.)

**3.2 — Start a new form.** Give it a short id (letters, numbers,
hyphens — e.g. `event-signup`), pick the **SharePoint list** it writes to
from the dropdown, and click **Create**. SKYE pre-adds a field for every
**required** column on that list so the form can actually submit, stacked
in a single column.

**3.3 — Build it.** For each field:
- **Source** = *SharePoint column* to save the answer to a real list
  column (pick it from **Bind to** — SKYE guesses the right control type),
  or *Virtual* for a field that only drives logic and isn't saved.
- Set the label, whether it's required, which page it's on, and so on in
  the panel on the right. The left side is a live preview — click any
  field to edit it.
- Add **Pages** (tabs), **Post actions** (send an email/Teams message,
  redirect, show a message…), and layout under **Form settings**.

**3.4 — Save.** SKYE shows you exactly what changed, validates it against
the schema, and writes it to
`skye_data/forms/<your-id>/form.config.json`. Use **drafts** +
**Copy preview link** to test changes before publishing.

**3.5 — Share the form.** From the switcher, pick the form — SKYE gives
you the link. Or build it yourself:

```
https://getskye.app/form?siteId=<site-id>&applicationId=<client-id>&tenantId=<tenant-id>#event-signup
```

Hash options: `#event-signup` = new item · `#event-signup/42` = edit
item 42 · `#event-signup/42/view` = read-only.

### Prefer to hand-write the config?

Create `Site Assets/skye_data/forms/event-signup/form.config.json`. The
minimum is a `list`, at least one `page`, and at least one `field`:

```json
{
  "title": "Event Sign-up",
  "list": { "id": "<the list's GUID>" },
  "pages": { "main": { "title": "Sign up", "order": 1 } },
  "fields": {
    "name":  { "page": "main", "source": "sharepoint", "bindTo": "Title",
               "controlType": "text", "label": "Your name", "required": true },
    "email": { "page": "main", "source": "sharepoint", "bindTo": "Email",
               "controlType": "url", "label": "Email" }
  }
}
```

`bindTo` is the column's **internal** name, which isn't always its display
name (a column shown as "Email Address" might be `Email_x0020_Address` or
`Email0` internally). The builder's *Bind to* dropdown shows both and
picks the right value for you — this is the main reason to use the builder
rather than hand-writing.

The JSON Schema (`packages/form-config/src/schema/form.config.schema.json`)
has a plain-language description on every property, and
`pnpm lint:configs -- <folder>` validates a local copy before you upload.
Get a list's GUID from **List settings** → the `List=%7B…%7D` value in the
page URL, or from the builder's list dropdown.

---

## Part 4 — (Optional) show different fields to different people

SKYE never has its own roles — it uses **SharePoint folder permissions**.
Inside a form's folder you can add a subfolder named after a permission
level, e.g.:

```
skye_data/forms/event-signup/
  form.config.json          ← what everyone sees
  managers/form.config.json ← extra fields/pages, merged on top for people
                              who can open the "managers" folder
```

Break inheritance on `managers/` and give it only to the people who should
see the extra content. Overlays can **only add or loosen** — they can
never hide a field someone else sees or make a rule stricter. To let a
group edit form configs in the builder, list their folder name in
`skye_data/config/skye.config.json` under `"builderEditors"` and create a
matching `skye_data/config/<name>/` folder they can read.

---

## Part 5 — (Optional) Custom Views (dashboards, calendars)

A **view** is a small read-only web page (`view.html` + `view.css` +
`view.js`) you drop in `skye_data/views/<id>/`. It runs in a locked-down
sandbox with no network — it can only ask SKYE for data from lists you
allow. Full walkthrough: [`custom-views-authoring.md`](custom-views-authoring.md).

Before a view can read a list, add that list's **name** to
`skye_data/config/skye.config.json`:

```json
{
  "views": { "allowedLists": ["Events", "Registrations"] },
  "navigation": { "allowedExternalOrigins": [] },
  "builderEditors": []
}
```

Optionally set `"home": { "type": "view", "id": "team-dashboard" }` so a
bare visit to the site jumps straight to that view instead of the picker.

Open a view at
`https://getskye.app/view?siteId=<site-id>&applicationId=<client-id>&tenantId=<tenant-id>#team-dashboard`.

---

## Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| Sign-in popup closes immediately / "user cancelled" | Single-tenant app registration but no `tenantId` in the URL | Add `&tenantId=<tenant-id>` |
| Sign-in fails with a consent/permission error | One of the five Graph permissions isn't admin-consented | Part 1.2–1.3 — add all five, click *Grant admin consent* |
| "SKYE isn't set up here yet" | No `skye_data/config/skye.config.json` on the site | Part 2 — run the switcher's "Set up SKYE on another site" |
| "One step in SharePoint first" | Site has no Site Assets library | Create + save any page, then *Check again* |
| "You don't have permission to add files here" | Not a site owner, **or** SKYE not approved for this site | Part 1.4 (admin approves the site) / use an owner account |
| Form loads but submit fails | A required list column has no field, or the person lacks list access | Builder shows a "missing required columns" panel — add them; check the person can add items to the list |
| A field never shows up | Its `page` doesn't match a real page id, or a `visibleIf` rule is hiding it | Fix the `page` value (the builder's dropdown prevents this) |
| Calendar/meeting post-action does nothing | Those Graph permissions aren't granted in most tenants | Use a `redirect` post-action to a prefilled Outlook/Teams compose link instead |

**The diagnostics page.** `https://getskye.app/diag?applicationId=<client-id>&tenantId=<tenant-id>`
runs the real sign-in and checks each permission and each site grant one
by one, telling you exactly which layer is failing. Paste a site id in the
box to test that site's `Sites.Selected` grant. Use it whenever setup
"just doesn't work".

---

## Reference: what lives where

```
<your site>/Site Assets/skye_data/
  config/
    skye.config.json          site-wide settings: views.allowedLists,
                               navigation.allowedExternalOrigins, home, builderEditors
    <permission>/skye.config.json   optional overlays (additive only)
  forms/
    <form-id>/
      form.config.json        the form
      <permission>/form.config.json   optional overlays (additive only)
      _drafts/<name>/form.config.json  builder drafts (managed by the builder)
  views/
    <view-id>/
      view.html  view.css  view.js
      view.json               optional: { "title": "…" } for the picker label
```

- **`ARCHITECTURE.md`** — how the whole thing fits together.
- **`custom-views-authoring.md`** — writing a view.
- **`custom-views-spec.md`** — the view sandbox's security model.
