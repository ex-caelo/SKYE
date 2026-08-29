import type { PostAction } from "../../schema/types.js";
import type { TemplateContext } from "../templating.js";

/**
 * Everything a handler needs to execute one postAction. `graphFetch` and
 * `httpFetch` are injected by the app, not imported here — skye-config
 * stays framework/runtime agnostic and testable without a live tenant or a
 * real network call (tests can pass a stub).
 */
export interface ActionExecutionContext {
  templateContext: TemplateContext;
  /** Performs a plain HTTP request (used by the httpRequest handler). */
  httpFetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Performs an authenticated Microsoft Graph request (used by the graphRequest handler, and by app-registered script actions that call Graph — e.g. Teams/Outlook). */
  graphFetch: (path: string, init: RequestInit) => Promise<Response>;
  /** Navigates the app to a new location (used by the redirect handler). */
  navigate: (to: string) => void;
  /** Surfaces a message in the submission-progress UI (used by the showMessage handler). */
  showMessage: (message: string, level: "info" | "success" | "warning" | "error") => void;
  /** Writes a value into the live form state (used by the setField handler). */
  setFieldValue: (field: string, value: unknown) => void;
  /**
   * Hardcoded, app-provided script actions keyed by name — see the security
   * decision in README/TODO: this is never populated from anything fetched
   * from SharePoint, only from the app's own reviewed source.
   */
  scriptActions: Record<string, ScriptAction>;
}

/**
 * The signature every app-registered `script` postAction function must
 * match — a "plugin" in `packages/app/src/actions/`. `args[0]` is
 * conventionally a single options object (not positional args), since a
 * form author is writing named JSON properties, not a function call.
 */
export type ScriptAction = (args: unknown[], ctx: ActionExecutionContext) => Promise<unknown>;

/** A handler executes one postAction and returns whatever becomes available at {{results.<key>...}}. */
export type ActionHandler = (action: PostAction, ctx: ActionExecutionContext) => Promise<unknown>;

/**
 * The extension point: adding a new postAction `type` later is just adding
 * one function here (or in the app's own registry — see
 * createDefaultHandlerRegistry in index.ts for how the two combine) and
 * registering it, without touching actionRunner at all.
 */
export type ActionHandlerRegistry = Record<string, ActionHandler>;
