import { describe, it, expect, vi } from "vitest";
import type { ActionExecutionContext } from "@skye/form-config";
import { formatDateYMD } from "../integrations/util/formatDateYMD.js";

function makeContext(): ActionExecutionContext {
  return {
    templateContext: { fields: {}, item: {}, results: {} },
    httpFetch: vi.fn(),
    graphFetch: vi.fn(),
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
    scriptActions: {},
  };
}

describe("util.formatDateYMD", () => {
  it("formats a datetime-local value as YYYY.MM.DD", async () => {
    const result = await formatDateYMD([{ date: "2026-10-30T18:00" }], makeContext());
    expect(result).toEqual({ ymd: "2026.10.30" });
  });

  it("formats a plain date-only value the same way", async () => {
    // A bare date-only string ("2026-10-30", no time) is UTC midnight per the ECMAScript Date
    // parsing spec — unlike a full datetime-local string, which parses as local time. This
    // action is meant for datetime-local fields (its one real caller, the Luddy approve button's
    // startTime), so this just confirms it doesn't throw on the date-only shape too.
    const result = (await formatDateYMD([{ date: "2026-01-05" }], makeContext())) as { ymd: string };
    expect(result.ymd).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });

  it("zero-pads single-digit months and days", async () => {
    const result = await formatDateYMD([{ date: "2026-03-05T09:00" }], makeContext());
    expect(result).toEqual({ ymd: "2026.03.05" });
  });

  it("requires a date", async () => {
    await expect(formatDateYMD([{}], makeContext())).rejects.toThrow(/date/);
  });

  it("rejects an unparseable date", async () => {
    await expect(formatDateYMD([{ date: "not-a-date" }], makeContext())).rejects.toThrow(/parseable/);
  });
});

import { formatDateTime } from "../integrations/util/formatDateTime.js";

describe("util.formatDateTime", () => {
  it("formats a naive datetime-local value as en-US, Eastern time, read as Indianapolis wall-clock time", async () => {
    // Oct 6 2026 is EDT (UTC-4), so 19:00 local is 23:00 UTC — and must display as 7:00 PM EDT.
    const result = (await formatDateTime([{ date: "2026-10-06T19:00" }], makeContext())) as { formatted: string };
    expect(result.formatted).toBe("Oct 6, 2026, 7:00 PM EDT");
  });

  it("gives the same answer regardless of the process's own timezone", async () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      const result = (await formatDateTime([{ date: "2026-10-06T19:00" }], makeContext())) as { formatted: string };
      expect(result.formatted).toBe("Oct 6, 2026, 7:00 PM EDT");
    } finally {
      process.env.TZ = original;
    }
  });

  it("honours an explicit offset on the input instead of re-zoning it", async () => {
    const result = (await formatDateTime([{ date: "2026-10-06T23:00:00Z" }], makeContext())) as { formatted: string };
    expect(result.formatted).toBe("Oct 6, 2026, 7:00 PM EDT");
  });

  it("requires a date", async () => {
    await expect(formatDateTime([{}], makeContext())).rejects.toThrow(/date/);
  });
});
