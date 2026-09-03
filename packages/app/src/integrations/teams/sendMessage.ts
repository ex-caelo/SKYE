import type { ScriptAction } from "@skye/form-config";
import { graphJson } from "../graphJson.js";

export interface SendTeamsMessageOptions {
  /** The target chat's id — typically `{{results.<createChatActionKey>.chatId}}` when chaining from teams.createChat, or a known existing chat id. */
  chatId: string;
  /** Plain text/HTML message content. Required unless `adaptiveCard` is given. */
  message?: string;
  /** An Adaptive Card payload (see adaptivecards.io) sent as a rich card attachment instead of plain text. */
  adaptiveCard?: Record<string, unknown>;
}

/**
 * Sends a message — plain text or an Adaptive Card — into an existing
 * Teams chat (POST /chats/{chatId}/messages). Registered as
 * "teams.sendMessage" — see ../registry.ts.
 */
export const sendMessage: ScriptAction = async (args, ctx) => {
  const options = args[0] as SendTeamsMessageOptions | undefined;
  if (!options?.chatId) throw new Error('teams.sendMessage requires "chatId".');
  if (!options.message && !options.adaptiveCard) {
    throw new Error('teams.sendMessage requires either "message" or "adaptiveCard".');
  }

  // An Adaptive Card is sent as an attachment referenced by an <attachment> tag in the message
  // body, rather than as the body content itself — this is Graph/Teams' own convention.
  const body = options.adaptiveCard
    ? {
        body: { contentType: "html", content: `<attachment id="card1"></attachment>` },
        attachments: [{ id: "card1", contentType: "application/vnd.microsoft.card.adaptive", content: JSON.stringify(options.adaptiveCard) }],
      }
    : { body: { contentType: "html", content: options.message } };

  const res = await graphJson(ctx, `/chats/${options.chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return { messageId: res.id };
};
