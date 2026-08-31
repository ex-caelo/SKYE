import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { isRedirectResponseHash, rememberRedirectReturn, completeRedirectReturn } from "../lib/auth/redirectReturn.js";

// jsdom here doesn't expose sessionStorage on an opaque origin — install a minimal one.
beforeAll(() => {
  if (typeof globalThis.sessionStorage === "undefined") {
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => void map.set(k, String(v)),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: (i: number) => [...map.keys()][i] ?? null,
        get length() {
          return map.size;
        },
      },
    });
  }
});

describe("isRedirectResponseHash", () => {
  it("recognizes an MSAL auth-code response", () => {
    expect(isRedirectResponseHash("#code=1.ATY...&client_info=x&state=eyJ...&session_state=y")).toBe(true);
  });

  it("recognizes an MSAL error response", () => {
    expect(isRedirectResponseHash("#error=access_denied&error_subcode=cancel&state=eyJ...")).toBe(true);
  });

  it("is false for an ordinary SKYE hash or an empty hash", () => {
    expect(isRedirectResponseHash("#test-event-signup/new")).toBe(false);
    expect(isRedirectResponseHash("#calendar")).toBe(false);
    expect(isRedirectResponseHash("")).toBe(false);
    // A stray `code` word without `state` isn't a response.
    expect(isRedirectResponseHash("#code-review/42")).toBe(false);
  });
});

describe("rememberRedirectReturn", () => {
  beforeEach(() => sessionStorage.clear());

  it("stashes the full current URL", () => {
    history.replaceState({}, "", "/switcher?applicationId=app-1&tenantId=t-1#calendar");
    rememberRedirectReturn();
    expect(sessionStorage.getItem("skye:auth:returnHref")).toContain("applicationId=app-1");
    expect(sessionStorage.getItem("skye:auth:returnHref")).toContain("tenantId=t-1");
  });
});

describe("completeRedirectReturn", () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState({}, "", "/switcher?applicationId=app-1");
  });

  it("is a no-op (returns false, no navigation) for a normal page load", async () => {
    expect(await completeRedirectReturn()).toBe(false);
  });
});
