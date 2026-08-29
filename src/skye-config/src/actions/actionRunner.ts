import type { PostAction, PostActionTrigger, FieldValues } from "../schema/types.js";
import { evaluateCondition } from "../condition/evaluateCondition.js";
import { computeExecutionBatches, shouldCascadeSkip, type ActionOutcome } from "./dependencyGraph.js";
import type { ActionExecutionContext, ActionHandlerRegistry } from "./handlers/registry.js";

export interface TriggerPhaseResult {
  outcomes: Record<string, ActionOutcome>;
  results: Record<string, unknown>;
  errors: Record<string, Error>;
}

/**
 * Runs every postAction for a single trigger phase (beforeSubmit,
 * afterSubmit, onSuccess, or onError), respecting dependsOn ordering,
 * `when` guards, and the skip-cascade rule. Actions with no dependency
 * relationship run in parallel within the same batch.
 *
 * NOTE on failure handling (still an open call — see TODO §9): a failed
 * action's dependents are, by default, cascade-skipped exactly like a
 * `when: false` skip would cascade (unless runIfDependencySkipped is set).
 * This is an interim default so the phase doesn't hang or throw
 * unpredictably; whether a failure should instead immediately abort the
 * whole submission and fire onError is a product decision the caller
 * (the app's submitForm orchestration) should make explicit once decided —
 * this function just reports what happened via `errors` and lets the
 * caller react.
 */
export async function runTriggerPhase(
  postActions: Record<string, PostAction>,
  trigger: PostActionTrigger,
  values: FieldValues,
  handlerRegistry: ActionHandlerRegistry,
  makeExecutionContext: (resultsSoFar: Record<string, unknown>) => ActionExecutionContext
): Promise<TriggerPhaseResult> {
  // Only this phase's actions participate in dependency resolution — dependsOn is scoped per-trigger by convention.
  const phaseActions = Object.fromEntries(Object.entries(postActions).filter(([, a]) => a.trigger === trigger));

  const batches = computeExecutionBatches(phaseActions);
  const outcomes: Record<string, ActionOutcome> = {};
  const results: Record<string, unknown> = {};
  const errors: Record<string, Error> = {};

  for (const batch of batches) {
    // Everything in a batch is independent of everything else in it, so run them concurrently.
    await Promise.all(
      batch.map(async (key) => {
        const action = phaseActions[key];

        if (shouldCascadeSkip(action, outcomes)) {
          outcomes[key] = "skipped";
          return;
        }

        if (action.when && !evaluateCondition(action.when, values)) {
          outcomes[key] = "skipped";
          return;
        }

        const handler = handlerRegistry[action.type];
        if (!handler) {
          errors[key] = new Error(`No handler registered for postAction type "${action.type}".`);
          outcomes[key] = "failed";
          return;
        }

        try {
          const ctx = makeExecutionContext(results);
          results[key] = await handler(action, ctx);
          outcomes[key] = "ran";
        } catch (err) {
          errors[key] = err instanceof Error ? err : new Error(String(err));
          outcomes[key] = "failed";
        }
      })
    );
  }

  return { outcomes, results, errors };
}
