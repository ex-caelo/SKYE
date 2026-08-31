import { describe, it, expect } from "vitest";
import { parsePastedSiteUrl, siteRootUrl, isSiteAssetsList } from "../lib/graph/siteUrl.js";

describe("parsePastedSiteUrl — SharePoint URLs", () => {
  it("reduces a deep library/page URL to the site root", () => {
    expect(parsePastedSiteUrl("https://indiana.sharepoint.com/sites/msteams_79e519/Shared%20Documents/Forms/AllItems.aspx")).toEqual({
      kind: "sharepoint",
      hostname: "indiana.sharepoint.com",
      sitePath: "sites/msteams_79e519",
    });
  });

  it("leaves a bare site URL alone", () => {
    expect(parsePastedSiteUrl("https://indiana.sharepoint.com/sites/msteams_79e519")).toMatchObject({ sitePath: "sites/msteams_79e519" });
    expect(parsePastedSiteUrl("https://indiana.sharepoint.com/sites/msteams_79e519/")).toMatchObject({ sitePath: "sites/msteams_79e519" });
  });

  it("handles the /teams/ managed path and _layouts pages", () => {
    expect(parsePastedSiteUrl("https://x.sharepoint.com/teams/Marketing/_layouts/15/settings.aspx")).toMatchObject({ sitePath: "teams/Marketing" });
  });

  it("treats a URL with no /sites/ or /teams/ segment as the tenant root site", () => {
    expect(parsePastedSiteUrl("https://x.sharepoint.com/SitePages/Home.aspx")).toEqual({ kind: "sharepoint", hostname: "x.sharepoint.com", sitePath: "" });
    expect(parsePastedSiteUrl("https://x.sharepoint.com/")).toMatchObject({ sitePath: "" });
  });

  it("siteRootUrl rebuilds the tidy root", () => {
    expect(siteRootUrl({ kind: "sharepoint", hostname: "x.sharepoint.com", sitePath: "sites/Foo" })).toBe("https://x.sharepoint.com/sites/Foo");
    expect(siteRootUrl({ kind: "sharepoint", hostname: "x.sharepoint.com", sitePath: "" })).toBe("https://x.sharepoint.com");
  });
});

describe("parsePastedSiteUrl — Teams links", () => {
  it("extracts the groupId from a Teams channel deep link", () => {
    const link =
      "https://teams.microsoft.com/l/team/19%3AI_KMBzCFK7Zwq8th8LopexWJKNeW54NL-ARhOjpRuzQ1%40thread.tacv2/conversations?groupId=6f69192b-0cd6-446c-b2cd-4677d8256d9a&tenantId=1113be34-aed1-4d00-ab4b-cdd02510be91";
    expect(parsePastedSiteUrl(link)).toEqual({ kind: "groupId", groupId: "6f69192b-0cd6-446c-b2cd-4677d8256d9a" });
  });

  it("is null for a Teams link with no groupId, or a non-GUID groupId", () => {
    expect(parsePastedSiteUrl("https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/General?tenantId=x")).toBeNull();
    expect(parsePastedSiteUrl("https://teams.microsoft.com/l/team/x/conversations?groupId=not-a-guid")).toBeNull();
  });
});

describe("isSiteAssetsList", () => {
  it("matches on the language-independent URL name even when the display name is localized", () => {
    expect(isSiteAssetsList({ name: "SiteAssets", displayName: "Activos del sitio" })).toBe(true);
  });

  it("matches on the webUrl slug", () => {
    expect(isSiteAssetsList({ name: "Something", webUrl: "https://x.sharepoint.com/sites/y/SiteAssets" })).toBe(true);
    expect(isSiteAssetsList({ webUrl: "https://x.sharepoint.com/sites/y/SiteAssets/" })).toBe(true);
  });

  it("matches the English display name as a last resort", () => {
    expect(isSiteAssetsList({ displayName: "Site Assets" })).toBe(true);
  });

  it("does not match other libraries", () => {
    expect(isSiteAssetsList({ name: "Shared Documents", displayName: "Documents", webUrl: "https://x.sharepoint.com/sites/y/Shared%20Documents" })).toBe(false);
    expect(isSiteAssetsList({ name: "SitePages", displayName: "Site Pages" })).toBe(false);
  });
});

describe("parsePastedSiteUrl — rejects", () => {
  it("returns null for non-URLs and non-SharePoint/Teams hosts", () => {
    expect(parsePastedSiteUrl("msteams_79e519")).toBeNull();
    expect(parsePastedSiteUrl("")).toBeNull();
    expect(parsePastedSiteUrl("https://example.com/sites/Foo")).toBeNull();
    expect(parsePastedSiteUrl("https://drive.google.com/whatever")).toBeNull();
  });
});
