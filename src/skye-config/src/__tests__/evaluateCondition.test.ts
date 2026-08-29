import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../condition/evaluateCondition.js";

describe("evaluateCondition", () => {
  it("evaluates a simple equals rule", () => {
    expect(evaluateCondition({ field: "campus", operator: "equals", value: "Bloomington" }, { campus: "Bloomington" })).toBe(true);
    expect(evaluateCondition({ field: "campus", operator: "equals", value: "Bloomington" }, { campus: "Indy" })).toBe(false);
  });

  it("evaluates isEmpty/isNotEmpty without a value", () => {
    expect(evaluateCondition({ field: "notes", operator: "isEmpty" }, { notes: "" })).toBe(true);
    expect(evaluateCondition({ field: "notes", operator: "isNotEmpty" }, { notes: "hi" })).toBe(true);
  });

  it("evaluates numeric comparisons", () => {
    expect(evaluateCondition({ field: "qty", operator: "greaterThan", value: 5 }, { qty: 10 })).toBe(true);
    expect(evaluateCondition({ field: "qty", operator: "lessThanOrEqual", value: 5 }, { qty: 10 })).toBe(false);
  });

  it("combines with all/any/not", () => {
    const condition = {
      all: [
        { field: "attendingBanquet", operator: "equals" as const, value: true },
        { field: "quantity", operator: "greaterThan" as const, value: 0 },
      ],
    };
    expect(evaluateCondition(condition, { attendingBanquet: true, quantity: 2 })).toBe(true);
    expect(evaluateCondition(condition, { attendingBanquet: true, quantity: 0 })).toBe(false);

    expect(evaluateCondition({ not: { field: "campus", operator: "equals", value: "X" } }, { campus: "Y" })).toBe(true);
  });

  it("fails closed on an unknown operator rather than showing something that should be hidden", () => {
    // @ts-expect-error deliberately testing an invalid operator
    expect(evaluateCondition({ field: "x", operator: "bogus" }, { x: 1 })).toBe(false);
  });
});
