import { describe, it, expect } from "vitest";
import { customValidators } from "../features/form/customValidatorRegistry.js";

describe("compareField", () => {
  it("passes a greaterThan check between two datetime-local fields", () => {
    const args = { field: "startTime", operator: "greaterThan" };
    expect(customValidators.compareField("2026-09-22T15:00", { startTime: "2026-09-22T14:00" }, args)).toBe(true);
  });

  it("fails and reports a message when the ordering is violated", () => {
    const args = { field: "startTime", operator: "greaterThan", message: "End time must be after start time." };
    expect(customValidators.compareField("2026-09-22T13:00", { startTime: "2026-09-22T14:00" }, args)).toBe(
      "End time must be after start time."
    );
  });

  it("compares plain numbers numerically", () => {
    const args = { field: "minAttendees", operator: "greaterThanOrEqual" };
    expect(customValidators.compareField(10, { minAttendees: 25 }, args)).not.toBe(true);
    expect(customValidators.compareField(30, { minAttendees: 25 }, args)).toBe(true);
  });

  it("skips the check (returns true) while either side is still empty", () => {
    const args = { field: "startTime", operator: "greaterThan" };
    expect(customValidators.compareField("", { startTime: "2026-09-22T14:00" }, args)).toBe(true);
    expect(customValidators.compareField("2026-09-22T15:00", {}, args)).toBe(true);
  });

  it("throws when args are missing required keys", () => {
    expect(() => customValidators.compareField("x", {}, {})).toThrow(/requires args.field and args.operator/);
  });
});

describe("dateNotInPast", () => {
  it("accepts today by default (allowToday defaults true)", () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    expect(customValidators.dateNotInPast(todayKey, {}, {})).toBe(true);
  });

  it("rejects a date before today", () => {
    expect(customValidators.dateNotInPast("2000-01-01", {}, {})).not.toBe(true);
  });

  it("accepts any future date", () => {
    expect(customValidators.dateNotInPast("2999-01-01", {}, {})).toBe(true);
  });
});

describe("atLeastOneOf", () => {
  it("passes once at least one listed field is filled", () => {
    const args = { fields: ["host", "cohosts"] };
    expect(customValidators.atLeastOneOf(undefined, { host: "", cohosts: ["a@b.com"] }, args)).toBe(true);
  });

  it("fails with a message when every listed field is empty", () => {
    const args = { fields: ["host", "cohosts"], message: "Provide a host or a cohost." };
    expect(customValidators.atLeastOneOf(undefined, { host: "", cohosts: [] }, args)).toBe("Provide a host or a cohost.");
  });

  it("throws when args.fields is missing or empty", () => {
    expect(() => customValidators.atLeastOneOf(undefined, {}, {})).toThrow(/non-empty args.fields/);
  });
});
