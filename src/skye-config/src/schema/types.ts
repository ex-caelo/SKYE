// Hand-authored TS types mirroring form.config.schema.json.
// Kept in sync manually for now — if the schema and these types drift,
// the schema is the source of truth. Revisit generating these instead
// (e.g. json-schema-to-typescript) once the schema stabilizes.

export type ConditionOperator =
  | "equals"
  | "notEquals"
  | "in"
  | "notIn"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "isEmpty"
  | "isNotEmpty"
  | "contains";

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface ConditionGroup {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
}

export type Condition = ConditionGroup | ConditionRule;

export type CalculatedOp = "sum" | "subtract" | "multiply" | "divide" | "concat" | "min" | "max";

export interface CalculatedExpression {
  op: CalculatedOp;
  fields: string[];
  separator?: string;
}

export interface ValidationMessages {
  required?: string;
  minlength?: string;
  maxlength?: string;
  min?: string;
  max?: string;
  pattern?: string;
  matchesField?: string;
}

export interface FileStorage {
  target?: "attachment" | "library";
  library?: { driveId: string; siteId?: string; folderPath?: string };
}

export interface FieldConfig {
  page?: string;
  source?: "sharepoint" | "virtual";
  bindTo?: string;
  columnId?: string;
  controlType: string;
  label?: string;
  subtitle?: string;
  helpText?: string;
  defaultValue?: unknown;
  readonly?: boolean;
  appearance?: "default" | "switch";
  options?: Array<{ value: unknown; label?: string }>;
  required?: boolean;
  minlength?: number;
  maxlength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  matchesField?: string;
  customValidators?: string[];
  validationMessages?: ValidationMessages;
  attributes?: Record<string, unknown>;
  style?: Record<string, unknown>;
  visibleIf?: Condition;
  order?: number;
  table?: LookupTable;
  fileStorage?: FileStorage;
  calculatedDisplay?: CalculatedExpression;
  relatedList?: { id: string; siteId?: string; displayField: string };
}

export interface LookupTable {
  relatedList: { id: string; siteId?: string };
  linkMode: "lookupColumn" | "parentReference";
  parentReferenceColumn?: string;
  columns: Record<string, FieldConfig>;
  allowAdd?: boolean;
  allowEdit?: boolean;
  allowDelete?: boolean;
  minRows?: number;
  maxRows?: number;
}

export interface PageConfig {
  title: string;
  order?: number;
  visibleIf?: Condition;
  layout?: {
    gridTemplateColumns?: number | string;
    gap?: string;
    gridTemplateRows?: number | string;
    gridTemplateAreas?: string[];
  };
}

export type PostActionTrigger = "beforeSubmit" | "afterSubmit" | "onSuccess" | "onError";
export type PostActionType = "httpRequest" | "graphRequest" | "redirect" | "showMessage" | "setField" | "script";

export interface PostAction {
  trigger: PostActionTrigger;
  when?: Condition;
  dependsOn?: string[];
  type: PostActionType;
  label?: string;
  loadingMessage?: string;
  successMessage?: string;
  errorMessage?: string;
  showInProgress?: boolean;
  runIfDependencySkipped?: boolean;

  // type-specific payloads (only the relevant one is populated per `type`)
  request?: { url: string; method: string; headers?: Record<string, string>; params?: Record<string, string>; body?: unknown };
  to?: string;
  message?: string;
  level?: "info" | "success" | "warning" | "error";
  field?: string;
  value?: unknown;
  functionName?: string;
  args?: unknown[];
}

export interface FormConfig {
  id?: string;
  title?: string;
  description?: string;
  mode?: "create" | "edit" | "both";
  list: { id: string; siteId?: string };
  layout?: { gridTemplateColumns?: number | string; gap?: string };
  pages: Record<string, PageConfig>;
  fields: Record<string, FieldConfig>;
  postActions?: Record<string, PostAction>;
}

/**
 * A permission overlay is a partial FormConfig, but partial all the way
 * down: an overlay's `fields.price` only needs to specify the keys it's
 * changing (e.g. `{ readonly: false }`), not a complete FieldConfig. Same
 * for `pages` and `postActions`.
 */
export interface FormConfigOverlay {
  id?: string;
  title?: string;
  description?: string;
  mode?: "create" | "edit" | "both";
  list?: { id?: string; siteId?: string };
  layout?: { gridTemplateColumns?: number | string; gap?: string };
  pages?: Record<string, Partial<PageConfig>>;
  fields?: Record<string, Partial<FieldConfig>>;
  postActions?: Record<string, Partial<PostAction>>;
}

/** Flat map of current field values, keyed by field key, used by condition/validation/templating logic. */
export type FieldValues = Record<string, unknown>;
