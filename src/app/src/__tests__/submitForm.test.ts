import { describe, it, expect, vi } from "vitest";
import type { FormConfig } from "@skye/config";
import { MockGraphClient } from "../lib/mock-graph/mockGraphClient.js";
import { submitForm } from "../lib/submit/submitForm.js";

const baseConfig: FormConfig = {
  list: { id: "submit-test-list" },
  pages: { p1: { title: "Page 1" } },
  fields: {
    name: { page: "p1", source: "sharepoint", bindTo: "Title", controlType: "text" },
    agreeToTerms: { page: "p1", source: "virtual", controlType: "checkbox" },
  },
  postActions: {
    notify: {
      trigger: "afterSubmit",
      type: "httpRequest",
      request: { url: "https://hooks.example.com/notify", method: "POST", body: { itemId: "{{item.id}}", name: "{{fields.name}}" } },
    },
    redirectOnSuccess: {
      trigger: "onSuccess",
      type: "redirect",
      to: "/confirmation?item={{item.id}}",
    },
  },
};

function stubCallbacks() {
  return {
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
  };
}

describe("submitForm", () => {
  it("creates the primary item, runs afterSubmit with {{item.id}} interpolated, then onSuccess", async () => {
    const graph = new MockGraphClient();
    const httpFetch = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    // Patch global fetch since buildActionExecutionContext's httpFetch calls the real `fetch` global.
    vi.stubGlobal("fetch", httpFetch);

    const callbacks = stubCallbacks();
    const result = await submitForm({
      config: baseConfig,
      values: { name: "Jane Doe", agreeToTerms: true },
      siteId: "site1",
      mode: "create",
      graph,
      graphFetch: vi.fn(),
      callbacks,
    });

    expect(result.success).toBe(true);
    expect(result.item?.fields).toEqual({ Title: "Jane Doe" }); // virtual field excluded, per mapValuesToSharePointFields
    expect(result.beforeSubmit.errors).toEqual({});
    expect(result.afterSubmit?.outcomes.notify).toBe("ran");

    // Confirm {{item.id}} was actually resolved in the afterSubmit httpRequest body.
    const [, init] = httpFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.itemId).toBe(result.item?.id);
    expect(body.name).toBe("Jane Doe");

    // onSuccess's redirect should have called navigate with {{item.id}} resolved too.
    expect(callbacks.navigate).toHaveBeenCalledWith(`/confirmation?item=${result.item?.id}`);

    vi.unstubAllGlobals();
  });

  it("aborts before writing anything if a beforeSubmit action fails", async () => {
    const graph = new MockGraphClient();
    const createSpy = vi.spyOn(graph, "createListItem");

    const configWithFailingBeforeSubmit: FormConfig = {
      ...baseConfig,
      postActions: {
        validate: { trigger: "beforeSubmit", type: "httpRequest", request: { url: "https://validate.example.com", method: "POST" } },
      },
    };

    vi.stubGlobal("fetch", vi.fn(async () => new Response("fail", { status: 500, statusText: "Internal Server Error" })));

    const result = await submitForm({
      config: configWithFailingBeforeSubmit,
      values: { name: "Jane Doe" },
      siteId: "site1",
      mode: "create",
      graph,
      graphFetch: vi.fn(),
      callbacks: stubCallbacks(),
    });

    expect(result.success).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
    expect(Object.keys(result.beforeSubmit.errors)).toContain("validate");

    vi.unstubAllGlobals();
  });

  it("updates an existing item in edit mode, respecting the provided etag", async () => {
    const graph = new MockGraphClient();
    const created = await graph.createListItem("site1", "submit-test-list", { Title: "Original" });

    const result = await submitForm({
      config: { ...baseConfig, postActions: {} },
      values: { name: "Renamed" },
      siteId: "site1",
      mode: "edit",
      itemId: created.id,
      ifMatchEtag: created.etag,
      graph,
      graphFetch: vi.fn(),
      callbacks: stubCallbacks(),
    });

    expect(result.success).toBe(true);
    expect(result.item?.fields.Title).toBe("Renamed");
  });

  it("uploads a selected file field to the library and writes the resulting webUrl into the primary item", async () => {
    const graph = new MockGraphClient();
    const configWithFile: FormConfig = {
      list: { id: "submit-test-file-list" },
      pages: { p1: { title: "Page 1" } },
      fields: {
        report: {
          page: "p1",
          source: "sharepoint",
          bindTo: "ReportUrl",
          controlType: "file",
          fileStorage: { target: "library", library: { driveId: "drive-1" } },
        },
      },
    };
    const file = new File(["contents"], "report.pdf", { type: "application/pdf" });

    const result = await submitForm({
      config: configWithFile,
      values: { report: file },
      siteId: "site1",
      mode: "create",
      graph,
      graphFetch: vi.fn(),
      callbacks: stubCallbacks(),
    });

    expect(result.success).toBe(true);
    expect(result.fileUploadErrors).toBeUndefined();
    expect(String(result.item?.fields.ReportUrl)).toContain("report.pdf");
  });

  it("reports fileUploadErrors without aborting the submission when attachment-mode (unimplemented) is used", async () => {
    const graph = new MockGraphClient();
    const configWithFile: FormConfig = {
      list: { id: "submit-test-file-list-2" },
      pages: { p1: { title: "Page 1" } },
      fields: {
        report: { page: "p1", source: "sharepoint", bindTo: "ReportUrl", controlType: "file" }, // defaults to "attachment"
      },
    };
    const file = new File(["contents"], "report.pdf", { type: "application/pdf" });

    const result = await submitForm({
      config: configWithFile,
      values: { report: file },
      siteId: "site1",
      mode: "create",
      graph,
      graphFetch: vi.fn(),
      callbacks: stubCallbacks(),
    });

    expect(result.success).toBe(true); // the submission still goes through
    expect(result.fileUploadErrors?.report).toMatch(/isn't implemented/);
    expect(result.item?.fields).not.toHaveProperty("ReportUrl"); // the failed field was left unset, not sent as a raw File
  });

  it("reports conflict: true (not a generic failure) when the write hits an etag mismatch", async () => {
    const graph = new MockGraphClient();
    const created = await graph.createListItem("site1", "submit-test-list", { Title: "Original" });

    const result = await submitForm({
      config: { ...baseConfig, postActions: {} },
      values: { name: "Renamed" },
      siteId: "site1",
      mode: "edit",
      itemId: created.id,
      ifMatchEtag: '"stale-etag-value"',
      graph,
      graphFetch: vi.fn(),
      callbacks: stubCallbacks(),
    });

    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
  });
});
