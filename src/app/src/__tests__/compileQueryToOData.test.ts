import { describe, it, expect } from "vitest";
import { compileQueryToOData } from "../lib/views/compileQueryToOData.js";
import type { ViewQuery } from "../lib/views/viewQuery.js";

describe("compileQueryToOData", () => {
  it("compiles each binary operator", () => {
    const cases: Array<[ViewQuery["where"], string]> = [
      [{ field: "Title", operator: "equals", value: "x" }, "fields/Title eq 'x'"],
      [{ field: "Title", operator: "notEquals", value: "x" }, "fields/Title ne 'x'"],
      [{ field: "Capacity", operator: "greaterThan", value: 10 }, "fields/Capacity gt 10"],
      [{ field: "Capacity", operator: "greaterThanOrEqual", value: 10 }, "fields/Capacity ge 10"],
      [{ field: "Capacity", operator: "lessThan", value: 10 }, "fields/Capacity lt 10"],
      [{ field: "Capacity", operator: "lessThanOrEqual", value: 10 }, "fields/Capacity le 10"],
    ];
    for (const [where, expected] of cases) {
      expect(compileQueryToOData({ where }).filter).toBe(expected);
    }
  });

  it("compiles isEmpty / isNotEmpty to null comparisons", () => {
    expect(compileQueryToOData({ where: { field: "Title", operator: "isEmpty" } }).filter).toBe("fields/Title eq null");
    expect(compileQueryToOData({ where: { field: "Title", operator: "isNotEmpty" } }).filter).toBe("fields/Title ne null");
  });

  it("compiles contains() with a quoted, escaped argument", () => {
    expect(compileQueryToOData({ where: { field: "Title", operator: "contains", value: "a'b" } }).filter).toBe("contains(fields/Title, 'a''b')");
  });

  it("expands in / notIn to or / and chains", () => {
    expect(compileQueryToOData({ where: { field: "Category", operator: "in", value: ["talk", "social"] } }).filter).toBe(
      "(fields/Category eq 'talk' or fields/Category eq 'social')"
    );
    expect(compileQueryToOData({ where: { field: "Category", operator: "notIn", value: ["talk", "social"] } }).filter).toBe(
      "(fields/Category ne 'talk' and fields/Category ne 'social')"
    );
  });

  it("compiles nested all / any / not groups", () => {
    const where: ViewQuery["where"] = {
      all: [
        { field: "Category", operator: "equals", value: "talk" },
        { any: [{ field: "Capacity", operator: "greaterThan", value: 100 }, { not: { field: "Title", operator: "isEmpty" } }] },
      ],
    };
    expect(compileQueryToOData({ where }).filter).toBe(
      "(fields/Category eq 'talk' and (fields/Capacity gt 100 or not (fields/Title eq null)))"
    );
  });

  it("single-quote-escapes string values (OData injection defense)", () => {
    const filter = compileQueryToOData({ where: { field: "Title", operator: "equals", value: "x' or fields/Title ne 'x" } }).filter;
    expect(filter).toBe("fields/Title eq 'x'' or fields/Title ne ''x'");
    // The apostrophes are all doubled — the value stays a single string literal.
    expect(filter!.match(/'/g)!.length % 2).toBe(0);
  });

  it("compiles booleans and numbers without quotes", () => {
    expect(compileQueryToOData({ where: { field: "Capacity", operator: "equals", value: 0 } }).filter).toBe("fields/Capacity eq 0");
    expect(compileQueryToOData({ where: { field: "Title", operator: "equals", value: true } }).filter).toBe("fields/Title eq true");
  });

  it("compiles orderBy with direction and passes through bounds / count", () => {
    const compiled = compileQueryToOData({
      orderBy: [{ field: "Start", direction: "desc" }, { field: "Title", direction: "asc" }],
      top: 25,
      skip: 50,
      count: true,
      select: ["Title", "Start"],
    });
    expect(compiled.orderby).toBe("fields/Start desc,fields/Title asc");
    expect(compiled.top).toBe(25);
    expect(compiled.skip).toBe(50);
    expect(compiled.count).toBe(true);
    expect(compiled.select).toEqual(["Title", "Start"]);
  });

  it("throws (rather than emitting) if an unsafe field name somehow reaches it", () => {
    expect(() => compileQueryToOData({ where: { field: "Title eq 1 or x", operator: "equals", value: "z" } as never })).toThrow(/unsafe field/);
  });
});
