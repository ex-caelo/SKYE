import { describe, it, expect } from "vitest";
import { evaluateCalculatedExpression } from "../condition/evaluateCalculatedExpression.js";

describe("evaluateCalculatedExpression", () => {
  it("sums fields", () => {
    expect(evaluateCalculatedExpression({ op: "sum", fields: ["a", "b"] }, { a: 2, b: 3 })).toBe(5);
  });

  it("multiplies fields (e.g. quantity * price)", () => {
    expect(evaluateCalculatedExpression({ op: "multiply", fields: ["quantity", "price"] }, { quantity: 4, price: 12.5 })).toBe(50);
  });

  it("subtracts left-to-right", () => {
    expect(evaluateCalculatedExpression({ op: "subtract", fields: ["a", "b", "c"] }, { a: 10, b: 3, c: 2 })).toBe(5);
  });

  it("concatenates with a separator", () => {
    expect(evaluateCalculatedExpression({ op: "concat", fields: ["first", "last"], separator: " " }, { first: "Jane", last: "Doe" })).toBe(
      "Jane Doe"
    );
  });

  it("treats non-numeric values as 0 for numeric ops", () => {
    expect(evaluateCalculatedExpression({ op: "sum", fields: ["a", "b"] }, { a: 5, b: undefined })).toBe(5);
  });
});
