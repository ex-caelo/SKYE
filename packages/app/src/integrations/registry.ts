import type { ScriptAction } from "@skye/form-config";
import { createChat } from "./teams/createChat.js";
import { sendMessage } from "./teams/sendMessage.js";
import { scheduleMeeting } from "./teams/scheduleMeeting.js";
import { createCalendarEvent } from "./outlook/createCalendarEvent.js";
import { sendEmail } from "./outlook/sendEmail.js";
import { buildCalendarEventDeepLink } from "./outlook/buildCalendarEventDeepLink.js";
import { verifyCalendarEventByIcs } from "./outlook/verifyCalendarEventByIcs.js";
import { createEvent as createEngageEvent } from "./engage/createEvent.js";
import { updateEvent as updateEngageEvent } from "./engage/updateEvent.js";
import { cancelEvent as cancelEngageEvent } from "./engage/cancelEvent.js";
import { rsvpToEvent as rsvpToEngageEvent } from "./engage/rsvpToEvent.js";
import { updateRsvp as updateEngageRsvp } from "./engage/updateRsvp.js";
import { recordAttendance as recordEngageAttendance } from "./engage/recordAttendance.js";
import { updateAttendance as updateEngageAttendance } from "./engage/updateAttendance.js";
import { deleteAttendance as deleteEngageAttendance } from "./engage/deleteAttendance.js";

/**
 * The app's full `scriptActions` registry — every "script" postAction a
 * form.config.json can reference via `functionName`, keyed "service.actionName".
 * This is the ONLY place a new action needs registering: write the function
 * in its service's folder (or a new folder for a brand-new service — each
 * file exports one `ScriptAction`, see e.g. teams/createChat.ts), import it
 * here, and add one line below. actionRunner/scriptHandler in @skye/form-config
 * never need to change — see TODO §9 and CLAUDE.md.
 */
export const scriptActions: Record<string, ScriptAction> = {
  "teams.createChat": createChat,
  "teams.sendMessage": sendMessage,
  "teams.scheduleMeeting": scheduleMeeting,
  "outlook.createCalendarEvent": createCalendarEvent,
  "outlook.sendEmail": sendEmail,
  "outlook.buildCalendarEventDeepLink": buildCalendarEventDeepLink,
  "outlook.verifyCalendarEventByIcs": verifyCalendarEventByIcs,
  "engage.createEvent": createEngageEvent,
  "engage.updateEvent": updateEngageEvent,
  "engage.cancelEvent": cancelEngageEvent,
  "engage.rsvpToEvent": rsvpToEngageEvent,
  "engage.updateRsvp": updateEngageRsvp,
  "engage.recordAttendance": recordEngageAttendance,
  "engage.updateAttendance": updateEngageAttendance,
  "engage.deleteAttendance": deleteEngageAttendance,
};
