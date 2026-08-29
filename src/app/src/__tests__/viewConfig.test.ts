import { describe, it, expect } from "vitest";
import { resolveSiteConfig, canEditFormConfigs, SkyeNotConfiguredError } from "../lib/views/viewConfig.js";
import type { SkyeSiteConfigFile } from "../lib/graph/types.js";

describe("resolveSiteConfig", () => {
  it("throws SkyeNotConfiguredError when there is no base file", () => {
    expect(() => resolveSiteConfig([{ source: "admin", config: {} }])).toThrow(SkyeNotConfiguredError);
  });

  it("normalizes a base file with missing sections to empty arrays", () => {
    const config = resolveSiteConfig([{ source: "base", config: {} }]);
    expect(config.views.allowedLists).toEqual([]);
    expect(config.navigation.allowedExternalOrigins).toEqual([]);
    expect(config.home).toBeUndefined();
  });

  it("unions allowlists additively across base and overlays (a higher-permission overlay only ADDS)", () => {
    const files: SkyeSiteConfigFile[] = [
      { source: "base", config: { views: { allowedLists: ["Events"] }, navigation: { allowedExternalOrigins: ["https://a.example"] } } },
      { source: "10-admin", config: { views: { allowedLists: ["AuditLog", "Events"] }, navigation: { allowedExternalOrigins: ["https://b.example"] } } },
    ];
    const config = resolveSiteConfig(files);
    expect(config.views.allowedLists.sort()).toEqual(["AuditLog", "Events"]);
    expect(config.navigation.allowedExternalOrigins.sort()).toEqual(["https://a.example", "https://b.example"]);
  });

  it("takes the last-defined `home` (an admin overlay can redirect admins elsewhere)", () => {
    const files: SkyeSiteConfigFile[] = [
      { source: "base", config: { home: { type: "view", id: "calendar" } } },
      { source: "20-admin", config: { home: { type: "form", id: "admin-console" } } },
    ];
    expect(resolveSiteConfig(files).home).toEqual({ type: "form", id: "admin-console" });
  });

  it("ignores a malformed `home`", () => {
    expect(resolveSiteConfig([{ source: "base", config: { home: { type: "page", id: "x" } } }]).home).toBeUndefined();
    expect(resolveSiteConfig([{ source: "base", config: { home: { type: "view" } } }]).home).toBeUndefined();
  });

  it("drops non-string entries from allowlists", () => {
    const config = resolveSiteConfig([{ source: "base", config: { views: { allowedLists: ["Events", 42, null] } } }]);
    expect(config.views.allowedLists).toEqual(["Events"]);
  });

  it("unions builderEditors additively across base and overlays, same as the other allowlists", () => {
    const files: SkyeSiteConfigFile[] = [
      { source: "base", config: { builderEditors: ["admin"] } },
      { source: "10-admin", config: { builderEditors: ["admin", "staff"] } },
    ];
    expect(resolveSiteConfig(files).builderEditors.sort()).toEqual(["admin", "staff"]);
  });
});

describe("canEditFormConfigs", () => {
  it("is true when the user can see an overlay folder named in builderEditors", () => {
    const files: SkyeSiteConfigFile[] = [
      { source: "base", config: { builderEditors: ["admin"] } },
      { source: "admin", config: {} },
    ];
    expect(canEditFormConfigs(files)).toBe(true);
  });

  it("is false when the user can't see any overlay folder in builderEditors, even if one is configured", () => {
    const files: SkyeSiteConfigFile[] = [
      { source: "base", config: { builderEditors: ["admin"] } },
      { source: "staff", config: {} }, // visible to this user, but not a builder-editor overlay
    ];
    expect(canEditFormConfigs(files)).toBe(false);
  });

  it("is false when builderEditors is empty/unset, regardless of which overlays are visible", () => {
    const files: SkyeSiteConfigFile[] = [
      { source: "base", config: {} },
      { source: "admin", config: {} },
    ];
    expect(canEditFormConfigs(files)).toBe(false);
  });

  it("is false for a user who can only see the base file (no overlay at all)", () => {
    const files: SkyeSiteConfigFile[] = [{ source: "base", config: { builderEditors: ["admin"] } }];
    expect(canEditFormConfigs(files)).toBe(false);
  });
});
