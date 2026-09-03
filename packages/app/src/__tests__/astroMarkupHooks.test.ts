import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard. Page state markup now lives in `.astro` files and the entry
 * scripts / lib helpers query it by id / data-slot / data-el / data-tpl.
 * These files can't be imported into vitest (Astro's build pipeline breaks
 * under jsdom here), so instead assert — against the raw source — that
 * every hook the TypeScript relies on is present. A rename on one side
 * without the other fails here.
 */
const SRC_DIR = join(import.meta.dirname, "..");
function src(rel: string): string {
  return readFileSync(join(SRC_DIR, rel), "utf8");
}

const EXPECTED: Record<string, string[]> = {
  "components/ConfirmDialog.astro": [
    'id="skye-confirm-dialog"',
    'data-slot="confirm-title"',
    'data-slot="confirm-body"',
    'data-slot="confirm-actions"',
    'id="skye-confirm-action-tpl"',
  ],
  "components/MessagePanel.astro": ['id="skye-message-panel"', "data-state", 'data-slot="message-title"', 'data-slot="message-body"'],
  "components/SitePicker.astro": ['id="step-site-picker"', "data-state", 'data-slot="list"', 'data-slot="empty"', 'data-slot="intro"', 'data-tpl="row"'],
  "components/FormPicker.astro": ['id="step-form-picker"', "data-state", 'data-slot="list"', 'data-tpl="row"'],
  "components/FormOrViewPicker.astro": [
    'id="step-form-or-view-picker"',
    'data-slot="list"',
    'data-tpl="row"',
    "skye-picker-label",
    "skye-picker-kind",
    'data-el="create"',
  ],
  "components/AddSitePanel.astro": ["skye-add-site", 'data-el="form"', 'data-el="input"', 'data-el="submit"', 'data-el="status"', 'type="url"'],
  "components/PermissionsStep.astro": [
    'id="step-permissions"',
    'data-slot="site-name"',
    'data-slot="library-name"',
    'data-el="manage-link"',
    'data-el="done"',
    'target="_blank"',
    'rel="noopener noreferrer"',
  ],
  "components/CreateSiteAssetsStep.astro": [
    'id="step-create-assets"',
    'data-slot="site-name"',
    'data-el="create-link"',
    'data-el="retry"',
    'data-el="cancel"',
    'data-el="status"',
  ],
  "pages/index.astro": ['id="state-landing"', 'id="state-auth-error"', 'data-slot="error"', 'data-slot="description"'],
  "pages/view.astro": ['id="screen-view"', 'data-slot="view-mount"', 'id="state-not-configured"', 'data-slot="title"', 'data-slot="body"', 'id="state-error"'],
  "pages/form.astro": [
    'id="screen-form"',
    'data-slot="draft-banner"',
    'data-el="edit-link"',
    'data-slot="form-mount"',
    'data-el="status"',
    'id="state-error"',
    "ConfirmDialog",
  ],
  "pages/switcher.astro": [
    'id="state-config-missing"',
    'id="state-not-set-up"',
    'id="state-error"',
    "SitePicker",
    "AddSitePanel",
    "FormOrViewPicker",
    "PermissionsStep",
    "CreateSiteAssetsStep",
    "ConfirmDialog",
  ],
  "pages/builder.astro": [
    'id="screen-builder"',
    'data-slot="form-id"',
    'data-el="view-select"',
    'data-el="add-view-input"',
    'data-el="add-view-btn"',
    'data-el="add-draft-input"',
    'data-el="add-draft-btn"',
    'data-el="copy-link-btn"',
    'data-el="publish-btn"',
    'data-el="save-btn"',
    'data-el="status"',
    'data-slot="errors"',
    'data-tpl="error-row"',
    'data-tpl="add-field"',
    'data-el="source"',
    'data-el="bind-row"',
    'data-el="bindTo"',
    'data-slot="preview"',
    'data-slot="editor"',
    'data-el="new-form-form"',
    'data-el="new-form-id"',
    'data-el="new-form-list"',
    'data-el="new-form-manual-id"',
    'data-el="new-form-site-id"',
    'data-el="new-form-error"',
    'id="state-config-missing"',
    'id="state-error"',
  ],
};

describe("astro markup hooks", () => {
  for (const [file, needles] of Object.entries(EXPECTED)) {
    it(`${file} contains every hook the TS queries`, () => {
      const content = src(file);
      for (const needle of needles) expect(content, `${file} is missing ${needle}`).toContain(needle);
    });
  }
});
