import type { ActionExecutionContext } from "./registry.js";
import type { PostAction } from "../../schema/types.js";
import { interpolate } from "../templating.js";

/** Writes a (possibly templated) value into the live form state — e.g. deriving one field from another action's result. */
export async function setFieldHandler(action: PostAction, ctx: ActionExecutionContext): Promise<unknown> {
  if (!action.field) throw new Error("setField postAction is missing `field`.");
  const value = typeof action.value === "string" ? interpolate(action.value, ctx.templateContext) : action.value;
  ctx.setFieldValue(action.field, value);
  return value;
}
