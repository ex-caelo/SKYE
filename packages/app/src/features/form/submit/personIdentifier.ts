/**
 * Extracts a resolvable identifier (email, then numeric LookupId, then a
 * generic id) from one people-picker value entry — a plain string (already
 * a key: an email typed into search, or `graph.resolveSiteUserId`'s numeric
 * shortcut) or a raw SharePoint person object (`{LookupId, LookupValue,
 * Email}`, as an existing item's `personOrGroup` column arrives). Mirrors
 * `registerElements.ts`'s `normalisePeopleValue` key priority exactly — the
 * two used to drift (that one extracted a resolvable key for chip rendering;
 * `checkPersonFieldsResolve`/`buildPrimarySharePointFields` instead did a
 * naive `String(entry)`, which stringifies an object to `"[object Object]"`
 * and resolves nothing), which is what let an untouched edit-mode Cohosts
 * chip (a real, already-valid site member) get wrongly rejected as "not a
 * member of this site" purely because of HOW its value was read, not
 * because it was actually invalid. A bare display-name string (no
 * LookupId/Email to extract) is returned as-is — resolution then correctly
 * fails for it, which is the right outcome if no resolvable identifier was
 * ever available.
 */
export function personIdentifier(entry: unknown): string {
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    // `??` alone isn't enough here: a real, documented tenant quirk (see graphClient.ts's own
    // `doResolveSiteUserId` comment) is that `Email` often comes back as a present-but-BLANK
    // string ("" — only filled in once a user has actually visited SharePoint), not absent —
    // `??` treats that as a real value and would stop there instead of falling through to the
    // still-resolvable LookupId. Each candidate in priority order is tried in turn, and only an
    // actual non-empty string wins.
    for (const candidate of [o.Email, o.email, o.LookupId, o.id, o.LookupValue]) {
      if (candidate === undefined || candidate === null) continue;
      const s = String(candidate);
      if (s !== "") return s;
    }
    return "";
  }
  return String(entry ?? "");
}
