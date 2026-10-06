import { describe, it, expect, afterEach } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import { mapSharePointFieldsToValues, selectColumnsForEditPrefill } from "../features/form/submit/mapSharePointFieldsToValues.js";

const fields: Record<string, FieldConfig> = {
  title: { page: "p1", source: "sharepoint", bindTo: "Title", controlType: "text" },
  notes: { page: "p1", source: "virtual", controlType: "textarea" },
  start: { page: "p1", source: "sharepoint", bindTo: "StartTime", controlType: "datetime-local" },
  day: { page: "p1", source: "sharepoint", bindTo: "Day", controlType: "date" },
  host: { page: "p1", source: "sharepoint", bindTo: "Host", controlType: "peoplePicker" },
  cohosts: { page: "p1", source: "sharepoint", bindTo: "Cohosts", controlType: "peoplePicker" },
  categories: { page: "p1", source: "sharepoint", bindTo: "Categories", controlType: "checkboxGroup" },
  link: { page: "p1", source: "sharepoint", bindTo: "LinktoItem", controlType: "url" },
};

describe("mapSharePointFieldsToValues", () => {
  it("maps bound fields, skips virtual ones and absent columns", () => {
    const values = mapSharePointFieldsToValues(fields, {
      Title: "Kickoff",
      Categories: ["Social", "Academic"],
    });
    expect(values).toEqual({ title: "Kickoff", categories: ["Social", "Academic"] });
    expect(values).not.toHaveProperty("notes"); // virtual — never read
  });

  it("converts a SharePoint UTC ISO datetime to the viewer's LOCAL wall-clock time for the control — not a naive string slice", () => {
    // Graph always returns DateTime columns as UTC ("Z"-suffixed); a datetime-local/date control
    // needs local time with no suffix. Deriving the expectation from `new Date(...)`'s own local
    // getters (rather than a hardcoded offset) keeps this test correct on any machine/CI
    // timezone — the whole point being verified is "local getters, not raw digit-slicing".
    const pad = (n: number) => String(n).padStart(2, "0");
    const localDateTime = (raw: string) => {
      const d = new Date(raw);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const localDateOnly = (raw: string) => {
      const d = new Date(raw);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const values = mapSharePointFieldsToValues(fields, {
      StartTime: "2026-04-02T21:30:00Z",
      Day: "2026-04-02T00:00:00Z",
    });

    expect(values.start).toBe(localDateTime("2026-04-02T21:30:00Z"));
    expect(values.day).toBe(localDateOnly("2026-04-02T00:00:00Z"));
  });

  describe("with TZ pinned to America/Indiana/Indianapolis (the real IU bug report)", () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it("shows 18:00 EDT for an event stored as 22:00 UTC — not 22:00", () => {
      process.env.TZ = "America/Indiana/Indianapolis";
      // 2026-10-01 is within EDT (UTC-4), matching the exact live repro: an event entered as
      // 18:00 local, correctly stored by SharePoint as 22:00 UTC, used to come BACK as "22:00" —
      // the raw UTC digits shown as if already local — while the Custom Views calendar (which
      // already converts properly) showed the correct 18:00 for the same item.
      const values = mapSharePointFieldsToValues(fields, { StartTime: "2026-10-01T22:00:00Z" });
      expect(values.start).toBe("2026-10-01T18:00");
    });
  });

  it("passes a person column's rich object straight through", () => {
    const values = mapSharePointFieldsToValues(fields, {
      Host: { LookupId: 14, LookupValue: "Reece Needham", Email: "reeneedh@iu.edu" },
    });
    expect(values.host).toEqual({ LookupId: 14, LookupValue: "Reece Needham", Email: "reeneedh@iu.edu" });
  });

  it("rebuilds a bare display-name string (a real single-value personOrGroup quirk) into a resolvable {LookupId, LookupValue} object", () => {
    // The real live bug: a single-value Person column can come back as just the plain display
    // name under `Host`, not the {LookupId, LookupValue} object this file otherwise assumes —
    // `selectColumnsForEditPrefill` always selects `HostLookupId` alongside it regardless, so
    // that companion is used to rebuild a resolvable value instead of leaving just a display
    // name an edit-mode "is this person still a site member" check could never resolve.
    const values = mapSharePointFieldsToValues(fields, {
      Host: "Cloteaux, Lison",
      HostLookupId: 14,
    });
    expect(values.host).toEqual({ LookupId: 14, LookupValue: "Cloteaux, Lison" });
  });

  it("leaves a bare display-name string alone when no LookupId companion is present at all", () => {
    const values = mapSharePointFieldsToValues(fields, { Host: "Cloteaux, Lison" });
    expect(values.host).toBe("Cloteaux, Lison");
  });

  it("falls back to <bindTo>LookupId when only the id array is present", () => {
    const values = mapSharePointFieldsToValues(fields, {
      CohostsLookupId: ["14", "22"],
    });
    expect(values.cohosts).toEqual(["14", "22"]);
  });

  it("ignores empty-string / null column values", () => {
    const values = mapSharePointFieldsToValues(fields, { Title: "", StartTime: null });
    expect(values).toEqual({});
  });

  it("unwraps a url field's { Url, Description } object (a genuine Hyperlink column) to just the URL string", () => {
    const values = mapSharePointFieldsToValues(fields, {
      LinktoItem: { Url: "https://www.kroger.com/p/x", Description: "https://www.kroger.com/p/x" },
    });
    expect(values.link).toBe("https://www.kroger.com/p/x");
  });

  it("passes a url field's plain string through unchanged (a url field bound to an ordinary Text column)", () => {
    const values = mapSharePointFieldsToValues(fields, { LinktoItem: "https://www.kroger.com/p/x" });
    expect(values.link).toBe("https://www.kroger.com/p/x");
  });
});

describe("selectColumnsForEditPrefill", () => {
  it("selects every bound column, plus the LookupId companion for peoplePicker fields", () => {
    const select = selectColumnsForEditPrefill(fields);
    expect(select).toEqual(
      expect.arrayContaining(["Title", "StartTime", "Day", "Host", "HostLookupId", "Cohosts", "CohostsLookupId", "Categories"])
    );
    expect(select).not.toContain("notes"); // virtual field — nothing bound to select
  });

  it("skips virtual fields and fields with no bindTo", () => {
    const select = selectColumnsForEditPrefill({
      note: { page: "p1", source: "virtual", controlType: "paragraph" },
      calc: { page: "p1", source: "sharepoint", controlType: "calculatedDisplay" },
    });
    expect(select).toEqual([]);
  });
});
