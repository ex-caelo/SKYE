import type { ScriptAction } from "@skye/form-config";
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

  // De-duplicate (case-insensitive — email/UPN identifiers aren't case-sensitive) before anything
  // else. A real, live 400: Graph flatly rejects "Duplicate chat members is specified in the
  // request body," and a config combining several people-picker fields into one memberUserIds
  // list (e.g. host + cohosts + a reviewer told to "pick yourself") can easily overlap — the same
  // person picked for two different roles isn't a config-authoring mistake to avoid, it's an
  // expected, legitimate case this action needs to handle, not reject.
  const seen = new Set<string>();
  const memberUserIds = options.memberUserIds.filter((id) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // A Graph user is only ever addressable by UPN/email or a real Entra object id (a GUID) — never
  // a bare SharePoint-internal number. A real, live bug this guards against: `{{fields.x}}` for a
  // peoplePicker field falls back to that field's own SharePoint personOrGroup column's numeric
  // `LookupId` whenever its cached Email is blank (a documented, common SharePoint quirk — see
  // personIdentifier.ts's own comment) — that LookupId is exactly the value a SharePoint
  // `<col>LookupId` WRITE expects, but it's a completely different id space from a Microsoft Graph
  // user id and means nothing to Graph's `/users/{id}` lookup. Sent anyway, Graph's own rejection
  // is maximally unhelpful: a 403 "OperationFailed... One or more members cannot be added to the
  // thread roster," naming no specific id. Catching it here instead names exactly which
  // identifier is the problem and what to do about it — bind memberUserIds to a field that's
  // GUARANTEED to carry a real email/UPN (e.g. a manually-entered email field, the same fix the
  // Luddy LLC admin config already uses for Engage's submittedById) rather than a people-picker
  // field whose underlying column's Email might be blank.
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const implausible = memberUserIds.filter((id) => !id.includes("@") && !GUID_RE.test(id));
  if (implausible.length > 0) {
    throw new Error(
      `teams.createChat: "${implausible.join('", "')}" doesn't look like a Microsoft Graph user id/UPN (expected an email/UPN or a GUID). ` +
        `This usually means a peoplePicker field's underlying SharePoint column had a blank cached Email and fell back to its own ` +
        `SharePoint-internal LookupId, which Graph can't resolve as a user. Bind memberUserIds to a field guaranteed to carry a real ` +
        `email/UPN instead (e.g. a manually-entered email field) rather than the raw people-picker field.`
    );
  }

  const chatType = options.chatType ?? (memberUserIds.length === 2 ? "oneOnOne" : "group");
  if (chatType === "oneOnOne" && options.topic) {
    throw new Error("teams.createChat: a oneOnOne chat can't have a topic (Graph only allows topics on group chats).");
  }

  const res = await graphJson(ctx, "/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatType,
      ...(chatType === "group" && options.topic ? { topic: options.topic } : {}),
      members: memberUserIds.map((userId) => ({
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        roles: ["owner"],
        "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${userId}')`,
      })),
    }),
  });

  return { chatId: res.id, webUrl: res.webUrl };
};
