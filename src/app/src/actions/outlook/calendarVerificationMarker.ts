/**
 * Shared marker format used by both outlook.buildCalendarEventDeepLink (embeds it) and
 * outlook.verifyCalendarEventByIcs (searches for it) — kept as one small shared module, not just a
 * comment convention across two files, so the two can't silently drift out of sync.
 */

const MARKER_PREFIX = "[SKYE-VERIFY:";
const MARKER_SUFFIX = "]";

/** Builds the marker string to embed in an event's body/description. */
export function buildVerificationMarker(verificationId: string): string {
  return `${MARKER_PREFIX}${verificationId}${MARKER_SUFFIX}`;
}

/**
 * RFC 5545 line folding: a continuation line starts with a single space or tab and should be
 * joined back to the previous line. Without unfolding first, a long DESCRIPTION that happened to
 * wrap mid-marker would fail to match even though the marker is really there, intact, once folded
 * lines are rejoined.
 */
export function unfoldIcs(ics: string): string {
  return ics.replace(/\r?\n[ \t]/g, "");
}

/**
 * True if already-unfolded ICS text contains a VEVENT whose body carries this exact marker.
 * Deliberately NOT full RFC 5545 parsing — just enough structure (BEGIN:VEVENT/END:VEVENT block
 * boundaries) to avoid a false match against some unrelated part of the calendar, e.g. a different
 * event's SUMMARY happening to contain the same substring by coincidence.
 */
export function icsContainsVerificationMarker(unfoldedIcsText: string, verificationId: string): boolean {
  const marker = buildVerificationMarker(verificationId);
  const veventBlocks = unfoldedIcsText.split(/BEGIN:VEVENT/).slice(1); // first chunk is calendar-level content, before any VEVENT
  return veventBlocks.some((block) => {
    const end = block.indexOf("END:VEVENT");
    const body = end === -1 ? block : block.slice(0, end);
    return body.includes(marker);
  });
}
