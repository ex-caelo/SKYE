import { describe, it, expect } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import { renderField } from "../features/form/render/renderField.js";

describe("renderField — file control", () => {
  function fileField(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { page: "p1", source: "virtual", controlType: "file", label: "Poster", ...overrides };
  }

  it("wraps the real <input type=file> in a drag-and-drop zone with a preview slot", () => {
    const { container, control } = renderField("poster", fileField(), document);
    const dropZone = container.querySelector(".skye-file-upload");
    expect(dropZone).not.toBeNull();
    expect(dropZone!.contains(control)).toBe(true);
    expect(control.tagName).toBe("INPUT");
    expect((control as HTMLInputElement).type).toBe("file");
    expect(dropZone!.querySelector(".skye-file-upload__preview")).not.toBeNull();
  });

  it("shows the file's preview once it's picked, via the control's own change event", () => {
    const { container, control } = renderField("poster", fileField(), document);
    const input = control as HTMLInputElement;
    const file = new File(["poster bytes"], "poster.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));

    const preview = container.querySelector<HTMLElement>(".skye-file-upload__preview");
    expect(preview?.hidden).toBe(false);
    expect(preview?.querySelector("img.skye-file-upload__thumb")).not.toBeNull();
    expect(preview?.querySelector(".skye-file-upload__name")?.textContent).toBe("poster.png");
  });

  it("highlights the drop zone on dragenter and clears it on dragleave", () => {
    const { container } = renderField("poster", fileField(), document);
    const dropZone = container.querySelector(".skye-file-upload")!;
    dropZone.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
    expect(dropZone.classList.contains("skye-file-upload--dragover")).toBe(true);
    dropZone.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }));
    expect(dropZone.classList.contains("skye-file-upload--dragover")).toBe(false);
  });

  it("returns filePreviewEl for a file control, so a caller (renderForm.ts) can show an edit-mode value's preview directly", () => {
    const { filePreviewEl } = renderField("poster", fileField(), document);
    expect(filePreviewEl).toBeDefined();
    expect(filePreviewEl?.className).toBe("skye-file-upload__preview");
  });

  it("does not set filePreviewEl for a non-file control", () => {
    const { filePreviewEl } = renderField("title", { page: "p1", source: "sharepoint", bindTo: "Title", controlType: "text" }, document);
    expect(filePreviewEl).toBeUndefined();
  });
});

describe("renderField — select control", () => {
  function selectField(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return {
      page: "p1",
      source: "sharepoint",
      bindTo: "Campus",
      controlType: "select",
      options: [
        { value: "north", label: "North Campus" },
        { value: "south", label: "South Campus" },
      ],
      ...overrides,
    };
  }

  it("prepends a disabled, pre-selected 'Select an option' placeholder so no real option is silently defaulted to", () => {
    const { control } = renderField("campus", selectField(), document);
    const select = control as HTMLSelectElement;
    expect(select.options).toHaveLength(3);
    expect(select.options[0].value).toBe("");
    expect(select.options[0].disabled).toBe(true);
    expect(select.value).toBe("");
    expect(select.selectedIndex).toBe(0);
  });

  it("an explicit defaultValue still wins over the placeholder", () => {
    const { control } = renderField("campus", selectField({ defaultValue: "south" }), document);
    expect((control as HTMLSelectElement).value).toBe("south");
  });

  it("a required select fails native validity while the placeholder is still selected", () => {
    const { control } = renderField("campus", selectField({ required: true }), document);
    const select = control as HTMLSelectElement;
    expect(select.checkValidity()).toBe(false);
    select.value = "north";
    expect(select.checkValidity()).toBe(true);
  });
});

describe("renderField — button control", () => {
  function buttonField(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { page: "p1", source: "virtual", controlType: "button", label: "Send Reminder", actions: {}, ...overrides };
  }

  it("renders a real <button type=button> whose text is the field's label, with its own status output — not the usual label/help/message chrome", () => {
    const { container, control, messageEl } = renderField("sendReminder", buttonField(), document);
    expect(control.tagName).toBe("BUTTON");
    expect((control as HTMLButtonElement).type).toBe("button");
    expect(control.textContent).toBe("Send Reminder");
    expect(control.id).toBe("sendReminder");
    expect(container.querySelector("label")).toBeNull();
    // messageEl is a throwaway, never attached to the DOM for a button (no validation message of its own).
    expect(container.contains(messageEl)).toBe(false);
  });

  it("exposes buttonStatusEl as an <output>, attached to the container", () => {
    const { container, buttonStatusEl } = renderField("sendReminder", buttonField(), document);
    expect(buttonStatusEl).toBeDefined();
    expect(buttonStatusEl!.tagName).toBe("OUTPUT");
    expect(container.contains(buttonStatusEl!)).toBe(true);
  });

  it("shows helpText near the button when present", () => {
    const { container } = renderField("sendReminder", buttonField({ helpText: "Emails the host again." }), document);
    expect(container.querySelector(".skye-field__help")?.textContent).toBe("Emails the host again.");
  });

  it("does not set buttonStatusEl for a non-button control", () => {
    const { buttonStatusEl } = renderField("title", { page: "p1", source: "sharepoint", bindTo: "Title", controlType: "text" }, document);
    expect(buttonStatusEl).toBeUndefined();
  });
});
