import { describe, it, expect } from "vitest";
import {
  parseRoute,
  buildSwitcherRedirectUrl,
  buildFormUrlForSelectedSite,
  buildSwitcherUrlForSite,
  buildFormUrlForSelectedForm,
  buildDraftPreviewUrl,
  hashHasFormId,
  looksLikeFormLink,
  parseAuthErrorFromHash,
} from "../lib/routing/router.js";

describe("parseRoute", () => {
  it("parses create mode from a bare formId or an explicit /new", () => {
    expect(parseRoute("#abc123", "?siteId=site1&applicationId=app1")).toEqual({
      page: "form", formId: "abc123", mode: "create", itemId: undefined, siteId: "site1", applicationId: "app1",
    });
    expect(parseRoute("#abc123/new", "?siteId=site1&applicationId=app1")).toEqual({
      page: "form", formId: "abc123", mode: "create", itemId: undefined, siteId: "site1", applicationId: "app1",
    });
  });

  it("parses edit mode from formId/itemId", () => {
    expect(parseRoute("#abc123/45", "?siteId=site1&applicationId=app1")).toEqual({
      page: "form", formId: "abc123", mode: "edit", itemId: "45", siteId: "site1", applicationId: "app1",
    });
  });

  it("parses view mode from formId/itemId/view", () => {
    expect(parseRoute("#abc123/45/view", "?siteId=site1&applicationId=app1")).toEqual({
      page: "form", formId: "abc123", mode: "view", itemId: "45", siteId: "site1", applicationId: "app1",
    });
  });

  it("falls back to unresolved when siteId or applicationId is missing", () => {
    expect(parseRoute("#abc123", "")).toEqual({ page: "unresolved", siteId: undefined, applicationId: undefined });
    expect(parseRoute("#abc123", "?siteId=site1")).toEqual({ page: "unresolved", siteId: "site1", applicationId: undefined });
  });

  it("falls back to unresolved when there's no formId at all", () => {
    expect(parseRoute("", "?siteId=site1&applicationId=app1")).toEqual({ page: "unresolved", siteId: "site1", applicationId: "app1" });
  });

  it("parses an optional tenantId — needed for a single-tenant Azure app registration (rejects the /common authority)", () => {
    expect(parseRoute("#abc123", "?siteId=site1&applicationId=app1&tenantId=tenant1")).toEqual({
      page: "form", formId: "abc123", mode: "create", itemId: undefined, siteId: "site1", applicationId: "app1", tenantId: "tenant1",
    });
    expect(parseRoute("#abc123", "?siteId=site1&applicationId=app1")).toEqual(
      expect.not.objectContaining({ tenantId: expect.anything() })
    );
  });

  it("parses an optional draft id from ?draft=, for /form's draft-preview mode", () => {
    expect(parseRoute("#abc123", "?siteId=site1&applicationId=app1&draft=beta1")).toEqual({
      page: "form", formId: "abc123", mode: "create", itemId: undefined, siteId: "site1", applicationId: "app1", draftId: "beta1",
    });
    expect(parseRoute("#abc123", "?siteId=site1&applicationId=app1")).toEqual(
      expect.not.objectContaining({ draftId: expect.anything() })
    );
  });
});

describe("buildSwitcherRedirectUrl", () => {
  it("carries siteId and applicationId and preserves the hash", () => {
    expect(buildSwitcherRedirectUrl("site1", "app1", undefined, "#abc123/new")).toBe("/switcher?siteId=site1&applicationId=app1#abc123/new");
  });

  it("carries just applicationId when there's no siteId yet", () => {
    expect(buildSwitcherRedirectUrl(undefined, "app1", undefined, "#abc123/new")).toBe("/switcher?applicationId=app1#abc123/new");
  });

  it("omits the query string entirely when neither siteId nor applicationId is known", () => {
    expect(buildSwitcherRedirectUrl(undefined, undefined, undefined, "#abc123")).toBe("/switcher#abc123");
  });

  it("carries tenantId forward when present", () => {
    expect(buildSwitcherRedirectUrl("site1", "app1", "tenant1", "#abc123")).toBe("/switcher?siteId=site1&applicationId=app1&tenantId=tenant1#abc123");
  });
});

describe("buildFormUrlForSelectedSite", () => {
  it("fills in siteId/applicationId and preserves the hash", () => {
    expect(buildFormUrlForSelectedSite("site1", "app1", undefined, "#abc123/45/view")).toBe(
      "/form?siteId=site1&applicationId=app1#abc123/45/view"
    );
  });

  it("carries tenantId forward when present", () => {
    expect(buildFormUrlForSelectedSite("site1", "app1", "tenant1", "#abc123")).toBe("/form?siteId=site1&applicationId=app1&tenantId=tenant1#abc123");
  });
});

describe("buildSwitcherUrlForSite", () => {
  it("fills in siteId/applicationId with no hash, for moving to the form-picker step", () => {
    expect(buildSwitcherUrlForSite("site1", "app1", undefined)).toBe("/switcher?siteId=site1&applicationId=app1");
  });
});

describe("buildFormUrlForSelectedForm", () => {
  it("fills in siteId/applicationId and defaults the hash to create mode", () => {
    expect(buildFormUrlForSelectedForm("site1", "app1", undefined, "abc123")).toBe("/form?siteId=site1&applicationId=app1#abc123/new");
  });
});

describe("buildDraftPreviewUrl", () => {
  it("builds a create-mode /form URL carrying ?draft=", () => {
    expect(buildDraftPreviewUrl("site1", "app1", undefined, "abc123", "beta1")).toBe("/form?siteId=site1&applicationId=app1&draft=beta1#abc123/new");
  });

  it("carries tenantId when given", () => {
    expect(buildDraftPreviewUrl("site1", "app1", "tenant1", "abc123", "beta1")).toBe(
      "/form?siteId=site1&applicationId=app1&draft=beta1&tenantId=tenant1#abc123/new"
    );
  });
});

describe("hashHasFormId", () => {
  it("is true whenever the hash has at least one segment", () => {
    expect(hashHasFormId("#abc123")).toBe(true);
    expect(hashHasFormId("#abc123/45/view")).toBe(true);
  });

  it("is false for an empty or bare hash", () => {
    expect(hashHasFormId("")).toBe(false);
    expect(hashHasFormId("#")).toBe(false);
  });
});

describe("looksLikeFormLink", () => {
  it("is true when either the hash or the query string is non-empty", () => {
    expect(looksLikeFormLink("#abc123", "")).toBe(true);
    expect(looksLikeFormLink("", "?applicationId=app1")).toBe(true);
  });

  it("is false for a context-free landing visit", () => {
    expect(looksLikeFormLink("", "")).toBe(false);
  });
});

describe("parseAuthErrorFromHash", () => {
  it("extracts error and error_description from an MSAL redirect-flow error callback", () => {
    expect(parseAuthErrorFromHash("#error=access_denied&error_description=User%20declined&state=xyz")).toEqual({
      error: "access_denied",
      description: "User declined",
    });
  });

  it("falls back to error_subcode when there's no error_description", () => {
    expect(parseAuthErrorFromHash("#error=access_denied&error_subcode=cancel&state=xyz")).toEqual({
      error: "access_denied",
      description: "cancel",
    });
  });

  it("is null for an ordinary SKYE hash (formId/mode), not an OAuth error", () => {
    expect(parseAuthErrorFromHash("#abc123/new")).toBeNull();
    expect(parseAuthErrorFromHash("")).toBeNull();
  });
});
