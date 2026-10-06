import type { FieldConfig, FieldValues } from "@skye/form-config";
import { runTriggerPhase, createDefaultHandlerRegistry, type TriggerPhaseResult } from "@skye/form-config";
import type { RawGraphFetch } from "../../../shared/sharepoint/rawGraphFetch.js";
import { buildActionExecutionContext, type AppCallbacks } from "./buildActionContext.js";

/**
 * Runs one `controlType: "button"` field's own, self-contained action chain
 * — the exact same engine submitForm.ts uses for postActions
 * (runTriggerPhase: dependsOn ordering, `when` guards, {{results.x}}
 * chaining), just scoped to this one field's `actions` dict instead of a
 * form-wide submit-lifecycle phase. Every entry in `field.actions` is
 * authored with `trigger: "onClick"` (see the schema), which is also all
 * this function filters by, so it needs no bespoke dependency-batching code
 * of its own.
 *
 * No SharePoint primary-item write happens here — this never calls
 * submitForm. An action that needs to write somewhere (graphRequest/script)
 * does it itself, exactly like a postAction already can; there's no
 * restriction on a button's actions touching the primary item's own list.
 */
export async function runButtonActions(
  field: FieldConfig,
  values: FieldValues,
  item: Record<string, unknown>,
  graphFetch: RawGraphFetch,
  callbacks: AppCallbacks
): Promise<TriggerPhaseResult> {
  const actions = field.actions ?? {};
  const handlerRegistry = createDefaultHandlerRegistry();
  return runTriggerPhase(actions, "onClick", values, handlerRegistry, (resultsSoFar) =>
    buildActionExecutionContext({ fields: values, item, results: resultsSoFar }, graphFetch, callbacks)
  );
}
