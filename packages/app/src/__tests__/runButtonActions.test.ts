import { describe, it, expect, vi } from "vitest";
import type { FieldConfig } from "@skye/form-config";
import { runButtonActions } from "../features/form/submit/runButtonActions.js";

function stubCallbacks() {
  return {
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
  };
}

const sendReminderField: FieldConfig = {
  page: "p1",
  source: "virtual",
  controlType: "button",
  label: "Send Reminder",
  actions: {
    notify: {
      trigger: "onClick",
      type: "httpRequest",
      request: { url: "https://hooks.example.com/remind", method: "POST", body: { itemId: "{{item.id}}", name: "{{fields.name}}" } },
    },
    thenRedirect: {
      trigger: "onClick",
      type: "redirect",
      dependsOn: ["notify"],
      to: "/reminded?item={{item.id}}",
    },
  },
};

describe("runButtonActions", () => {
  it("runs every action in the field's own actions dict, resolving {{item.x}}/{{fields.x}}, in dependsOn order", async () => {
    const httpFetch = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", httpFetch);

    const callbacks = stubCallbacks();
    const result = await runButtonActions(sendReminderField, { name: "Jane Doe" }, { id: "42", Title: "Jane Doe" }, vi.fn(), callbacks);

    expect(result.errors).toEqual({});
    expect(result.outcomes).toEqual({ notify: "ran", thenRedirect: "ran" });

    const [, init] = httpFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.itemId).toBe("42");
    expect(body.name).toBe("Jane Doe");

    expect(callbacks.navigate).toHaveBeenCalledWith("/reminded?item=42");
    vi.unstubAllGlobals();
  });

  it("reports a failure without throwing, and cascade-skips a dependent action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("fail", { status: 500, statusText: "Internal Server Error" })));

    const result = await runButtonActions(sendReminderField, { name: "Jane Doe" }, { id: "42" }, vi.fn(), stubCallbacks());

    expect(Object.keys(result.errors)).toContain("notify");
    expect(result.outcomes.thenRedirect).toBe("skipped"); // depended on the failed "notify"
    vi.unstubAllGlobals();
  });

  it("ignores an action with no actions dict at all (a button that's never actually clicked to matter, or a mis-authored field) rather than throwing", async () => {
    const field: FieldConfig = { page: "p1", source: "virtual", controlType: "button", label: "Nothing To Do" };
    const result = await runButtonActions(field, {}, {}, vi.fn(), stubCallbacks());
    expect(result).toEqual({ outcomes: {}, results: {}, errors: {} });
  });

  it("a script action reaches ctx.scriptActions exactly like a postAction's does, with item/fields/results available", async () => {
    const scriptFn = vi.fn(async (_args, ctx) => ({ ok: true, itemId: ctx.templateContext.item.id }));
    const field: FieldConfig = {
      page: "p1",
      source: "virtual",
      controlType: "button",
      label: "Run Script",
      actions: { runIt: { trigger: "onClick", type: "script", functionName: "test.doThing" } },
    };

    const callbacks = { ...stubCallbacks(), scriptActions: { "test.doThing": scriptFn } };
    const result = await runButtonActions(field, { name: "Jane" }, { id: "42" }, vi.fn(), callbacks);

    expect(result.errors).toEqual({});
    expect(scriptFn).toHaveBeenCalled();
    expect(result.results.runIt).toEqual({ ok: true, itemId: "42" });
  });
});
