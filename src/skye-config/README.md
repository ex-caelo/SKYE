# @skye/config

Framework-agnostic core logic for SKYE form configs: schema, types, config
merging/linting, condition/expression evaluation, validation, and the
postAction pipeline. No DOM, no Graph SDK, no Astro — everything here is
pure functions and small orchestrators, which is what makes it unit-testable
without a live SharePoint tenant (see `src/__tests__`).

The `packages/app` Astro site is the only thing that should import from
here for rendering/auth/Graph concerns; this package doesn't know those
exist.

## What's in here

| Area | File(s) | What it does |
|---|---|---|
| Schema | `src/schema/form.config.schema.json` | The JSON Schema (draft 2020-12) for base `form.config.json` files. |
| Overlay schema | `src/schema/form.config.overlay.schema.json` | A separate, more lenient schema for `[permission]/form.config.json` overlay files — nothing is required at the top level, since an overlay only declares what it's adding. See its `description` for why this is a second file rather than a flag on the base schema. |
| Types | `src/schema/types.ts` | Hand-authored TS types mirroring the schema. `FormConfigOverlay` is intentionally `Partial` all the way down (pages/fields/postActions), unlike `FormConfig`. |
| Merge | `src/merge/mergeConfig.ts` | RFC 7396 JSON Merge Patch, with one deviation: a literal `null` in an overlay is recorded as an error rather than deleting a key (overlays are additive-only by convention — see the base schema's top-level `description`). |
| Lint | `src/merge/lintOverlay.ts` | Checks that an overlay only *loosens* constraints relative to its base (no `required: true` where base didn't, no lower `maxlength`, etc.) — flags anything stricter as an error, and a few ambiguous cases (new `pattern`, new `visibleIf`) as warnings. |
| Conditions | `src/condition/evaluateCondition.ts` | Evaluates `visibleIf`/`when` condition trees (`all`/`any`/`not` + leaf operators) against current field values. |
| Calculated fields | `src/condition/evaluateCalculatedExpression.ts` | Evaluates the structured `calculatedDisplay` expression (`sum`/`subtract`/`multiply`/`divide`/`min`/`max`/`concat`) — deliberately not a free-text formula language. |
| Validation | `src/validation/nativeValidators.ts`, `customValidatorRegistry.ts` | Maps `required`/`minlength`/`maxlength`/`min`/`max`/`pattern`/`matchesField` to pass/fail results the app wires into the DOM Constraint Validation API. `customValidatorRegistry.ts` is a *mechanism* only — see Security below. |
| Actions | `src/actions/*` | `templating.ts` (`{{fields.x}}`/`{{item.x}}`/`{{results.x.y}}` interpolation), `dependencyGraph.ts` (topological batching + skip-cascade), `actionRunner.ts` (runs one trigger phase), `defaultHandlerRegistry.ts` + `handlers/*` (one file per postAction `type` — the extension point for new types). |
| Lint CLI | `scripts/lintConfigs.ts` | `pnpm lint:configs -- <path>` — walks a local checkout of `skye_data/forms/`, schema-validates every base config and overlay, lints overlays for additive-only compliance, and checks the one thing the schema can't express (grid row token counts matching `gridTemplateColumns`). CI-friendly: non-zero exit on any error. |

## Security decisions baked into this package (do not relax without discussion)

- **No code is ever loaded from SharePoint.** `customValidators` names and
  `postAction.functionName` are string keys looked up against registries
  the *app* provides (hardcoded, reviewed, deployed through the normal
  build). `runCustomValidators` and `scriptHandler` both throw a loud error
  on an unregistered name rather than silently no-op-ing or attempting to
  fetch anything.
- **Overlays are additive-only**, enforced by `lintOverlay.ts` +
  `mergeConfig.ts`'s null-as-error behavior. A permission overlay can add
  capability but should never be able to take it away or make it stricter.
- Handlers for `httpRequest`/`graphRequest` don't own their own `fetch` —
  they receive `httpFetch`/`graphFetch` via `ActionExecutionContext`, injected
  by the app. This keeps auth/token concerns entirely in the app layer and
  keeps these handlers trivially testable with a stub.

## Using it from the app

```ts
import {
  mergeConfig, lintOverlay, evaluateCondition, evaluateCalculatedExpression,
  validateField, runCustomValidators, createCustomValidatorRegistry,
  runTriggerPhase, createDefaultHandlerRegistry,
} from "@skye/config";

// Real validator functions live in the APP, not here:
const customValidators = createCustomValidatorRegistry({
  usEinFormat: (v) => /^\d{2}-\d{7}$/.test(String(v)) || "Must be a valid EIN.",
});
```

## Commands

Run from the repo root (or with `--filter @skye/config` from anywhere in the workspace):

```bash
pnpm install                 # first time / after pulling dependency changes
pnpm test:config              # run this package's test suite (40 tests)
pnpm lint:configs -- <path>   # validate + additive-lint a local skye_data/forms/ checkout
```
