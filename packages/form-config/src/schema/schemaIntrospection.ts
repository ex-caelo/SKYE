import formConfigSchema from "./form.config.schema.json" with { type: "json" };

/**
 * A minimal JSON Schema navigation layer over form.config.schema.json,
 * purpose-built for one job: letting `/builder` (packages/app) generate its
 * field/page/postAction property editors DIRECTLY from this schema, so the
 * builder's UI can never drift out of sync with what the schema actually
 * allows — add a property to the schema and the builder grows a control for
 * it automatically, with no separate "builder knows about FieldConfig"
 * hardcoded list to keep in sync by hand.
 *
 * Deliberately NOT a general-purpose JSON Schema library: no `anyOf`
 * resolution, no format/const-outside-enum validation, no draft
 * feature-completeness. It only understands the specific shapes this one
 * schema actually uses (`$ref` to a `#/$defs/<name>` entry, `enum`,
 * `type`, `properties`/`required`, `items`, `additionalProperties`, a flat
 * two-branch `oneOf` for track-sizing-like values, and postAction's
 * `allOf`/`if`/`then` per-`type` payload shape). Real validation of a
 * finished config still goes through ajv against the real schema (see
 * validation/validateConfig.ts) — this module is read-only navigation for
 * building a UI, not a validator.
 */

export type JsonSchemaNode = Record<string, unknown>;

const schema = formConfigSchema as { $defs: Record<string, JsonSchemaNode> } & JsonSchemaNode;

/** Resolves a "#/$defs/<name>" pointer to its schema node. This schema never $refs anywhere else, so that's the only shape supported. */
export function resolveSchemaRef(ref: string): JsonSchemaNode {
  const match = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!match) throw new Error(`schemaIntrospection: unsupported $ref "${ref}" (only "#/$defs/<name>" refs are supported).`);
  const node = schema.$defs[match[1]];
  if (!node) throw new Error(`schemaIntrospection: no $defs entry named "${match[1]}".`);
  return node;
}

/** Resolves a node's own $ref if it has one (this schema never nests a $ref directly inside another $ref target's own $ref, so one hop is always enough), otherwise returns the node unchanged. */
export function resolveNode(node: JsonSchemaNode): JsonSchemaNode {
  return typeof node.$ref === "string" ? resolveSchemaRef(node.$ref) : node;
}

export interface SchemaProperty {
  key: string;
  /** Not yet $ref-resolved — resolution happens lazily, only when a caller actually needs the nested shape (classifySchemaProperty or a recursive getObjectProperties call). */
  schema: JsonSchemaNode;
  required: boolean;
}

/** Ordered list of an object schema node's own `properties`, each flagged `required` per that same node's `required` array. Resolves a bare $ref first. */
export function getObjectProperties(node: JsonSchemaNode): SchemaProperty[] {
  const resolved = resolveNode(node);
  const props = (resolved.properties as Record<string, JsonSchemaNode> | undefined) ?? {};
  const required = new Set((resolved.required as string[] | undefined) ?? []);
  return Object.keys(props).map((key) => ({ key, schema: props[key], required: required.has(key) }));
}

/**
 * postAction is the one def in this schema where real, meaningful properties
 * (`request`, `to`, `message`, `level`, `field`, `value`, `functionName`,
 * `args`) live ONLY inside an `allOf[].then.properties` branch gated on
 * `type`, not in the def's own top-level `properties` — a plain
 * getObjectProperties() call would miss all of them for a postAction. This
 * walks `allOf`, finds the branch(es) whose `if` checks
 * `properties[discriminatorKey]` against `discriminatorValue` (via `const`
 * or `enum` membership), and merges in that branch's `then` properties.
 * Generic over which key/value it discriminates on, but in practice this
 * schema only needs it for postAction's `type`.
 */
export function getConditionalProperties(node: JsonSchemaNode, discriminatorKey: string, discriminatorValue: string): SchemaProperty[] {
  const resolved = resolveNode(node);
  const base = getObjectProperties(resolved);
  const allOf = (resolved.allOf as JsonSchemaNode[] | undefined) ?? [];
  const extra: SchemaProperty[] = [];

  for (const branch of allOf) {
    const ifNode = branch.if as JsonSchemaNode | undefined;
    const discriminatorSchema = (ifNode?.properties as Record<string, JsonSchemaNode> | undefined)?.[discriminatorKey];
    if (!discriminatorSchema) continue;
    const matches = discriminatorSchema.const === discriminatorValue || (Array.isArray(discriminatorSchema.enum) && (discriminatorSchema.enum as unknown[]).includes(discriminatorValue));
    if (!matches) continue;
    const thenNode = branch.then as JsonSchemaNode | undefined;
    if (thenNode?.properties) extra.push(...getObjectProperties(thenNode));
  }

  // A later branch's property of the same key (shouldn't happen in practice, since only one
  // `type` branch ever matches) would otherwise duplicate — de-dupe by key, keeping the first.
  const seen = new Set(base.map((p) => p.key));
  return [...base, ...extra.filter((p) => !seen.has(p.key) && (seen.add(p.key), true))];
}

export type SchemaPropertyKind =
  | { kind: "enum"; values: unknown[] }
  | { kind: "boolean" }
  | { kind: "string" }
  | { kind: "integer" }
  | { kind: "number" }
  | { kind: "stringArray" }
  | { kind: "objectArray"; itemProperties: SchemaProperty[] }
  | { kind: "object"; properties: SchemaProperty[]; hasPatternProperties: boolean }
  | { kind: "dictionary"; valueKind: "string" | "object" | "any"; valueProperties?: SchemaProperty[] }
  | { kind: "oneOfPrimitive"; types: string[] }
  /** visibleIf/when's `condition` def is genuinely self-recursive (all/any/not of more conditions) — the one shape this module deliberately does not expand into a structured editor. The builder renders these as raw JSON text instead of a visual tree builder. */
  | { kind: "condition" }
  /** Untyped (bare `{}`) — e.g. defaultValue, options[].value, postAction.value/body. The builder renders these as a single best-effort text input. */
  | { kind: "unknown" };

/**
 * Classifies one (possibly still-$ref'd) schema node into a shape the
 * builder's DOM renderer (packages/app/src/lib/builder/schemaControls.ts)
 * knows how to draw a control for. `condition` is the only intentional
 * fallback for something this schema can genuinely express but this module
 * won't expand recursively — everything else resolves to a real structured
 * control, including the schema's other $ref'd objects (htmlAttributes,
 * cssStyle, fileStorage, relatedList, calculatedExpression, lookupTable),
 * which get resolved and treated as plain nested objects.
 */
export function classifySchemaProperty(node: JsonSchemaNode): SchemaPropertyKind {
  if (typeof node.$ref === "string") {
    if (node.$ref === "#/$defs/condition") return { kind: "condition" };
    return classifySchemaProperty(resolveSchemaRef(node.$ref));
  }

  if (Array.isArray(node.enum)) return { kind: "enum", values: node.enum };

  const type = node.type as string | string[] | undefined;
  const primary = Array.isArray(type) ? type.find((t) => t !== "null") : type;

  if (primary === "boolean") return { kind: "boolean" };
  if (primary === "integer") return { kind: "integer" };
  if (primary === "number") return { kind: "number" };
  if (primary === "string") return { kind: "string" };

  if (primary === "array") {
    const items = node.items as JsonSchemaNode | undefined;
    if (!items) return { kind: "unknown" };
    const resolvedItems = resolveNode(items);
    if (resolvedItems.type === "string") return { kind: "stringArray" };
    if (resolvedItems.properties) return { kind: "objectArray", itemProperties: getObjectProperties(resolvedItems) };
    return { kind: "unknown" };
  }

  if (primary === "object") {
    if (node.properties) {
      return { kind: "object", properties: getObjectProperties(node), hasPatternProperties: Boolean(node.patternProperties) };
    }
    const additional = node.additionalProperties as JsonSchemaNode | boolean | undefined;
    if (additional && typeof additional === "object") {
      const resolvedAdditional = resolveNode(additional);
      if (resolvedAdditional.type === "string") return { kind: "dictionary", valueKind: "string" };
      if (resolvedAdditional.properties || additional.$ref) {
        return { kind: "dictionary", valueKind: "object", valueProperties: getObjectProperties(resolvedAdditional) };
      }
      return { kind: "dictionary", valueKind: "any" };
    }
    return { kind: "unknown" };
  }

  // trackSizing-shaped: `oneOf: [{type: "integer", ...}, {type: "string"}]`, no $ref branches.
  // Rendered as one text input; the DOM layer coerces a clean integer string to a number on save.
  const oneOf = node.oneOf as JsonSchemaNode[] | undefined;
  if (oneOf && oneOf.every((branch) => typeof branch.type === "string" && !branch.$ref)) {
    return { kind: "oneOfPrimitive", types: oneOf.map((branch) => branch.type as string) };
  }

  return { kind: "unknown" };
}

/** The `field` def's own properties — FieldConfig's full editable surface, straight from the schema. */
export function getFieldSchemaProperties(): SchemaProperty[] {
  return getObjectProperties(resolveSchemaRef("#/$defs/field"));
}

/** The `page` def's own properties — PageConfig's full editable surface. */
export function getPageSchemaProperties(): SchemaProperty[] {
  return getObjectProperties(resolveSchemaRef("#/$defs/page"));
}

/** postAction's base properties plus whichever `type`-specific payload properties apply for `postActionType` (see getConditionalProperties). */
export function getPostActionSchemaProperties(postActionType: string): SchemaProperty[] {
  return getConditionalProperties(resolveSchemaRef("#/$defs/postAction"), "type", postActionType);
}

/**
 * The base FormConfig root's own properties, minus `pages`/`fields`/
 * `postActions` — the builder edits those three as dedicated dictionary
 * sections rather than through the generic top-level "form settings" panel.
 */
export function getFormTopLevelProperties(): SchemaProperty[] {
  return getObjectProperties(schema).filter((p) => !["pages", "fields", "postActions"].includes(p.key));
}
