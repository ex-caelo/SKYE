// Turns a VALIDATED ViewQuery into the OData query parameters the Graph
// list-items endpoint understands. This is the one place a structured view
// query becomes a string, so it is the OData-injection surface — treat
// every change here as security-sensitive.
//
// Note: @skye/config's `evaluateCondition` is an in-memory evaluator, not
// an OData producer, so only the Condition *shape* is shared — this
// compiler is separate on purpose.
//
// Two layers of defense against injection:
//   1. Field names were already checked against the list's real column
//      schema by validateViewQuery. We re-assert the identifier charset
//      here anyway.
//   2. Every string value is single-quote-escaped per OData ('' for ').
//      No value or field is ever concatenated raw.

import type { Condition, ConditionRule } from "@skye/config";
import type { ViewQuery } from "./viewQuery.js";

/** The compiled parameters, ready to spread onto a ListItemQuery. */
export interface CompiledQuery {
  filter?: string;
  orderby?: string;
  top?: number;
  skip?: number;
  count?: boolean;
  select?: string[];
}

/** SharePoint internal column names are alphanumeric + underscore (specials arrive pre-encoded, e.g. `_x0020_`). */
const SAFE_FIELD = /^[A-Za-z0-9_]+$/;

const BINARY_OPERATORS: Record<string, string> = {
  equals: "eq",
  notEquals: "ne",
  greaterThan: "gt",
  greaterThanOrEqual: "ge",
  lessThan: "lt",
  lessThanOrEqual: "le",
};

/** Asserts a field name is a safe identifier, then prefixes it for the `fields` expansion. */
function fieldRef(name: string): string {
  if (!SAFE_FIELD.test(name)) {
    // Should be unreachable — validateViewQuery already rejected anything not on the schema.
    throw new Error(`unsafe field name reached the OData compiler: ${JSON.stringify(name)}`);
  }
  return `fields/${name}`;
}

/** Formats a scalar as an OData literal. Strings are single-quote-escaped. */
function literal(value: string | number | boolean): string {
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value); // finite number, guaranteed by validation
}

/** Compiles one leaf rule to an OData boolean expression. */
function compileRule(rule: ConditionRule): string {
  const ref = fieldRef(rule.field);
  const op = rule.operator;

  if (op === "isEmpty") return `${ref} eq null`;
  if (op === "isNotEmpty") return `${ref} ne null`;

  if (op === "contains") {
    return `contains(${ref}, ${literal(rule.value as string)})`;
  }

  if (op === "in" || op === "notIn") {
    const values = rule.value as Array<string | number | boolean>;
    if (op === "in") {
      return `(${values.map((v) => `${ref} eq ${literal(v)}`).join(" or ")})`;
    }
    return `(${values.map((v) => `${ref} ne ${literal(v)}`).join(" and ")})`;
  }

  const odataOp = BINARY_OPERATORS[op];
  if (!odataOp) throw new Error(`unhandled operator in compiler: ${op}`);
  return `${ref} ${odataOp} ${literal(rule.value as string | number | boolean)}`;
}

/** Recursively compiles a Condition tree to an OData `$filter` string. */
function compileCondition(node: Condition): string {
  if ("all" in node && node.all) {
    return `(${node.all.map(compileCondition).join(" and ")})`;
  }
  if ("any" in node && node.any) {
    return `(${node.any.map(compileCondition).join(" or ")})`;
  }
  if ("not" in node && node.not) {
    return `not (${compileCondition(node.not)})`;
  }
  return compileRule(node as ConditionRule);
}

/**
 * Compiles a validated ViewQuery. A `cursor` short-circuits everything
 * else (the caller passes it straight through as an opaque continuation
 * URL), so this only handles the first-page case.
 */
export function compileQueryToOData(query: ViewQuery): CompiledQuery {
  const compiled: CompiledQuery = {};

  if (query.where) compiled.filter = compileCondition(query.where);

  if (query.orderBy?.length) {
    compiled.orderby = query.orderBy.map((o) => `${fieldRef(o.field)} ${o.direction ?? "asc"}`).join(",");
  }

  if (query.select?.length) {
    for (const name of query.select) {
      if (!SAFE_FIELD.test(name)) throw new Error(`unsafe select field reached the OData compiler: ${JSON.stringify(name)}`);
    }
    compiled.select = [...query.select];
  }

  if (query.top !== undefined) compiled.top = query.top;
  if (query.skip !== undefined) compiled.skip = query.skip;
  if (query.count) compiled.count = true;

  return compiled;
}
