// Structural validation for a Custom View's query — the successor to the
// prototype's `checkQuery`. Every field name must exist in the target
// list's real column schema; every operator must be in the closed
// allowlist below; every value must be the right shape for its operator;
// and the whole `where` tree is bounded in depth and size. A rejection is
// a clean ViewQueryError with a stable `code`, never a Graph-level error
// that would leak implementation detail into an untrusted view.

import type { Condition, ConditionRule } from "@skye/config";
import {
  ARRAY_VALUE_OPERATORS,
  MAX_CONDITION_DEPTH,
  MAX_CONDITION_RULES,
  MAX_ORDER_BY,
  MAX_SKIP,
  MAX_TOP,
  STRING_ONLY_OPERATORS,
  VALUELESS_OPERATORS,
  type ViewOrderBy,
  type ViewQuery,
} from "./viewQuery.js";

/** The only filter operators a view may use. Deliberately a hardcoded set, not derived from a type. */
const ALLOWED_OPERATORS = new Set<string>([
  "equals",
  "notEquals",
  "in",
  "notIn",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "isEmpty",
  "isNotEmpty",
  "contains",
]);

/** Thrown for any malformed / disallowed query. `code` stays stable so the runtime and tests can branch on it. */
export class ViewQueryError extends Error {
  code: string;
  constructor(message: string, code = "badQuery") {
    super(message);
    this.name = "ViewQueryError";
    this.code = code;
  }
}

/** True for a plain (non-array, non-null) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A primitive OData-comparable value: string, finite number, or boolean. */
function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean";
}

/**
 * Recursively validates one node of a `where` tree. Throws on the first
 * problem. `depth` guards nesting; `counter.rules` guards total leaf count.
 */
function validateCondition(node: unknown, allowedFields: Set<string>, depth: number, counter: { rules: number }): void {
  if (depth > MAX_CONDITION_DEPTH) {
    throw new ViewQueryError(`filter is nested deeper than the limit of ${MAX_CONDITION_DEPTH}`);
  }
  if (!isPlainObject(node)) {
    throw new ViewQueryError("each filter node must be an object");
  }

  // Group node: exactly one of all / any / not.
  const groupKeys = ["all", "any", "not"].filter((k) => k in node);
  if (groupKeys.length > 1) {
    throw new ViewQueryError("a filter group must have exactly one of all / any / not");
  }
  if (groupKeys.length === 1) {
    const key = groupKeys[0];
    if (key === "not") {
      validateCondition(node.not, allowedFields, depth + 1, counter);
      return;
    }
    const branches = node[key];
    if (!Array.isArray(branches) || branches.length === 0) {
      throw new ViewQueryError(`"${key}" must be a non-empty array of conditions`);
    }
    for (const branch of branches) validateCondition(branch, allowedFields, depth + 1, counter);
    return;
  }

  // Leaf rule: { field, operator, value? }.
  counter.rules += 1;
  if (counter.rules > MAX_CONDITION_RULES) {
    throw new ViewQueryError(`filter has more than the limit of ${MAX_CONDITION_RULES} conditions`);
  }

  const rule = node as Partial<ConditionRule>;
  if (typeof rule.field !== "string") {
    throw new ViewQueryError("a filter condition needs a string field name");
  }
  if (!allowedFields.has(rule.field)) {
    throw new ViewQueryError(`unknown field "${rule.field}" — not a column on this list`, "unknownField");
  }
  if (typeof rule.operator !== "string" || !ALLOWED_OPERATORS.has(rule.operator)) {
    throw new ViewQueryError(`unsupported filter operator: ${String(rule.operator)}`, "badOperator");
  }

  // Value shape must match the operator.
  if (VALUELESS_OPERATORS.has(rule.operator)) {
    if ("value" in node && node.value !== undefined) {
      throw new ViewQueryError(`operator "${rule.operator}" does not take a value`);
    }
    return;
  }
  if (!("value" in node) || rule.value === undefined) {
    throw new ViewQueryError(`operator "${rule.operator}" needs a value`);
  }
  if (ARRAY_VALUE_OPERATORS.has(rule.operator)) {
    if (!Array.isArray(rule.value) || rule.value.length === 0 || !rule.value.every(isScalar)) {
      throw new ViewQueryError(`operator "${rule.operator}" needs a non-empty array of scalar values`);
    }
    return;
  }
  if (STRING_ONLY_OPERATORS.has(rule.operator)) {
    if (typeof rule.value !== "string") {
      throw new ViewQueryError(`operator "${rule.operator}" needs a string value`);
    }
    return;
  }
  if (!isScalar(rule.value)) {
    throw new ViewQueryError(`operator "${rule.operator}" needs a string, number, or boolean value`);
  }
}

/** Validates and normalizes `orderBy`, returning a clean array. */
function validateOrderBy(raw: unknown, allowedFields: Set<string>): ViewOrderBy[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new ViewQueryError("orderBy must be an array");
  if (raw.length > MAX_ORDER_BY) throw new ViewQueryError(`orderBy has more than the limit of ${MAX_ORDER_BY} keys`);

  return raw.map((entry) => {
    if (!isPlainObject(entry) || typeof entry.field !== "string") {
      throw new ViewQueryError("each orderBy entry needs a string field name");
    }
    if (!allowedFields.has(entry.field)) {
      throw new ViewQueryError(`unknown orderBy field "${entry.field}"`, "unknownField");
    }
    const direction = entry.direction ?? "asc";
    if (direction !== "asc" && direction !== "desc") {
      throw new ViewQueryError(`orderBy direction must be "asc" or "desc", got "${String(entry.direction)}"`);
    }
    return { field: entry.field, direction };
  });
}

/** Validates `select`, returning a clean string array. */
function validateSelect(raw: unknown, allowedFields: Set<string>): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((s) => typeof s === "string")) {
    throw new ViewQueryError("select must be an array of field names");
  }
  for (const name of raw) {
    if (!allowedFields.has(name)) throw new ViewQueryError(`unknown select field "${name}"`, "unknownField");
  }
  return [...new Set(raw)];
}

/** Validates a positive integer bound, clamping to `max`. */
function validateBound(raw: unknown, name: string, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min) {
    throw new ViewQueryError(`${name} must be an integer >= ${min}`);
  }
  return Math.min(raw, max);
}

/**
 * Validates an untrusted query object against a list's real column names.
 * Returns a normalized ViewQuery (bounds clamped, orderBy directions
 * defaulted). Throws ViewQueryError on anything malformed or disallowed.
 *
 * `allowedFields` is the set of internal column names from
 * GraphClient.getListColumns — so a typo or a probe for a field that
 * isn't there is rejected structurally, before any Graph call.
 */
export function validateViewQuery(query: unknown, allowedFields: Set<string>): ViewQuery {
  if (query === undefined || query === null) return {};
  if (!isPlainObject(query)) throw new ViewQueryError("query must be an object");

  // Reject unknown top-level keys so a smuggled `filter: "<raw odata>"` can never slip through.
  const KNOWN_KEYS = new Set(["where", "orderBy", "select", "top", "skip", "count", "cursor"]);
  for (const key of Object.keys(query)) {
    if (!KNOWN_KEYS.has(key)) throw new ViewQueryError(`unknown query option "${key}"`);
  }

  if (query.where !== undefined) {
    validateCondition(query.where, allowedFields, 1, { rules: 0 });
  }
  const orderBy = validateOrderBy(query.orderBy, allowedFields);
  const select = validateSelect(query.select, allowedFields);
  const top = validateBound(query.top, "top", 1, MAX_TOP);
  const skip = validateBound(query.skip, "skip", 0, MAX_SKIP);

  if (query.count !== undefined && typeof query.count !== "boolean") {
    throw new ViewQueryError("count must be a boolean");
  }
  if (query.cursor !== undefined && typeof query.cursor !== "string") {
    throw new ViewQueryError("cursor must be a string");
  }

  return {
    where: query.where as Condition | undefined,
    orderBy,
    select,
    top,
    skip,
    count: query.count as boolean | undefined,
    cursor: query.cursor as string | undefined,
  };
}
