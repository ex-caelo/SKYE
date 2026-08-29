// The structured query a Custom View sends to `skye.list()` / `skye.count()`.
// It deliberately has NO free-form OData string anywhere — a view names a
// list and describes what it wants with typed, closed-vocabulary fields.
// validateViewQuery.ts checks one of these; compileQueryToOData.ts turns a
// validated one into the actual Graph query parameters.

import type { Condition } from "@skye/config";

/** One sort key. `direction` defaults to ascending when omitted. */
export interface ViewOrderBy {
  field: string;
  direction?: "asc" | "desc";
}

export interface ViewQuery {
  /**
   * Filter tree, reusing @skye/config's `Condition` shape verbatim (the same
   * grammar as form `visibleIf` / `postAction.when`): `all` / `any` / `not`
   * groups over leaf `{ field, operator, value }` rules. Operators:
   * equals, notEquals, in, notIn, greaterThan, greaterThanOrEqual,
   * lessThan, lessThanOrEqual, isEmpty, isNotEmpty, contains.
   */
  where?: Condition;
  /** Zero or more sort keys, applied in order. */
  orderBy?: ViewOrderBy[];
  /** Field names to return. Omitted = a host-chosen default projection. */
  select?: string[];
  /** Page size. Clamped to [1, MAX_TOP]. */
  top?: number;
  /** Offset paging. Prefer `cursor` where the backend supports continuation. */
  skip?: number;
  /** Ask for the total match count alongside the page. */
  count?: boolean;
  /** Opaque continuation token from a previous page's result (`page.cursor`). */
  cursor?: string;
}

/** The result the host hands back to a view for `skye.list()`. */
export interface ViewListResult {
  items: Array<{ id: string; fields: Record<string, unknown> }>;
  /** Present when there's a next page — pass back as `query.cursor`. */
  cursor?: string;
  /** Present only when the query asked for `count`. */
  totalCount?: number;
}

// --- Limits enforced by validateViewQuery. Kept here so the runtime and the
// --- host agree on the same numbers. ---

/** Hard ceiling on `top`; a view asking for more is clamped, not rejected. */
export const MAX_TOP = 200;
/** Hard ceiling on `skip`, to keep a pathological offset from hammering the backend. */
export const MAX_SKIP = 100_000;
/** Max nesting depth of `all` / `any` / `not` groups. */
export const MAX_CONDITION_DEPTH = 6;
/** Max total number of leaf rules across the whole `where` tree. */
export const MAX_CONDITION_RULES = 64;
/** Max number of sort keys. */
export const MAX_ORDER_BY = 5;

/** Operators whose leaf rule must NOT carry a `value`. */
export const VALUELESS_OPERATORS = new Set(["isEmpty", "isNotEmpty"]);
/** Operators whose `value` must be an array. */
export const ARRAY_VALUE_OPERATORS = new Set(["in", "notIn"]);
/** Operators that only make sense on a string `value`. */
export const STRING_ONLY_OPERATORS = new Set(["contains"]);
