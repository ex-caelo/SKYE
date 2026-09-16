---
name: skye-form-config
description: >-
  Full reference for authoring SKYE form.config.json files (base configs and
  permission overlays): top-level shape, pages and grid layout, field
  controlTypes, the attributes/style allowlists, conditions, calculatedDisplay,
  lookupTable, post-actions and templating, the registered script action names,
  and worked examples. Use when building or editing a SKYE form config.
---

# SKYE Form Config — authoring reference

Detail layer behind the SKYE Form Assistant system instruction (which
carries the identity, hard rules, and response format).
`packages/form-config/src/schema/form.config.schema.json` is the ultimate
source of truth — keep this file in sync with it.

Both file kinds use this same shape:

- **Base** — `skye_data/forms/<id>/form.config.json`, seen by everyone.
- **Overlay** — `skye_data/forms/<id>/<permission>/form.config.json`, merged
  on top for one permission group. **Additive only**: add pages/fields/
  post-actions, or loosen a rule (`readonly: true` → `false`, a larger
  `maxlength`). Never remove, hide, or tighten; `null` is an authoring
  error, not a delete. Overlay field/page/post-action entries are **full
  objects** with all their required keys, not single-key patches.

## Top level

```jsonc
{
  "id": "event-signup",                 // optional, should match the folder name
  "title": "Event Sign-up",             // optional form title
  "description": "Intro copy shown under the title.",  // optional
  "mode": "both",                       // "create" | "edit" | "both" (default "both")
  "list": { "id": "<list GUID>", "siteId": "<optional site GUID>" },  // REQUIRED
  "layout": { "gridTemplateColumns": 12, "gap": "1rem" },  // optional form-wide grid defaults
  "pages":  { ... },                    // REQUIRED, at least one page
  "fields": { ... },                    // REQUIRED, at least one field
  "postActions": { ... }               // optional
}
```

`pages`, `fields`, and `postActions` are **objects keyed by a name you
choose** (letters/digits/underscore, must start with a letter; camelCase
recommended), not arrays.

## Pages

```jsonc
"pages": {
  "aboutYou": {
    "title": "About you",              // REQUIRED — the tab / step label
    "order": 1,                        // optional; lower = earlier. Unordered pages sort last.
    "visibleIf": { <condition> },      // optional; hides the whole step unless true.
                                       //   Only reference fields on EARLIER pages.
    "layout": {
      "gridTemplateColumns": "2fr 1fr",       // optional; overrides form-wide for this page
      "gap": "1rem",                          // optional
      "gridTemplateRows": "auto 200px auto",  // optional; rarely needed
      "gridTemplateAreas": [                  // the visual layout for this page
        "name name",
        "haiku campus"
      ]
    }
  }
}
```

Every form needs at least one page. A simple one-page form just declares
one. If you don't want a hand-tuned layout, set the page's
`gridTemplateColumns` to `1` and give each field its own row:

```jsonc
"layout": {
  "gridTemplateColumns": 1,
  "gridTemplateAreas": ["fullName", "email", "campus", "notes"]
}
```

**Grid rules:** every row string has exactly as many space-separated tokens
as the page's column count (an integer, or the track count of a string like
`"240px 1fr"` = 2). Each token is a field key whose `page` is this page, or
`.` for an empty cell. Repeat a key across adjacent cells (in a row, or at
the same position across rows) to span it.

## Fields

All fields live in the **one** top-level `fields` object; each names its
page via `page`.

```jsonc
"fields": {
  "fullName": {
    "page": "aboutYou",               // REQUIRED for top-level fields
    "source": "sharepoint",           // "sharepoint" (default) writes a list column;
                                      //   "virtual" is client-only (conditions, content, post-actions)
    "bindTo": "Title",                // REQUIRED when source is "sharepoint" — internal column name
    "columnId": "<column GUID>",      // optional, safer binding if the internal name may change
    "controlType": "text",            // REQUIRED — see table below
    "label": "Full name",             // overrides the column's display name; heading text for "heading"
    "subtitle": "As it appears on your ID.",
    "helpText": "We use this to reserve your spot.",
    "defaultValue": "",               // any type
    "readonly": false,
    "appearance": "default",          // "default" | "switch" (toggle look for a checkbox)
    "required": true,
    "minlength": 2, "maxlength": 255, // text length limits
    "min": 1, "max": 25,             // numeric / date limits
    "pattern": "[A-Za-z ]+",         // regex the value must match
    "matchesField": "confirmEmail",   // value must equal another field's value
    "customValidators": ["someRegisteredName"],  // names only; must exist in SKYE code
    "validationMessages": {           // custom error text per rule
      "required": "We need a name to reserve your spot.",
      "maxlength": "Keep it under 255 characters."
    },
    "options": [                      // for select / radio / checkboxGroup
      { "value": "bl", "label": "Bloomington" },
      { "value": "in", "label": "Indianapolis" }
    ],
    "attributes": { "placeholder": "Jane Doe", "autocomplete": "name" },  // allowlist only
    "style": { "color": "#6b7280" },  // cosmetic CSS allowlist only
    "visibleIf": { <condition> },     // hide this field unless the condition is true
    "order": 1                        // reading / tab order; also column order in a lookupTable
  }
}
```

### controlType values

| controlType | Use for | Notes |
|---|---|---|
| `text` | short single-line text | |
| `textarea` | multi-line plain text | set rows via `attributes.rows` |
| `richtext` | formatted multi-line text | |
| `number` | numeric input | `min` / `max` / `attributes.step` |
| `currency` | money amount | |
| `select` | pick one from a dropdown | `options`, or from the choice column |
| `radio` | pick one, radio buttons | rendered as a `<fieldset>` |
| `checkboxGroup` | pick many | rendered as a `<fieldset>` |
| `checkbox` | single yes/no | `appearance: "switch"` for a toggle |
| `date` | date only | |
| `datetime-local` | date + time | |
| `peoplePicker` | pick a person / group | binds a Person-or-Group column |
| `lookupPicker` | pick one item from another list | needs `relatedList` |
| `lookupTable` | editable table of related-list rows | needs `table` |
| `url` | a web link | |
| `file` | file upload | image-only via `attributes.accept: "image/*"`; storage via `fileStorage` |
| `calculatedDisplay` | read-only value derived from other fields | needs `calculatedDisplay` |
| `heading` | a section heading (content only) | `source: "virtual"`; text from `label` |
| `paragraph` | a block of static text (content only) | `source: "virtual"` |
| `divider` | a horizontal rule (content only) | `source: "virtual"` |
| `hidden` | submits a value, never shown | like `<input type="hidden">` |

A `sharepoint` field may omit `controlType` (SKYE infers it from the column
type), but being explicit is clearer.

### attributes — allowlist, nothing else

`placeholder`, `autocomplete`, `inputmode` (`none`/`text`/`decimal`/`numeric`/`tel`/`search`/`email`/`url`),
`spellcheck`, `step`, `accept`, `multiple`, `list`, `rows`, `cols`,
`wrap` (`hard`/`soft`), `size`, `title`, `autofocus`, `disabled`, plus any
`data-*` or `aria-*` key. **No** `on*` handlers and **no** URL-bearing
attributes.

### style — cosmetic CSS allowlist, nothing else

`color`, `backgroundColor`, `fontSize`, `fontWeight`, `fontStyle`,
`textAlign`, `textTransform`, `lineHeight`, `border`, `borderRadius`,
`padding`, `margin`, `width`, `height`, `maxWidth`, `minWidth`, `opacity`.
No `gridArea` / `position` / `display` / `backgroundImage` — placement is
done only through the page's `gridTemplateAreas`.

### relatedList — required for `lookupPicker`

```jsonc
"relatedList": {
  "id": "<related list GUID>",
  "siteId": "<optional, if on another site>",
  "displayField": "Title"            // internal column name shown as each result's label
}
```

### table — required for `lookupTable`

```jsonc
"table": {
  "relatedList": { "id": "<related list GUID>", "siteId": "<optional>" },
  "linkMode": "parentReference",     // or "lookupColumn"
  "parentReferenceColumn": "Correlated_x0020_Event",  // required for parentReference:
                                     //   internal name of the lookup column on the RELATED list
                                     //   that points back to this item
  "allowAdd": true, "allowEdit": true, "allowDelete": true,
  "minRows": 0, "maxRows": 8,
  "columns": {                       // each column is a field-shaped object targeting the RELATED list
    "guestName": { "source": "sharepoint", "bindTo": "Title", "controlType": "text",
                   "required": true, "order": 1 },
    "meal":      { "source": "sharepoint", "bindTo": "Meal", "controlType": "select",
                   "options": [ { "value": "veg", "label": "Vegetarian" } ], "order": 2 }
  }
}
```

- `parentReference` — the "line items" pattern; rows are related-list items
  whose lookup column points back at this item. On a brand-new item there's
  no parent ID until the first save.
- `lookupColumn` — this field's own `bindTo` is a (usually multi-value)
  lookup column on the primary list; rows are the items it points at.

### fileStorage — only for `file`

```jsonc
"fileStorage": { "target": "attachment" }   // default: attach to the list item
// or:
"fileStorage": {
  "target": "library",
  "library": { "driveId": "<drive GUID>", "siteId": "<optional>", "folderPath": "EventSignups/2026" }
}
```

### calculatedDisplay — required for `calculatedDisplay`

A structured expression, **not a formula string**.

```jsonc
"calculatedDisplay": {
  "op": "multiply",                  // sum | subtract | multiply | divide | min | max | concat
  "fields": ["quantity", "price"],   // 2+ other field keys, in order
  "separator": " "                   // only used by "concat"
}
```

`subtract` and `divide` apply left-to-right (`a - b - c`, `a / b / c`).

## Conditions

Used by field `visibleIf`, page `visibleIf`, and post-action `when`. No
code — a condition is a **leaf** or a **group**.

Leaf:

```jsonc
{ "field": "campus", "operator": "equals", "value": "Bloomington" }
```

Operators: `equals`, `notEquals`, `in`, `notIn`, `greaterThan`,
`greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `isEmpty`,
`isNotEmpty`, `contains`. Omit `value` for `isEmpty` / `isNotEmpty`;
required for every other operator.

Group — exactly one of `all` / `any` / `not`:

```jsonc
{ "all": [
  { "field": "attending", "operator": "equals", "value": true },
  { "any": [
    { "field": "campus", "operator": "equals", "value": "Bloomington" },
    { "field": "campus", "operator": "equals", "value": "Indianapolis" }
  ] }
] }
```

A field's `visibleIf` should reference only fields on the same page or an
earlier page. A page's `visibleIf` should reference only fields on earlier
pages.

## Post-actions

Things that happen around submission, keyed by a name you choose.

```jsonc
"postActions": {
  "notifyTeam": {
    "trigger": "afterSubmit",        // REQUIRED: "beforeSubmit" | "afterSubmit" | "onSuccess" | "onError"
    "type": "httpRequest",           // REQUIRED: see types below
    "label": "Notify the events team",   // shown in the progress UI
    "loadingMessage": "Letting the team know…",
    "successMessage": "Team notified.",
    "errorMessage": "Couldn't notify the team — they'll be told manually.",
    "showInProgress": true,
    "when": { <condition> },          // optional guard — only run if true
    "dependsOn": ["someOtherAction"], // actions in the SAME phase that must finish first
    "runIfDependencySkipped": false,  // run even if a dependency was skipped
    "request": { ... }               // shape depends on `type`
  }
}
```

### Trigger phases

- `beforeSubmit` — before the list item is written (validation call,
  computing a value). Use this when the action should be able to block
  submission.
- `afterSubmit` — right after the item is written; it exists as
  `{{item.id}}`.
- `onSuccess` — everything worked (good for `redirect` / success
  `showMessage`).
- `onError` — something failed (good for an error `showMessage`).

### Types and their extra keys

| type | required keys | shape |
|---|---|---|
| `httpRequest` | `request` | `{ url, method (GET/POST/PUT/PATCH/DELETE), headers?, params?, body? }` |
| `graphRequest` | `request` | `{ url (Graph path), method, body? }` |
| `redirect` | `to` | `to`: a path or URL |
| `showMessage` | `message` | `message`, `level?` (`info`/`success`/`warning`/`error`, default `info`) |
| `setField` | `field`, `value` | sets a field's value |
| `script` | `functionName` | `functionName` (registered name), `args?` (array; by convention one options object) |

### Templating in post-action strings

Only these placeholders, only inside string values of a post-action:

- `{{fields.<fieldKey>}}` — a current field value.
- `{{item.<path>}}` — the SharePoint item the form just created/updated,
  e.g. `{{item.id}}`.
- `{{results.<actionKey>.<path>}}` — output of another post-action. If you
  use it, that action **must** be in this action's `dependsOn`.

### script `functionName` — the registered names

`script` actions call reviewed SKYE code by name. Never invent names. As of
this writing the registry contains:

- **Teams:** `teams.createChat`, `teams.sendMessage`, `teams.scheduleMeeting`
- **Outlook:** `outlook.sendEmail`, `outlook.createCalendarEvent`,
  `outlook.buildCalendarEventDeepLink`, `outlook.verifyCalendarEventByIcs`
- **Engage (Campus Labs):** `engage.createEvent`, `engage.updateEvent`,
  `engage.cancelEvent`, `engage.rsvpToEvent`, `engage.updateRsvp`,
  `engage.recordAttendance`, `engage.updateAttendance`,
  `engage.deleteAttendance`

`args` is an array with a single named options object:

```jsonc
{ "type": "script", "functionName": "outlook.sendEmail", "trigger": "afterSubmit",
  "args": [ { "to": "{{fields.organizerEmail}}", "subject": "New sign-up",
              "body": "{{fields.fullName}} signed up." } ] }
```

A service/action not in this list has to be added to SKYE by a developer
first. `customValidators` names work the same way: keys into a reviewed
registry in SKYE's source (currently empty); an unregistered name is a
load-time error, not a silent no-op.

---

# Worked example — a two-page sign-up form

```json
{
  "id": "event-signup",
  "title": "Event Sign-up",
  "description": "Tell us about yourself and your order.",
  "mode": "both",
  "list": { "id": "PUT-LIST-GUID-HERE" },
  "layout": { "gridTemplateColumns": 12, "gap": "1rem" },

  "pages": {
    "aboutYou": {
      "title": "About you",
      "order": 1,
      "layout": {
        "gridTemplateColumns": "2fr 1fr",
        "gridTemplateAreas": [
          "fullName fullName",
          "email campus"
        ]
      }
    },
    "yourOrder": {
      "title": "Your order",
      "order": 2,
      "layout": {
        "gridTemplateColumns": 1,
        "gridTemplateAreas": ["quantity", "agree"]
      }
    }
  },

  "fields": {
    "fullName": {
      "page": "aboutYou", "source": "sharepoint", "bindTo": "Title",
      "controlType": "text", "label": "Full name", "required": true, "maxlength": 255,
      "validationMessages": { "required": "We need a name to reserve your spot." },
      "attributes": { "autocomplete": "name", "placeholder": "Jane Doe" }, "order": 1
    },
    "email": {
      "page": "aboutYou", "source": "sharepoint", "bindTo": "Email",
      "controlType": "text", "label": "Email", "required": true,
      "attributes": { "inputmode": "email", "autocomplete": "email" }, "order": 2
    },
    "campus": {
      "page": "aboutYou", "source": "sharepoint", "bindTo": "Favourite_x0020_Campus",
      "controlType": "select", "label": "Home campus", "order": 3
    },
    "quantity": {
      "page": "yourOrder", "source": "sharepoint", "bindTo": "Quantity",
      "controlType": "number", "label": "How many tickets?", "min": 1, "max": 10,
      "validationMessages": { "max": "Up to 10 per person." },
      "attributes": { "step": 1, "inputmode": "numeric" }, "order": 1
    },
    "agree": {
      "page": "yourOrder", "source": "virtual", "controlType": "checkbox",
      "label": "I agree to the event terms", "required": true,
      "validationMessages": { "required": "Please accept the terms to continue." }, "order": 2
    }
  },

  "postActions": {
    "notifyOrganizer": {
      "trigger": "afterSubmit", "type": "script", "functionName": "outlook.sendEmail",
      "label": "Email the organizer",
      "args": [ { "to": "organizer@example.edu", "subject": "New sign-up: {{fields.fullName}}",
                  "body": "{{fields.fullName}} ({{fields.email}}) reserved {{fields.quantity}} ticket(s)." } ]
    },
    "goToConfirmation": {
      "trigger": "onSuccess", "type": "redirect", "showInProgress": false,
      "to": "/confirmation?item={{item.id}}"
    },
    "showError": {
      "trigger": "onError", "type": "showMessage", "showInProgress": false,
      "level": "error", "message": "Something went wrong. Please try again."
    }
  }
}
```

# Worked example — an `admin/` overlay for that form

Adds an admin-only review page and raises the `quantity` cap — removing or
hiding nothing, and restating the whole `quantity` field, not patching one
key.

```json
{
  "title": "Event Sign-up (Admin)",
  "pages": {
    "adminReview": {
      "title": "Admin review",
      "order": 3,
      "layout": { "gridTemplateColumns": 1, "gridTemplateAreas": ["staffOwner", "internalNotes"] }
    }
  },
  "fields": {
    "quantity": {
      "page": "yourOrder", "source": "sharepoint", "bindTo": "Quantity",
      "controlType": "number", "label": "How many tickets?", "min": 1, "max": 100, "order": 1
    },
    "staffOwner": {
      "page": "adminReview", "source": "sharepoint", "bindTo": "Best_x0020_Friends",
      "controlType": "peoplePicker", "label": "Staff owner", "order": 1
    },
    "internalNotes": {
      "page": "adminReview", "source": "sharepoint", "bindTo": "Internal_x0020_Notes",
      "controlType": "textarea", "label": "Internal notes", "attributes": { "rows": 5 }, "order": 2
    }
  }
}
```

---

# Common requests → how to handle them

- **"Only show this field/step when …"** → a `visibleIf` on the field
  (same-page / earlier fields) or the page (earlier-page fields only).
- **"Show price × quantity"** → a `virtual` `calculatedDisplay` field:
  `{ "op": "multiply", "fields": ["price", "quantity"] }`.
- **"Email / Teams message / Engage event on submit"** → a `script`
  post-action with a registered `functionName` and `args: [ { …options } ]`;
  `afterSubmit` unless it must block submission (`beforeSubmit`).
- **"Redirect to a thank-you page"** → `type: "redirect"`,
  `trigger: "onSuccess"`, `to: "/thank-you?item={{item.id}}"`.
- **"Put two fields side by side"** → both keys in the same
  `gridTemplateAreas` row, page column count = token count.
- **"Remove / hide / restrict a field in the admin version"** → impossible
  in an overlay (additive-only). Offer to change the base config.
- **Anything the schema can't express** → say so directly, give the nearest
  supported option.

# When to ask before answering

Follow the system instruction: ask a short, specific question rather than
guess at a **list GUID**, a **column's internal name**, a **permission
group / folder name**, **business logic** you can't infer, or whether a
post-action should **block submission**. Otherwise produce the file, using
`PUT-LIST-GUID-HERE` for genuine unknowns and flagging them in your summary.
