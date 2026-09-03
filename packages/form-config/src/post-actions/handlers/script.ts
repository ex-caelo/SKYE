import type { ActionExecutionContext } from "./registry.js";
import type { PostAction } from "../../schema/types.js";
import { interpolate } from "../templating.js";

/**
 * Looks up `action.functionName` in the app-supplied `scriptActions`
 * registry (see registry.ts's ActionExecutionContext) and calls it. This is
 * the ONLY way a `script` postAction runs code — there is no fetch, import,
 * or eval of anything from SharePoint. A config referencing a name that
 * isn't registered is a loud, immediate config error, not a silent no-op or
 * a fallback fetch.
 */
export async function scriptHandler(action: PostAction, ctx: ActionExecutionContext): Promise<unknown> {
  if (!action.functionName) throw new Error("script postAction is missing `functionName`.");

  const fn = ctx.scriptActions[action.functionName];
  if (!fn) {
    throw new Error(
      `script postAction references "${action.functionName}", which is not registered in this app's scriptActions. ` +
        `Register it in the app's hardcoded script-action registry — SKYE never loads executable code from SharePoint.`
    );
  }

  // Interpolated exactly like every other handler's templated fields (request.body, message, ...)
  // — without this, a script action could never reference {{fields.x}}/{{results.x}}, which would
  // rule out chaining one script action's result into another via dependsOn (see e.g. teams.createChat
  // -> teams.sendMessage in packages/app/src/actions).
  const args = interpolate(action.args ?? [], ctx.templateContext) as unknown[];
  return fn(args, ctx);
}
