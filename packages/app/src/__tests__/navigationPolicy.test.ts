import { describe, it, expect } from "vitest";
import { resolveNavigation, NavigationError } from "../features/custom-views/navigationPolicy.js";

const ctx = {
  siteId: "site-1",
  applicationId: "app-1",
  tenantId: undefined,
  allowedExternalOrigins: ["https://intranet.example.org"],
};

describe("resolveNavigation", () => {
  it("builds a same-site /view URL for a view target", () => {
    const d = resolveNavigation({ view: "calendar" }, ctx);
    expect(d).toEqual({ kind: "internal", url: "/view?siteId=site-1&applicationId=app-1#calendar" });
  });

  it("builds a /form create URL for a bare form target", () => {
    expect(resolveNavigation({ form: "event-signup" }, ctx)).toEqual({
      kind: "internal",
      url: "/form?siteId=site-1&applicationId=app-1#event-signup/new",
    });
  });

  it("builds edit / view mode form URLs when an itemId is given", () => {
    expect(resolveNavigation({ form: "event-signup", itemId: "42" }, ctx).url).toBe("/form?siteId=site-1&applicationId=app-1#event-signup/42");
    expect(resolveNavigation({ form: "event-signup", itemId: "42", mode: "view" }, ctx).url).toBe(
      "/form?siteId=site-1&applicationId=app-1#event-signup/42/view"
    );
  });

  it("carries tenantId through when present", () => {
    const d = resolveNavigation({ view: "calendar" }, { ...ctx, tenantId: "tenant-9" });
    expect(d.url).toContain("tenantId=tenant-9");
  });

  it("rejects a mode without an itemId", () => {
    expect(() => resolveNavigation({ form: "x", mode: "view" }, ctx)).toThrow(/needs an itemId/);
  });

  it("rejects ids that aren't simple slugs (no traversal, no separators)", () => {
    expect(() => resolveNavigation({ view: "../secret" }, ctx)).toThrow(NavigationError);
    expect(() => resolveNavigation({ form: "a/b" }, ctx)).toThrow(NavigationError);
    expect(() => resolveNavigation({ form: "ok", itemId: "1 or 1" }, ctx)).toThrow(NavigationError);
  });

  it("allows an external URL only when its exact origin is on the allowlist", () => {
    expect(resolveNavigation({ url: "https://intranet.example.org/wiki/x" }, ctx)).toEqual({
      kind: "external",
      url: "https://intranet.example.org/wiki/x",
    });
  });

  it("rejects an external URL whose origin isn't allowlisted", () => {
    expect(() => resolveNavigation({ url: "https://intranet.example.org.evil.com/" }, ctx)).toThrow(/not on this site's allowlist/);
    expect(() => resolveNavigation({ url: "https://attacker.example/?x=1" }, ctx)).toThrow(NavigationError);
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => resolveNavigation({ url: "javascript:alert(1)" }, ctx)).toThrow(/scheme/);
    expect(() => resolveNavigation({ url: "data:text/html,x" }, ctx)).toThrow(/scheme/);
  });

  it("rejects a target with none of view / form / url", () => {
    expect(() => resolveNavigation({}, ctx)).toThrow(NavigationError);
    expect(() => resolveNavigation(null, ctx)).toThrow(NavigationError);
  });
});
