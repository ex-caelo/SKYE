import type { FieldValues } from "../schema/types.js";

export type CustomValidatorFn = (value: unknown, allValues: FieldValues) => true | string;

/**
 * The MECHANISM lives here; the actual validator functions do not. Per the
 * security decision in the TODO/README, real customValidators are hardcoded
 * in the consuming app (e.g. packages/app/src/validation/customValidators.ts),
 * reviewed and deployed through the normal build pipeline — never fetched
 * from SharePoint. This file just gives the app a typed shape to implement
 * against and a helper to build a registry safely.
 */
export function createCustomValidatorRegistry(
  entries: Record<string, CustomValidatorFn>
): Record<string, CustomValidatorFn> {
  return { ...entries };
}
