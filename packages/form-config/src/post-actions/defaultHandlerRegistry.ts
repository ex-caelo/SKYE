import type { ActionHandlerRegistry } from "./handlers/registry.js";
import { httpRequestHandler } from "./handlers/httpRequest.js";
import { graphRequestHandler } from "./handlers/graphRequest.js";
import { redirectHandler } from "./handlers/redirect.js";
import { showMessageHandler } from "./handlers/showMessage.js";
import { setFieldHandler } from "./handlers/setField.js";
import { scriptHandler } from "./handlers/script.js";

/**
 * The built-in handler for every postAction `type` the schema currently
 * defines. Adding a brand-new `type` later means writing one handler file
 * and adding one line here (or passing an extra entry into actionRunner's
 * registry param without touching this file at all).
 */
export function createDefaultHandlerRegistry(): ActionHandlerRegistry {
  return {
    httpRequest: httpRequestHandler,
    graphRequest: graphRequestHandler,
    redirect: redirectHandler,
    showMessage: showMessageHandler,
    setField: setFieldHandler,
    script: scriptHandler,
  };
}
