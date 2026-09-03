import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import formConfigSchema from "../schema/form.config.schema.json" with { type: "json" };
import formConfigOverlaySchema from "../schema/form.config.overlay.schema.json" with { type: "json" };

/**
 * Browser-safe wrapper around the same ajv-based schema validation
 * `lintConfigs.ts` runs from the CLI (`pnpm lint:configs`), exposed through
 * @skye/form-config's public API so `/builder` (packages/app) can run the exact
 * same check client-side before writing a config back to SharePoint —
 * "Save" should never be able to persist something `lint:configs` would
 * then immediately flag. ajv is a real `dependencies` entry of this
 * package (not devDependencies), so it's safe to ship into the browser
 * bundle the same way it's already used by the Node CLI script.
 */

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(formConfigSchema as object); // registered under its own $id; the overlay schema's relative $refs resolve against that same $id
const validateBaseFn = ajv.getSchema((formConfigSchema as { $id: string }).$id)!;
const validateOverlayFn = ajv.compile(formConfigOverlaySchema as object);

export interface SchemaValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

/** Validates a complete base form.config.json against form.config.schema.json. */
export function validateFormConfig(config: unknown): SchemaValidationResult {
  const valid = validateBaseFn(config) as boolean;
  return { valid, errors: valid ? [] : [...(validateBaseFn.errors ?? [])] };
}

/** Validates a `[permission]/form.config.json` overlay against form.config.overlay.schema.json (nothing required at the top level, but any page/field/postAction it does declare must still be a complete, valid one — see that schema's own description). */
export function validateFormConfigOverlay(overlay: unknown): SchemaValidationResult {
  const valid = validateOverlayFn(overlay) as boolean;
  return { valid, errors: valid ? [] : [...(validateOverlayFn.errors ?? [])] };
}

/** Formats ajv errors as short human-readable lines (`<path>: <message>`), for display in the builder's save-error panel or CLI output. */
export function formatSchemaErrors(errors: ErrorObject[]): string[] {
  return errors.map((e) => `${e.instancePath || "(root)"}: ${e.message}`);
}
