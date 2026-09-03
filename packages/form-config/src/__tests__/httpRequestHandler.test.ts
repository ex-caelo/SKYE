import { describe, it, expect, vi } from "vitest";
import { httpRequestHandler } from "../post-actions/handlers/httpRequest.js";
import type { ActionExecutionContext } from "../post-actions/handlers/registry.js";
import type { PostAction } from "../schema/types.js";

function makeContext(httpFetch: ActionExecutionContext["httpFetch"]): ActionExecutionContext {
  return {
    templateContext: { fields: { campus: "Bloomington" }, item: { id: "1" }, results: {} },
    httpFetch,
    graphFetch: vi.fn(),
    navigate: vi.fn(),
    showMessage: vi.fn(),
    setFieldValue: vi.fn(),
    scriptActions: {},
  };
}

describe("httpRequestHandler", () => {
  it("appends params as a query string, interpolating param values", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const action: PostAction = {
      trigger: "afterSubmit",
      type: "httpRequest",
      request: { url: "https://example.com/api/lookup", method: "GET", params: { campus: "{{fields.campus}}", limit: "10" } },
    };

    await httpRequestHandler(action, makeContext(httpFetch));

    const calledUrl = httpFetch.mock.calls[0][0] as string;
    expect(new URL(calledUrl).searchParams.get("campus")).toBe("Bloomington");
    expect(new URL(calledUrl).searchParams.get("limit")).toBe("10");
  });

  it("appends to an existing query string with & rather than overwriting it", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const action: PostAction = {
      trigger: "afterSubmit",
      type: "httpRequest",
      request: { url: "https://example.com/api/lookup?existing=1", method: "GET", params: { extra: "2" } },
    };

    await httpRequestHandler(action, makeContext(httpFetch));

    const calledUrl = httpFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://example.com/api/lookup?existing=1&extra=2");
  });

  it("leaves the url untouched when there are no params", async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const action: PostAction = {
      trigger: "afterSubmit",
      type: "httpRequest",
      request: { url: "https://example.com/api/lookup", method: "GET" },
    };

    await httpRequestHandler(action, makeContext(httpFetch));

    expect(httpFetch.mock.calls[0][0]).toBe("https://example.com/api/lookup");
  });
});
