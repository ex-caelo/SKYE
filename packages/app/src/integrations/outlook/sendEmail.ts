import type { ScriptAction } from "@skye/form-config";
import { graphJson } from "../graphJson.js";

export interface SendEmailOptions {
  /** Graph user id/UPN of the sending mailbox. Defaults to "me" (the signed-in user). */
  userId?: string;
  subject: string;
  bodyContent: string;
  toRecipients: string[];
  ccRecipients?: string[];
  /** Defaults to true, matching Outlook's own default. */
  saveToSentItems?: boolean;
}

/**
 * Sends an email via Outlook (POST /users/{id}/sendMail). Graph returns 202
 * with no body on success, so there's no Graph-assigned id to return here
 * the way the other actions in this directory do.
 * Registered as "outlook.sendEmail" — see ../registry.ts.
 */
export const sendEmail: ScriptAction = async (args, ctx) => {
  const options = args[0] as SendEmailOptions | undefined;
  if (!options?.subject || !options.bodyContent || !options.toRecipients?.length) {
    throw new Error('outlook.sendEmail requires "subject", "bodyContent", and at least one "toRecipients" address.');
  }

  await graphJson(ctx, `/users/${options.userId ?? "me"}/sendMail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: options.subject,
        body: { contentType: "HTML", content: options.bodyContent },
        toRecipients: options.toRecipients.map((address) => ({ emailAddress: { address } })),
        ccRecipients: (options.ccRecipients ?? []).map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: options.saveToSentItems ?? true,
    }),
  });

  return { sent: true };
};
