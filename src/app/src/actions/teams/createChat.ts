import type { ScriptAction } from "@skye/config";
import { graphJson } from "../graphJson.js";

export interface CreateChatOptions {
  /**
   * Graph user ids or UPNs for every desired chat member, INCLUDING the
   * signed-in user if they should be part of the chat — Graph's
   * chat-creation API doesn't add the caller automatically.
   */
  memberUserIds: string[];
  /** Group chats only — Graph rejects a topic on a oneOnOne chat. */
  topic?: string;
  /** Defaults to "oneOnOne" for exactly 2 members, "group" otherwise. */
  chatType?: "oneOnOne" | "group";
}

/**
 * Creates a Teams chat or group chat (POST /chats) — the first half of
 * "create a chat and send a message". Chain into teams.sendMessage via
 * `dependsOn` + `{{results.<thisActionKey>.chatId}}` to send a message
 * right after creating the chat, or reuse the returned chatId to send more
 * messages later. Registered as "teams.createChat" — see ../registry.ts.
 */
export const createChat: ScriptAction = async (args, ctx) => {
  const options = args[0] as CreateChatOptions | undefined;
  if (!options?.memberUserIds?.length) {
    throw new Error(
      'teams.createChat requires "memberUserIds" (at least one Graph user id/UPN — include the signed-in user if they should be a member).'
    );
  }

  const chatType = options.chatType ?? (options.memberUserIds.length === 2 ? "oneOnOne" : "group");
  if (chatType === "oneOnOne" && options.topic) {
    throw new Error("teams.createChat: a oneOnOne chat can't have a topic (Graph only allows topics on group chats).");
  }

  const res = await graphJson(ctx, "/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatType,
      ...(chatType === "group" && options.topic ? { topic: options.topic } : {}),
      members: options.memberUserIds.map((userId) => ({
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        roles: ["owner"],
        "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${userId}')`,
      })),
    }),
  });

  return { chatId: res.id, webUrl: res.webUrl };
};
