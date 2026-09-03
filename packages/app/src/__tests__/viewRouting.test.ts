import { describe, it, expect } from "vitest";
import { parseViewRoute, buildViewUrl, buildFormUrl, buildBuilderUrl, buildViewSwitcherRedirectUrl } from "../shared/routing.js";

describe("parseViewRoute", () => {
  it("resolves a full /view route", () => {
    expect(parseViewRoute("#calendar", "?siteId=s1&applicationId=a1")).toEqual({
      page: "view",
      viewId: "calendar",
      siteId: "s1",
      applicationId: "a1",
      tenantId: undefined,
    });
  });

  it("carries tenantId through", () => {
    expect(parseViewRoute("#calendar", "?siteId=s1&applicationId=a1&tenantId=t1").tenantId).toBe("t1");
  });

  it("is unresolved when the viewId, siteId, or applicationId is missing", () => {
    expect(parseViewRoute("", "?siteId=s1&applicationId=a1").page).toBe("unresolved");
    expect(parseViewRoute("#calendar", "?applicationId=a1")).toMatchObject({ page: "unresolved", applicationId: "a1" });
    expect(parseViewRoute("#calendar", "?siteId=s1")).toMatchObject({ page: "unresolved", siteId: "s1" });
  });

  it("treats a non-slug view id (path traversal) as unresolved", () => {
    expect(parseViewRoute("#../secret", "?siteId=s1&applicationId=a1").page).toBe("unresolved");
    expect(parseViewRoute("#..", "?siteId=s1&applicationId=a1").page).toBe("unresolved");
    expect(parseViewRoute("#a b", "?siteId=s1&applicationId=a1").page).toBe("unresolved");
  });
});

describe("view URL builders", () => {
  it("buildBuilderUrl targets /builder, with an optional formId hash", () => {
    expect(buildBuilderUrl("s1", "a1", undefined)).toBe("/builder?siteId=s1&applicationId=a1");
    expect(buildBuilderUrl("s1", "a1", "t1", "event-signup")).toBe("/builder?siteId=s1&applicationId=a1&tenantId=t1#event-signup");
  });

  it("buildViewUrl omits tenantId when absent, includes it when present", () => {
    expect(buildViewUrl("s1", "a1", undefined, "calendar")).toBe("/view?siteId=s1&applicationId=a1#calendar");
    expect(buildViewUrl("s1", "a1", "t1", "calendar")).toBe("/view?siteId=s1&applicationId=a1&tenantId=t1#calendar");
  });

  it("buildFormUrl encodes mode as the hash segment", () => {
    expect(buildFormUrl("s1", "a1", undefined, "f", "create")).toBe("/form?siteId=s1&applicationId=a1#f/new");
    expect(buildFormUrl("s1", "a1", undefined, "f", "edit", "9")).toBe("/form?siteId=s1&applicationId=a1#f/9");
    expect(buildFormUrl("s1", "a1", undefined, "f", "view", "9")).toBe("/form?siteId=s1&applicationId=a1#f/9/view");
    // mode edit/view without an itemId falls back to create
    expect(buildFormUrl("s1", "a1", undefined, "f", "edit")).toBe("/form?siteId=s1&applicationId=a1#f/new");
  });

  it("buildViewSwitcherRedirectUrl puts the wanted view in a ?view= param, not the hash", () => {
    expect(buildViewSwitcherRedirectUrl(undefined, "a1", undefined, "calendar")).toBe("/switcher?applicationId=a1&view=calendar");
    expect(buildViewSwitcherRedirectUrl("s1", "a1", "t1", "calendar")).toBe("/switcher?siteId=s1&applicationId=a1&tenantId=t1&view=calendar");
  });
});
