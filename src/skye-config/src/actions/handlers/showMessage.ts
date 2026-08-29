import type { ActionExecutionContext } from "./registry.js";
import type { PostAction } from "../../schema/types.js";
import { interpolate } from "../templating.js";

/** Surfaces a templated message in the submission-progress UI at a given severity level. */
export async function showMessageHandler(action: PostAction, ctx: ActionExecutionContext): Promise<unknown> {
  if (!action.message) throw new Error("showMessage postAction is missing `message`.");
  const message = interpolate(action.message, ctx.templateContext) as string;
  ctx.showMessage(message, action.level ?? "info");
  return undefined;
}
