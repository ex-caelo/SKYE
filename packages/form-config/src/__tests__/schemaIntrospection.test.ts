import { describe, it, expect } from "vitest";
import {
  resolveSchemaRef,
  getObjectProperties,
  getConditionalProperties,
  classifySchemaProperty,
  getFieldSchemaProperties,
  getPageSchemaProperties,
  getPostActionSchemaProperties,
  getFormTopLevelProperties,
} from "../schema/schemaIntrospection.js";

describe("resolveSchemaRef", () => {
  it("resolves a known #/$defs/<name> pointer", () => {
    const node = resolveSchemaRef("#/$defs/field");
    expect(node.type).toBe("object");
    expect((node.required as string[]).includes("controlType")).toBe(true);
  });

  it("throws for an unsupported ref shape or an unknown $defs name", () => {
    expect(() => resolveSchemaRef("form.config.schema.json#/$defs/field")).toThrow(/unsupported \$ref/);
    expect(() => resolveSchemaRef("#/$defs/doesNotExist")).toThrow(/no \$defs entry/);
  });
});

describe("getObjectProperties", () => {
  it("lists every declared property in schema order, flagging only the ones in the node's own required array", () => {
    const props = getObjectProperties(resolveSchemaRef("#/$defs/page"));
    const byKey = Object.fromEntries(props.map((p) => [p.key, p]));
    expect(byKey.title.required).toBe(true);
    expect(byKey.order.required).toBe(false);
    expect(props.map((p) => p.key)).toEqual(["title", "order", "visibleIf", "layout"]);
  });

  it("resolves a bare $ref node before reading its properties", () => {
    const props = getObjectProperties({ $ref: "#/$defs/page" });
    expect(props.some((p) => p.key === "title")).toBe(true);
  });
});

describe("getConditionalProperties", () => {
  it("merges in a postAction's type-specific payload properties, which live only inside allOf/then, not the top-level properties", () => {
    const base = getObjectProperties(resolveSchemaRef("#/$defs/postAction"));
    expect(base.some((p) => p.key === "request")).toBe(false); // confirms the base def alone really doesn't have it

    const forHttp = getConditionalProperties(resolveSchemaRef("#/$defs/postAction"), "type", "httpRequest");
    expect(forHttp.some((p) => p.key === "trigger")).toBe(true); // base properties still present
    expect(forHttp.some((p) => p.key === "request")).toBe(true); // merged in from the matching allOf branch
    expect(forHttp.some((p) => p.key === "to")).toBe(false); // redirect's own payload key, not httpRequest's

    const forScript = getConditionalProperties(resolveSchemaRef("#/$defs/postAction"), "type", "script");
    expect(forScript.map((p) => p.key)).toContain("functionName");
    expect(forScript.map((p) => p.key)).toContain("args");
  });

  it("returns just the base properties for a discriminator value with no matching allOf branch", () => {
    const forBogus = getConditionalProperties(resolveSchemaRef("#/$defs/postAction"), "type", "notARealType");
    expect(forBogus.every((p) => !["request", "to", "message", "functionName"].includes(p.key))).toBe(true);
  });
});

describe("classifySchemaProperty", () => {
  it("classifies enum, boolean, string, integer, number", () => {
    expect(classifySchemaProperty({ enum: ["a", "b"] })).toEqual({ kind: "enum", values: ["a", "b"] });
    expect(classifySchemaProperty({ type: "boolean" })).toEqual({ kind: "boolean" });
    expect(classifySchemaProperty({ type: "string" })).toEqual({ kind: "string" });
    expect(classifySchemaProperty({ type: "integer" })).toEqual({ kind: "integer" });
    expect(classifySchemaProperty({ type: "number" })).toEqual({ kind: "number" });
  });

  it("classifies a string array (customValidators-shaped) as stringArray", () => {
    expect(classifySchemaProperty({ type: "array", items: { type: "string" } })).toEqual({ kind: "stringArray" });
  });

  it("classifies an object array (options-shaped) as objectArray with its item properties resolved", () => {
    const result = classifySchemaProperty({ type: "array", items: { type: "object", required: ["value"], properties: { value: {}, label: { type: "string" } } } });
    expect(result.kind).toBe("objectArray");
    if (result.kind === "objectArray") {
      expect(result.itemProperties.map((p) => p.key)).toEqual(["value", "label"]);
      expect(result.itemProperties.find((p) => p.key === "value")?.required).toBe(true);
    }
  });

  it("classifies a plain nested object def (calculatedExpression-shaped) as object, resolving a $ref first", () => {
    const result = classifySchemaProperty({ $ref: "#/$defs/calculatedExpression" });
    expect(result.kind).toBe("object");
    if (result.kind === "object") {
      expect(result.properties.map((p) => p.key)).toEqual(["op", "fields", "separator"]);
      expect(result.hasPatternProperties).toBe(false);
    }
  });

  it("classifies htmlAttributes as object and reports it also has patternProperties (data-/aria-)", () => {
    const result = classifySchemaProperty({ $ref: "#/$defs/htmlAttributes" });
    expect(result.kind).toBe("object");
    if (result.kind === "object") expect(result.hasPatternProperties).toBe(true);
  });

  it("classifies a string-valued dictionary (postAction.request.headers-shaped)", () => {
    expect(classifySchemaProperty({ type: "object", additionalProperties: { type: "string" } })).toEqual({ kind: "dictionary", valueKind: "string" });
  });

  it("classifies an object-valued dictionary keyed by a $ref (lookupTable.columns-shaped) with its value properties resolved", () => {
    const result = classifySchemaProperty({ type: "object", additionalProperties: { $ref: "#/$defs/field" } });
    expect(result.kind).toBe("dictionary");
    if (result.kind === "dictionary") {
      expect(result.valueKind).toBe("object");
      expect(result.valueProperties?.some((p) => p.key === "controlType")).toBe(true);
    }
  });

  it("classifies trackSizing's oneOf (integer | string) as oneOfPrimitive", () => {
    const result = classifySchemaProperty({ oneOf: [{ type: "integer", minimum: 1 }, { type: "string" }] });
    expect(result).toEqual({ kind: "oneOfPrimitive", types: ["integer", "string"] });
  });

  it("classifies a $ref to condition specially, without expanding its recursive shape", () => {
    expect(classifySchemaProperty({ $ref: "#/$defs/condition" })).toEqual({ kind: "condition" });
  });

  it("falls back to unknown for an untyped node ({}), e.g. defaultValue/options[].value", () => {
    expect(classifySchemaProperty({})).toEqual({ kind: "unknown" });
  });
});

describe("schema entry points", () => {
  it("getFieldSchemaProperties includes the field def's real properties", () => {
    const keys = getFieldSchemaProperties().map((p) => p.key);
    expect(keys).toContain("controlType");
    expect(keys).toContain("bindTo");
    expect(keys).toContain("visibleIf");
  });

  it("getPageSchemaProperties includes title/order/visibleIf/layout", () => {
    expect(getPageSchemaProperties().map((p) => p.key)).toEqual(["title", "order", "visibleIf", "layout"]);
  });

  it("getPostActionSchemaProperties resolves the right payload shape per type", () => {
    expect(getPostActionSchemaProperties("redirect").map((p) => p.key)).toContain("to");
    expect(getPostActionSchemaProperties("showMessage").map((p) => p.key)).toContain("message");
  });

  it("getFormTopLevelProperties excludes pages/fields/postActions (handled as dedicated dictionary sections instead)", () => {
    const keys = getFormTopLevelProperties().map((p) => p.key);
    expect(keys).toContain("title");
    expect(keys).toContain("list");
    expect(keys).not.toContain("pages");
    expect(keys).not.toContain("fields");
    expect(keys).not.toContain("postActions");
  });
});
