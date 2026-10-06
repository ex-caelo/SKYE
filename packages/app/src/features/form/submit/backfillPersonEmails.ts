import type { FieldConfig, FieldValues } from "@skye/form-config";

/**
 * For every peoplePicker field's seeded value with a blank/missing `Email`,
 * resolves the person's real email/UPN via `resolveEmail` (backed by
 * `GraphClient.resolveSiteUserEmail`) and fills it in — so downstream
 * resolution (`personIdentifier.ts`, and anything that needs a genuine
 * Microsoft Graph user identifier, e.g. a Teams chat's `memberUserIds`)
 * gets a real Graph-compatible email instead of silently falling back to
 * the SharePoint-internal `LookupId` the moment a form author binds that
 * field somewhere Graph-identifier-shaped. A real, live bug this closes:
 * `teams.createChat`'s own validation (see that file) started rejecting a
 * cohost whose SharePoint Person column had a blank cached `Email` — this
 * is the fix that gets a real email there BEFORE that validation runs,
 * rather than requiring a form author to add a manual workaround field for
 * every peoplePicker binding (the `hostEmail` pattern), which doesn't
 * scale to a multi-value field like `cohosts`.
 *
 * Pure except for the injected `resolveEmail` callback — no direct Graph
 * access here, matching `mapSharePointFieldsToValues.ts`'s own
 * no-Graph-access contract — so this stays unit-testable without a real
 * or mocked GraphClient. Leaves everything else (already has an Email,
 * not a peoplePicker field, a plain string value from a fresh pick that
 * already carries its own resolvable key) completely untouched.
 */
export async function backfillPersonEmails(
  fields: Record<string, FieldConfig>,
  values: FieldValues,
  resolveEmail: (lookupId: number) => Promise<string | null>
): Promise<FieldValues> {
  const result: FieldValues = { ...values };

  for (const [fieldKey, field] of Object.entries(fields)) {
    if (field.controlType !== "peoplePicker") continue;
    const raw = result[fieldKey];
    if (raw === undefined || raw === null) continue;

    const entries = Array.isArray(raw) ? raw : [raw];
    const patched = await Promise.all(
      entries.map(async (entry) => {
        if (!entry || typeof entry !== "object") return entry; // a plain string key already has what it needs
        const o = entry as Record<string, unknown>;
        if (typeof o.Email === "string" && o.Email.trim() !== "") return entry; // already resolvable

        const lookupId = typeof o.LookupId === "number" ? o.LookupId : Number(o.LookupId);
        if (!Number.isFinite(lookupId)) return entry; // nothing to look up

        const resolved = await resolveEmail(lookupId);
        return resolved ? { ...o, Email: resolved } : entry;
      })
    );

    result[fieldKey] = Array.isArray(raw) ? patched : patched[0];
  }

  return result;
}
