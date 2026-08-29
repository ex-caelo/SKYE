import type { ActionExecutionContext } from "./registry.js";
import type { PostAction } from "../../schema/types.js";
import { interpolate } from "../templating.js";

/** Navigates the app to a templated destination — usually the onSuccess confirmation redirect. */
export async function redirectHandler(action: PostAction, ctx: ActionExecutionContext): Promise<unknown> {
  if (!action.to) throw new Error("redirect postAction is missing `to`.");
  const to = interpolate(action.to, ctx.templateContext) as string;
  ctx.navigate(to);
  return undefined;
}
