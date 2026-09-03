import { describe, it, expect } from "vitest";
import { validateViewQuery, ViewQueryError } from "../features/custom-views/validateViewQuery.js";
import { MAX_TOP } from "../features/custom-views/viewQuery.js";

const fields = new Set(["Title", "Start", "Capacity", "Category"]);

describe("validateViewQuery", () => {
  it("accepts an empty / absent query", () => {
    expect(validateViewQuery(undefined, fields)).toEqual({});
    expect(validateViewQuery({}, fields)).toEqual({});
  });

  it("rejects a non-object query", () => {
    expect(() => validateViewQuery("Title eq 1", fields)).toThrow(ViewQueryError);
  });

  it("rejects an unknown top-level key so a raw `filter` string can't be smuggled in", () => {
    expect(() => validateViewQuery({ filter: "1 eq 1" }, fields)).toThrow(/unknown query option "filter"/);
  });

  it("accepts a valid leaf condition", () => {
    const q = validateViewQuery({ where: { field: "Title", operator: "equals", value: "x" } }, fields);
    expect(q.where).toEqual({ field: "Title", operator: "equals", value: "x" });
  });

  it("rejects an unknown field with the unknownField code", () => {
    try {
      validateViewQuery({ where: { field: "Ssn", operator: "equals", value: "x" } }, fields);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ViewQueryError).code).toBe("unknownField");
    }
  });

  it("rejects an operator not in the allowlist with the badOperator code", () => {
    try {
      validateViewQuery({ where: { field: "Title", operator: "eq' or '1'='1", value: "x" } }, fields);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ViewQueryError).code).toBe("badOperator");
    }
  });

  it("rejects a field name carrying smuggled OData", () => {
    expect(() =>
      validateViewQuery({ where: { field: "Title eq 'x' or Title ne 'x", operator: "equals", value: "z" } }, fields)
    ).toThrow(ViewQueryError);
  });

  it("requires a value for value operators and forbids one for isEmpty/isNotEmpty", () => {
    expect(() => validateViewQuery({ where: { field: "Title", operator: "equals" } }, fields)).toThrow(/needs a value/);
    expect(() => validateViewQuery({ where: { field: "Title", operator: "isEmpty", value: "x" } }, fields)).toThrow(/does not take a value/);
    expect(validateViewQuery({ where: { field: "Title", operator: "isNotEmpty" } }, fields).where).toBeTruthy();
  });

  it("requires an array for in / notIn and a string for contains", () => {
    expect(() => validateViewQuery({ where: { field: "Category", operator: "in", value: "talk" } }, fields)).toThrow(/array/);
    expect(validateViewQuery({ where: { field: "Category", operator: "in", value: ["talk", "social"] } }, fields).where).toBeTruthy();
    expect(() => validateViewQuery({ where: { field: "Title", operator: "contains", value: 5 } }, fields)).toThrow(/string value/);
  });

  it("enforces the group shape (exactly one of all/any/not, non-empty arrays)", () => {
    expect(() => validateViewQuery({ where: { all: [], any: [] } }, fields)).toThrow(/exactly one/);
    expect(() => validateViewQuery({ where: { all: [] } }, fields)).toThrow(/non-empty array/);
    const ok = validateViewQuery(
      { where: { any: [{ field: "Title", operator: "equals", value: "a" }, { not: { field: "Category", operator: "equals", value: "social" } }] } },
      fields
    );
    expect(ok.where).toBeTruthy();
  });

  it("caps nesting depth", () => {
    let node: unknown = { field: "Title", operator: "equals", value: "x" };
    for (let i = 0; i < 10; i++) node = { all: [node] };
    expect(() => validateViewQuery({ where: node }, fields)).toThrow(/nested deeper/);
  });

  it("clamps top to MAX_TOP and rejects a non-integer / negative bound", () => {
    expect(validateViewQuery({ top: 10_000 }, fields).top).toBe(MAX_TOP);
    expect(() => validateViewQuery({ top: 0 }, fields)).toThrow();
    expect(() => validateViewQuery({ skip: -1 }, fields)).toThrow();
    expect(validateViewQuery({ skip: 50 }, fields).skip).toBe(50);
  });

  it("validates orderBy fields and directions", () => {
    expect(() => validateViewQuery({ orderBy: [{ field: "Nope" }] }, fields)).toThrow(/unknown orderBy field/);
    expect(() => validateViewQuery({ orderBy: [{ field: "Start", direction: "sideways" }] }, fields)).toThrow(/asc.*desc/);
    expect(validateViewQuery({ orderBy: [{ field: "Start", direction: "desc" }] }, fields).orderBy).toEqual([{ field: "Start", direction: "desc" }]);
    expect(validateViewQuery({ orderBy: [{ field: "Start" }] }, fields).orderBy).toEqual([{ field: "Start", direction: "asc" }]);
  });

  it("validates select field names", () => {
    expect(() => validateViewQuery({ select: ["Title", "Bogus"] }, fields)).toThrow(/unknown select field/);
    expect(validateViewQuery({ select: ["Title", "Title"] }, fields).select).toEqual(["Title"]);
  });
});
