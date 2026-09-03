import type { Condition, ConditionRule, FieldValues } from "../schema/types.js";

function isGroup(condition: Condition): condition is Extract<Condition, { all?: unknown; any?: unknown; not?: unknown }> {
  return "all" in condition || "any" in condition || "not" in condition;
}

/** Evaluates a single leaf condition (one field, one operator) against the current form values. */
function evaluateRule(rule: ConditionRule, values: FieldValues): boolean {
  const actual = values[rule.field];

  switch (rule.operator) {
    case "equals":
      return actual === rule.value;
    case "notEquals":
      return actual !== rule.value;
    case "in":
      return Array.isArray(rule.value) && rule.value.includes(actual);
    case "notIn":
      return Array.isArray(rule.value) && !rule.value.includes(actual);
    case "greaterThan":
      return typeof actual === "number" && typeof rule.value === "number" && actual > rule.value;
    case "greaterThanOrEqual":
      return typeof actual === "number" && typeof rule.value === "number" && actual >= rule.value;
    case "lessThan":
      return typeof actual === "number" && typeof rule.value === "number" && actual < rule.value;
    case "lessThanOrEqual":
      return typeof actual === "number" && typeof rule.value === "number" && actual <= rule.value;
    case "isEmpty":
      return actual === undefined || actual === null || actual === "";
    case "isNotEmpty":
      return !(actual === undefined || actual === null || actual === "");
    case "contains":
      if (typeof actual === "string" && typeof rule.value === "string") return actual.includes(rule.value);
      if (Array.isArray(actual)) return actual.includes(rule.value);
      return false;
    default:
      // Unknown operator — fail closed (condition is false) rather than accidentally showing something that should be hidden.
      return false;
  }
}

/**
 * Recursively evaluates a condition tree (all/any/not groups, or a single
 * leaf rule) against the current set of field values. Used for both
 * `visibleIf` (fields/pages) and `postAction.when`.
 */
export function evaluateCondition(condition: Condition, values: FieldValues): boolean {
  if (isGroup(condition)) {
    if (condition.all) return condition.all.every((c) => evaluateCondition(c, values));
    if (condition.any) return condition.any.some((c) => evaluateCondition(c, values));
    if (condition.not) return !evaluateCondition(condition.not, values);
    // A group object with none of all/any/not populated shouldn't happen per schema (maxProperties: 1, minProperties: 1) — fail closed.
    return false;
  }
  return evaluateRule(condition, values);
}
