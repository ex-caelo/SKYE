import { describe, it, expect } from "vitest";
import { computeExecutionBatches, shouldCascadeSkip } from "../actions/dependencyGraph.js";
import type { PostAction } from "../schema/types.js";

function action(overrides: Partial<PostAction> = {}): PostAction {
  return { trigger: "afterSubmit", type: "httpRequest", ...overrides };
}

describe("computeExecutionBatches", () => {
  it("puts independent actions in the same batch", () => {
    const batches = computeExecutionBatches({ a: action(), b: action() });
    expect(batches).toEqual([expect.arrayContaining(["a", "b"])]);
    expect(batches[0]).toHaveLength(2);
  });

  it("orders dependent actions into later batches", () => {
    const batches = computeExecutionBatches({
      a: action(),
      b: action({ dependsOn: ["a"] }),
      c: action({ dependsOn: ["b"] }),
    });
    expect(batches).toEqual([["a"], ["b"], ["c"]]);
  });

  it("groups multiple actions that share a satisfied dependency into one batch", () => {
    const batches = computeExecutionBatches({
      a: action(),
      b: action({ dependsOn: ["a"] }),
      c: action({ dependsOn: ["a"] }),
    });
    expect(batches[0]).toEqual(["a"]);
    expect(batches[1]).toEqual(expect.arrayContaining(["b", "c"]));
  });

  it("throws on a dependency cycle", () => {
    expect(() =>
      computeExecutionBatches({
        a: action({ dependsOn: ["b"] }),
        b: action({ dependsOn: ["a"] }),
      })
    ).toThrow(/cycle/);
  });
});

describe("shouldCascadeSkip", () => {
  it("cascades when a dependency was skipped", () => {
    expect(shouldCascadeSkip(action({ dependsOn: ["a"] }), { a: "skipped" })).toBe(true);
  });

  it("cascades when a dependency failed (interim default)", () => {
    expect(shouldCascadeSkip(action({ dependsOn: ["a"] }), { a: "failed" })).toBe(true);
  });

  it("does not cascade when the dependency ran successfully", () => {
    expect(shouldCascadeSkip(action({ dependsOn: ["a"] }), { a: "ran" })).toBe(false);
  });

  it("honors runIfDependencySkipped to opt out of cascading", () => {
    expect(shouldCascadeSkip(action({ dependsOn: ["a"], runIfDependencySkipped: true }), { a: "skipped" })).toBe(false);
  });
});
