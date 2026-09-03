import { createCustomValidatorRegistry } from "@skye/form-config";

/**
 * The app's real customValidators registry — per the security decision in
 * TODO/CLAUDE.md, these are reviewed, hardcoded functions shipped in this
 * repo, never fetched from SharePoint (a form config only ever references
 * one by NAME; an unregistered name is a loud runtime error, not a silent
 * no-op). Empty for now — no form config in this repo has needed a custom
 * validator yet. Add entries here as real ones come up; `runCustomValidators`
 * (from @skye/form-config) throws a clear error if a config references a name
 * that isn't in this list, so there's no risk of a typo silently passing.
 */
export const customValidators = createCustomValidatorRegistry({});
