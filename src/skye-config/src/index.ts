// Public API surface of @skye/config. The app package should import from
// here rather than reaching into individual files, so this file is the
// single place that defines what's "public" vs. internal implementation detail.

export * from "./schema/types.js";

export { mergeConfig, type MergeResult } from "./merge/mergeConfig.js";
export { lintOverlay, assertOverlayIsAdditive, type LintIssue } from "./merge/lintOverlay.js";
export { computeConfigDiff, type ConfigDiff, type DiffEntry, type DiffStatus, type VisibilityChange } from "./merge/configDiff.js";

export { evaluateCondition } from "./condition/evaluateCondition.js";
export { evaluateCalculatedExpression } from "./condition/evaluateCalculatedExpression.js";

export { validateField, runCustomValidators, type ValidationResult } from "./validation/nativeValidators.js";
export { createCustomValidatorRegistry, type CustomValidatorFn } from "./validation/customValidatorRegistry.js";
export { validateFormConfig, validateFormConfigOverlay, formatSchemaErrors, type SchemaValidationResult } from "./validation/validateConfig.js";

export {
  resolveSchemaRef,
  resolveNode,
  getObjectProperties,
  getConditionalProperties,
  classifySchemaProperty,
  getFieldSchemaProperties,
  getPageSchemaProperties,
  getPostActionSchemaProperties,
  getFormTopLevelProperties,
  type JsonSchemaNode,
  type SchemaProperty,
  type SchemaPropertyKind,
} from "./schema/schemaIntrospection.js";

export { interpolate, type TemplateContext } from "./actions/templating.js";
export { computeExecutionBatches, shouldCascadeSkip, type ActionOutcome } from "./actions/dependencyGraph.js";
export { runTriggerPhase, type TriggerPhaseResult } from "./actions/actionRunner.js";
export { createDefaultHandlerRegistry } from "./actions/defaultHandlerRegistry.js";
export type { ActionExecutionContext, ActionHandler, ActionHandlerRegistry, ScriptAction } from "./actions/handlers/registry.js";
