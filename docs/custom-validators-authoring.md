# Authoring form field validation, including custom validators

SKYE checks a field's value two ways, in order: **native constraints**
(built into the config schema, no code involved) and, if those pass,
**custom validators** (named references to reviewed functions that ship in
the app). Both run for every field a form renders — live `/form`,
`/form?draft=...` preview, and the `/builder` live preview all go through
the same `renderForm`/`validateFormValues` pipeline, so anything documented
here works identically everywhere a form is shown.

## 1. Native constraints — reach for these first

These need no code and no registry entry; just set the property on the
field in `form.config.json`:

| Property | Checks | Applies to |
|---|---|---|
| `required` | value isn't empty (or an empty array, for a multi-select control) | any control |
| `minlength` / `maxlength` | string length | text-like controls |
| `min` / `max` | value against a **fixed number** | number/currency |
| `pattern` | value matches a regular expression | text-like controls |
| `matchesField` | value **equals** another field's current value | any control (e.g. a "confirm email" field) |

`validationMessages` lets you override the default error text per
constraint (`required`, `minlength`, `maxlength`, `min`, `max`, `pattern`,
`matchesField`), keyed by the same name.

```json
"confirmEmail": {
  "controlType": "text",
  "matchesField": "email",
  "validationMessages": { "matchesField": "Emails don't match." }
}
```

If what you need is expressible as one of the rows above, use it — it's
simpler to read, needs no registry entry, and can never throw a "not
registered" error at load time.

## 2. Custom validators — for everything else

A custom validator is a named, reviewed JavaScript function that ships in
`packages/app/src/features/form/customValidatorRegistry.ts`. **A config file
never contains executable code** — it only references a validator by name
(per SKYE's "no code from SharePoint" rule in `CLAUDE.md`). Referencing a
name that isn't registered is a loud error at load time, not a silent
no-op.

### Syntax

`customValidators` is a list on a field. Each entry is either:

- a **bare name** — for a validator that needs no configuration, or
- a **`{ "name": "...", "args": { ... } }`** object — for a validator that
  needs to know something about *this* use (which other field to compare
  against, a threshold, a list of field keys, ...). `args` is a plain
  object of named options, the same "options object, not positional
  values" convention SKYE's `script` post-actions already use.

```json
"customValidators": [
  "someParameterlessValidator",
  { "name": "compareField", "args": { "field": "startTime", "operator": "greaterThan" } }
]
```

You can mix bare names and `{ name, args }` objects in the same list; they
run in order, and the first failure wins.

Every validator listed below also accepts an optional `args.message` to
override its default error text.

### `compareField` — compare this field against another field

The general answer to "field A must be greater/less/equal to field B" —
covers date ranges (`endTime` after `startTime`), numeric ranges (`max`
must be ≥ `min`), or "must differ from" checks. It compares plain numbers
numerically and date/datetime-local strings chronologically; anything else
falls back to a string comparison. If either side is still empty, the
check is skipped (that's `required`'s job, not this one's).

```json
"args": {
  "field": "startTime",
  "operator": "greaterThan",
  "message": "End time must be after start time."
}
```

`operator` is one of `equals` / `notEquals` / `greaterThan` /
`greaterThanOrEqual` / `lessThan` / `lessThanOrEqual` — the same vocabulary
`visibleIf`/`when` conditions already use, for one consistent operator
naming scheme across the whole config format.

**Worked example** (from `skye_data/forms/luddy-llc-event-proposal/form.config.json`):

```json
"endTime": {
  "controlType": "datetime-local",
  "required": true,
  "customValidators": [
    { "name": "compareField", "args": { "field": "startTime", "operator": "greaterThan", "message": "End time must be after start time." } }
  ]
}
```

### `dateNotInPast` — a date/datetime field can't be in the past

For anything that has to be scheduled ahead, not behind — there's no
literal value in a config file that means "right now," so this can't be a
native `min`. By default it checks the **calendar day** (today always
passes); set `args.allowToday: false` for a stricter "must be later than
this exact moment" check.

```json
"customValidators": [
  { "name": "dateNotInPast", "args": { "message": "Please choose a future date." } }
]
```

### `atLeastOneOf` — require at least one of several fields

For an "at least one of Host or Cohosts" style rule, where no single field
is individually `required` but the group as a whole must have something.
Attach it to one field in the group (commonly the last one, so the error
appears at the bottom of the set) — the field's own value is ignored, only
the listed `args.fields` are checked.

```json
"customValidators": [
  { "name": "atLeastOneOf", "args": { "fields": ["host", "cohosts"], "message": "Provide a Host or at least one Cohost." } }
]
```

## 3. Editing `customValidators` in `/builder`

Because an entry can be a bare string *or* an object, this property doesn't
fit the builder's usual per-type controls (same reason `visibleIf` is
edited as raw JSON rather than a visual tree). In the field editor,
`customValidators` is a JSON textarea — paste or edit the array shown
above directly.

## 4. Adding a new custom validator (for developers)

1. Write the function in `packages/app/src/features/form/customValidatorRegistry.ts`:
   it's a `CustomValidatorFn` from `@skye/form-config` — `(value, allValues, args?) =>
   true | string` (return `true` to pass, or an error message string to
   fail). `args` is only populated for a `{ name, args }` entry.
2. Keep it **general** — parameterize via `args` rather than hardcoding a
   field name, so one function covers every form that needs the same kind
   of check, not just the one that prompted it.
3. Register it in that file's `customValidators` export
   (`createCustomValidatorRegistry({...})`).
4. Add it to the table above in this file, with its `args` shape and a
   worked example.
5. A form config references it by name (optionally with `args`) exactly
   like the built-in ones — no other wiring needed; `renderForm`'s
   validation pipeline already threads the whole registry through to every
   page that renders a form.
