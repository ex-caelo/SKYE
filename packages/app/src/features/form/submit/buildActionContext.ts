import type { ActionExecutionContext, TemplateContext } from "@skye/form-config";
import type { RawGraphFetch } from "../../../shared/sharepoint/rawGraphFetch.js";

export interface AppCallbacks {
  navigate: (to: string) => void;
  showMessage: (message: string, level: "info" | "success" | "warning" | "error") => void;
  setFieldValue: (field: string, value: unknown) => void;
  /** See TODO §2/root CLAUDE.md — real script actions are hardcoded here in the app, never fetched from SharePoint. Empty by default; pass real ones in as this app grows. */
  scriptActions?: ActionExecutionContext["scriptActions"];
}

/**
 * Adapts the app's real capabilities (fetch, Graph, navigation, DOM
 * callbacks) into the ActionExecutionContext shape @skye/form-config's
 * actionRunner expects. Kept as a small factory so submitForm.ts can build
 * a fresh context per trigger phase with that phase's accumulated
 * `results` threaded through.
 */
export function buildActionExecutionContext(
  templateContext: TemplateContext,
  graphFetch: RawGraphFetch,
  callbacks: AppCallbacks
): ActionExecutionContext {
  return {
    templateContext,
    httpFetch: (url, init) => fetch(url, init),
    graphFetch,
    navigate: callbacks.navigate,
    showMessage: callbacks.showMessage,
    setFieldValue: callbacks.setFieldValue,
    scriptActions: callbacks.scriptActions ?? {},
  };
}
