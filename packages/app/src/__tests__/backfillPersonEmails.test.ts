import { describe, it, expect, vi } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import { backfillPersonEmails } from "../features/form/submit/backfillPersonEmails.js";

const fields: Record<string, FieldConfig> = {
  host: { page: "p", source: "sharepoint", bindTo: "Host", controlType: "peoplePicker" },
  cohosts: { page: "p", source: "sharepoint", bindTo: "Cohosts", controlType: "peoplePicker" },
  title: { page: "p", source: "sharepoint", bindTo: "Title", controlType: "text" },
};

describe("backfillPersonEmails", () => {
  it("resolves and fills in Email for a single-value peoplePicker entry with a blank Email", async () => {
    const resolveEmail = vi.fn(async (lookupId: number) => (lookupId === 14 ? "lison@iu.edu" : null));
    const values = await backfillPersonEmails(
      fields,
      { host: { LookupId: 14, LookupValue: "Cloteaux, Lison" } },
      resolveEmail
    );
    expect(values.host).toEqual({ LookupId: 14, LookupValue: "Cloteaux, Lison", Email: "lison@iu.edu" });
    expect(resolveEmail).toHaveBeenCalledWith(14);
  });

  it("resolves each entry of a multi-value peoplePicker field independently", async () => {
    const resolveEmail = vi.fn(async (lookupId: number) => ({ 22: "carley@iu.edu", 23: "sam@iu.edu" })[lookupId] ?? null);
    const values = await backfillPersonEmails(
      fields,
      {
        cohosts: [
          { LookupId: 22, LookupValue: "Weyandt, Carley Jane" },
          { LookupId: 23, LookupValue: "Patel, Sam", Email: "already@iu.edu" }, // already has one — left alone
        ],
      },
      resolveEmail
    );
    expect(values.cohosts).toEqual([
      { LookupId: 22, LookupValue: "Weyandt, Carley Jane", Email: "carley@iu.edu" },
      { LookupId: 23, LookupValue: "Patel, Sam", Email: "already@iu.edu" },
    ]);
    // Only the blank-Email entry triggered a lookup.
    expect(resolveEmail).toHaveBeenCalledTimes(1);
    expect(resolveEmail).toHaveBeenCalledWith(22);
  });

  it("leaves an entry alone when it already has a non-blank Email", async () => {
    const resolveEmail = vi.fn(async () => "should-not-be-called@iu.edu");
    const values = await backfillPersonEmails(fields, { host: { LookupId: 14, Email: "real@iu.edu" } }, resolveEmail);
    expect(values.host).toEqual({ LookupId: 14, Email: "real@iu.edu" });
    expect(resolveEmail).not.toHaveBeenCalled();
  });

  it("leaves a value alone when the lookup doesn't resolve anything", async () => {
    const resolveEmail = vi.fn(async () => null);
    const values = await backfillPersonEmails(fields, { host: { LookupId: 14, LookupValue: "Cloteaux, Lison" } }, resolveEmail);
    expect(values.host).toEqual({ LookupId: 14, LookupValue: "Cloteaux, Lison" }); // unchanged, not left half-patched
  });

  it("leaves a plain string value alone (already a resolvable key from a fresh pick) without calling resolveEmail", async () => {
    const resolveEmail = vi.fn(async () => "x@y.edu");
    const values = await backfillPersonEmails(fields, { host: "already-a-key@iu.edu" }, resolveEmail);
    expect(values.host).toBe("already-a-key@iu.edu");
    expect(resolveEmail).not.toHaveBeenCalled();
  });

  it("ignores non-peoplePicker fields entirely", async () => {
    const resolveEmail = vi.fn(async () => "x@y.edu");
    const values = await backfillPersonEmails(fields, { title: "Some Event" }, resolveEmail);
    expect(values.title).toBe("Some Event");
    expect(resolveEmail).not.toHaveBeenCalled();
  });
});
