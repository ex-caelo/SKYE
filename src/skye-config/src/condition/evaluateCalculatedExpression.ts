import type { CalculatedExpression, FieldValues } from "../schema/types.js";

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Evaluates a calculatedDisplay field's structured expression against the
 * current form values. Deliberately not a free-text formula language — see
 * TODO §1/§13 — so every possible calculation is one of a small, reviewable
 * set of operations rather than arbitrary code.
 */
export function evaluateCalculatedExpression(expr: CalculatedExpression, values: FieldValues): unknown {
  const operands = expr.fields.map((key) => values[key]);

  switch (expr.op) {
    case "sum":
      return operands.reduce<number>((total, v) => total + toNumber(v), 0);
    case "multiply":
      return operands.reduce<number>((total, v) => total * toNumber(v), 1);
    case "subtract":
      return operands.map(toNumber).reduce((acc, n) => acc - n);
    case "divide":
      return operands.map(toNumber).reduce((acc, n) => (n === 0 ? acc : acc / n));
    case "min":
      return Math.min(...operands.map(toNumber));
    case "max":
      return Math.max(...operands.map(toNumber));
    case "concat":
      return operands.map((v) => (v === undefined || v === null ? "" : String(v))).join(expr.separator ?? "");
    default:
      // Exhaustiveness guard — TS should already prevent this, but fail loudly rather than silently returning undefined.
      throw new Error(`Unknown calculatedDisplay op: ${(expr as CalculatedExpression).op}`);
  }
}
