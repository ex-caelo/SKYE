import type { PostAction } from "../schema/types.js";

/** Outcome of one action after an execution attempt, tracked so dependents can check it. */
export type ActionOutcome = "ran" | "skipped" | "failed";

/**
 * Groups a trigger phase's actions into ordered batches: every action in
 * batch N only depends on actions in batches 0..N-1, so everything within
 * one batch can safely run in parallel. Standard Kahn's-algorithm topo sort,
 * just grouped by level instead of flattened, so the runner knows what it
 * can parallelize.
 */
export function computeExecutionBatches(actions: Record<string, PostAction>): string[][] {
  const remaining = new Map(Object.entries(actions));
  const batches: string[][] = [];
  const done = new Set<string>();

  while (remaining.size > 0) {
    // An action is ready once every key in its dependsOn has already been placed in an earlier batch.
    const ready = [...remaining.entries()]
      .filter(([, action]) => (action.dependsOn ?? []).every((dep) => done.has(dep)))
      .map(([key]) => key);

    if (ready.length === 0) {
      // Nothing became ready this pass but actions remain — a cycle (or a dependsOn referencing
      // a key outside this trigger phase, which is equally unresolvable).
      throw new Error(
        `Cannot resolve postAction dependency order — check for a cycle or a dependsOn referencing an action outside this trigger phase. Unresolved: ${[...remaining.keys()].join(", ")}`
      );
    }

    batches.push(ready);
    for (const key of ready) {
      done.add(key);
      remaining.delete(key);
    }
  }

  return batches;
}

/**
 * Implements the skip-cascade default described in the README: if any of an
 * action's dependencies was skipped (or, per runIfDependencySkipped, we
 * choose to ignore that), this action is skipped too — without even
 * checking its own `when`. A skip is not a failure; it doesn't trigger
 * onError.
 *
 * Note: this only cascades on a dependency being *skipped*. Whether a
 * dependency that ran and *failed* should also cascade-skip its dependents,
 * versus immediately failing the whole submission, is still an open
 * question (see TODO §9) — for now a failed dependency is NOT treated as a
 * skip here; the caller (actionRunner) decides what "failed" does at the
 * phase level.
 */
export function shouldCascadeSkip(action: PostAction, outcomes: Record<string, ActionOutcome>): boolean {
  if (action.runIfDependencySkipped) return false;
  // Interim default (see actionRunner.ts and TODO §9): a failed dependency cascades exactly like a skipped one,
  // so a dependent doesn't blindly run against data that never materialized.
  return (action.dependsOn ?? []).some((dep) => outcomes[dep] === "skipped" || outcomes[dep] === "failed");
}
