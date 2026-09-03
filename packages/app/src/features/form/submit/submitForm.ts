import type { FormConfig, FieldValues } from "@skye/form-config";
import { runTriggerPhase, createDefaultHandlerRegistry, type TriggerPhaseResult } from "@skye/form-config";
import type { GraphClient, GraphListItem } from "../../../shared/sharepoint/types.js";
import { EtagConflictError } from "../../../shared/sharepoint/types.js";
import type { RawGraphFetch } from "../../../shared/sharepoint/rawGraphFetch.js";
import { mapValuesToSharePointFields } from "./mapValuesToSharePointFields.js";
import { writeLookupTableRows, type LookupTableRow } from "./lookupTableRows.js";
import { buildActionExecutionContext, type AppCallbacks } from "./buildActionContext.js";
import { uploadFieldFile } from "./fileUpload.js";

export interface SubmitParams {
  config: FormConfig;
  values: FieldValues;
  siteId: string;
  mode: "create" | "edit";
  /** Required when mode is "edit". */
  itemId?: string;
  /** Enables optimistic concurrency on edit — see TODO §9. Omit to overwrite unconditionally (e.g. first-ever save). */
  ifMatchEtag?: string;
  graph: GraphClient;
  graphFetch: RawGraphFetch;
  callbacks: AppCallbacks;
}

export interface SubmitResult {
  success: boolean;
  /** True specifically when the write failed due to an etag mismatch — lets the UI show a distinct "someone else changed this" message instead of a generic failure. */
  conflict?: boolean;
  /** Per-field-key error messages for any file upload that failed — the submission still proceeds without that file rather than aborting entirely. */
  fileUploadErrors?: Record<string, string>;
  item?: { id: string; fields: Record<string, unknown> };
  beforeSubmit: TriggerPhaseResult;
  afterSubmit?: TriggerPhaseResult;
  onSuccess?: TriggerPhaseResult;
  onError?: TriggerPhaseResult;
}

/**
 * Orchestrates a full form submission. Sequencing follows the README's
 * resolution of the parentReference-on-new-items gap: beforeSubmit actions
 * run first (can still block the submission on failure — see below), then
 * the primary item is written, THEN lookupTable rows are written (they
 * need the primary item's id, which only exists after that write), then
 * afterSubmit actions, then onSuccess/onError.
 *
 * Failure handling (a deliberate choice, not left implicit — see TODO §9):
 * - A `beforeSubmit` failure aborts BEFORE writing anything to SharePoint,
 *   runs `onError`, and returns success: false. beforeSubmit is treated as
 *   potentially validation-critical, so failing closed here is safer than
 *   writing data a beforeSubmit check was meant to gate.
 * - Once the primary item is successfully written, that write is never
 *   rolled back on a later failure (no compensating delete) — an
 *   `afterSubmit` failure still runs `onError`, but success reflects the
 *   primary item having been saved. This matches "the item exists, some
 *   follow-up automation didn't" being a materially different, more
 *   recoverable situation than "nothing happened."
 */
export async function submitForm(params: SubmitParams): Promise<SubmitResult> {
  const { config, values, siteId, mode, itemId, ifMatchEtag, graph, graphFetch, callbacks } = params;
  const postActions = config.postActions ?? {};
  const handlerRegistry = createDefaultHandlerRegistry();

  const runPhase = (trigger: Parameters<typeof runTriggerPhase>[1], resultsSoFar: Record<string, unknown>, item: Record<string, unknown>) =>
    runTriggerPhase(postActions, trigger, values, handlerRegistry, (accumulating) =>
      buildActionExecutionContext({ fields: values, item, results: { ...resultsSoFar, ...accumulating } }, graphFetch, callbacks)
    );

  // --- beforeSubmit ---
  const beforeSubmit = await runPhase("beforeSubmit", {}, {});
  if (Object.keys(beforeSubmit.errors).length > 0) {
    const onError = await runPhase("onError", beforeSubmit.results, {});
    return { success: false, beforeSubmit, onError };
  }

  // --- file uploads (before the primary write, so an uploaded reference can land in that same write's fields) ---
  // Only "library" storage is implemented — see fileUpload.ts's docstring for why "attachment" isn't. A failed
  // upload doesn't abort the submission; it's recorded in fileUploadErrors and that field is simply left unset.
  const fileUploadErrors: Record<string, string> = {};
  for (const [fieldKey, field] of Object.entries(config.fields)) {
    if (field.controlType !== "file") continue;
    const selected = values[fieldKey];
    if (!(selected instanceof File)) continue; // no new file chosen this submission
    try {
      const uploaded = await uploadFieldFile(graph, siteId, field, selected);
      values[fieldKey] = uploaded.webUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`submitForm: file upload failed for field "${fieldKey}".`, err);
      fileUploadErrors[fieldKey] = message;
      delete values[fieldKey]; // don't let a raw File object reach mapValuesToSharePointFields
    }
  }

  // --- primary item write ---
  const sharepointFields = mapValuesToSharePointFields(config.fields, values);
  let item: GraphListItem;
  try {
    item =
      mode === "edit" && itemId
        ? await graph.updateListItem(siteId, config.list.id, itemId, sharepointFields, ifMatchEtag)
        : await graph.createListItem(siteId, config.list.id, sharepointFields);
  } catch (err) {
    const isConflict = err instanceof EtagConflictError;
    console.error(isConflict ? "submitForm: etag conflict on primary item write." : "submitForm: primary item write failed.", err);
    const onError = await runPhase("onError", beforeSubmit.results, {});
    return { success: false, conflict: isConflict, beforeSubmit, onError };
  }

  const itemForTemplates = { id: item.id, ...item.fields };

  // --- lookupTable row writes (parentReference mode only; needs item.id, hence after the write above) ---
  for (const [fieldKey, field] of Object.entries(config.fields)) {
    if (field.controlType !== "lookupTable" || !field.table) continue;
    const rows = (values[fieldKey] as LookupTableRow[] | undefined) ?? [];
    try {
      await writeLookupTableRows(graph, siteId, field.table, item.id, rows);
    } catch (err) {
      // A row-write failure doesn't unwind the primary item write (see docstring); surfaced loudly, submission continues.
      console.error(`submitForm: lookupTable row write failed for field "${fieldKey}".`, err);
    }
  }

  // --- afterSubmit ---
  const afterSubmit = await runPhase("afterSubmit", beforeSubmit.results, itemForTemplates);
  const uploadErrorsIfAny = Object.keys(fileUploadErrors).length > 0 ? fileUploadErrors : undefined;
  if (Object.keys(afterSubmit.errors).length > 0) {
    const onError = await runPhase("onError", { ...beforeSubmit.results, ...afterSubmit.results }, itemForTemplates);
    return { success: true, item: { id: item.id, fields: item.fields }, fileUploadErrors: uploadErrorsIfAny, beforeSubmit, afterSubmit, onError };
  }

  // --- onSuccess ---
  const onSuccess = await runPhase("onSuccess", { ...beforeSubmit.results, ...afterSubmit.results }, itemForTemplates);

  return { success: true, item: { id: item.id, fields: item.fields }, fileUploadErrors: uploadErrorsIfAny, beforeSubmit, afterSubmit, onSuccess };
}
