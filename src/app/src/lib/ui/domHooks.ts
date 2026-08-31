/**
 * IDs and hook attributes shared between an `.astro` skeleton and the
 * TypeScript that queries it. Centralised so a rename is a single edit and
 * TypeScript (not a runtime "querySelector returned null") flags a
 * mismatch. Page-local hooks that only one entry script touches are kept
 * as plain literals in that script + its page; these are the ones crossing
 * the file boundary.
 */

/** The shared modal confirm dialog — one `<dialog>` per page, see components/ConfirmDialog.astro. */
export const CONFIRM_DIALOG = {
  /** `<dialog id="…">` */
  id: "skye-confirm-dialog",
  slotTitle: "confirm-title",
  slotBody: "confirm-body",
  slotActions: "confirm-actions",
  /** `<template id="…">` holding the single `<button>` cloned per option. */
  actionTemplateId: "skye-confirm-action-tpl",
} as const;

/** The shared message panel — a full-page "here's a state, not content" screen, see components/MessagePanel.astro. */
export const MESSAGE_PANEL = {
  id: "skye-message-panel",
  slotTitle: "message-title",
  slotBody: "message-body",
} as const;
