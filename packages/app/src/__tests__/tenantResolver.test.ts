import { describe, it, expect, beforeEach, beforeAll, vi, afterEach } from "vitest";
import {
  getCachedTenantId,
  cacheTenantId,
  clearCachedTenantId,
  backfillTenantIdInUrl,
  discoverTenantIdFromDomain,
  isCommonEndpointUnsupported,
} from "../shared/auth/tenantResolver.js";

const GUID = "72f988bf-86f1-41af-91ab-2d7cd011db47";

// This jsdom build doesn't expose localStorage on an opaque origin; the
// resolver treats a missing store as "no cache" (try/catch), but the cache
// test needs a real store to test against, so install a minimal one.
beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  }
});

describe("tenant id cache", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a tenant id per application id", () => {
    expect(getCachedTenantId("app-1")).toBeUndefined();
    cacheTenantId("app-1", GUID);
    expect(getCachedTenantId("app-1")).toBe(GUID);
    expect(getCachedTenantId("app-2")).toBeUndefined();
  });

  it("clearCachedTenantId forgets a wrong value so the next sign-in can re-ask", () => {
    cacheTenantId("app-1", GUID);
    clearCachedTenantId("app-1");
    expect(getCachedTenantId("app-1")).toBeUndefined();
  });
});

describe("backfillTenantIdInUrl", () => {
  beforeEach(() => history.replaceState({}, "", "/view?siteId=s1#calendar"));

  it("adds ?tenantId= while preserving the path and hash", () => {
    backfillTenantIdInUrl(GUID);
    expect(window.location.pathname).toBe("/view");
    expect(new URLSearchParams(window.location.search).get("tenantId")).toBe(GUID);
    expect(window.location.hash).toBe("#calendar");
  });

  it("is a no-op when the same tenantId is already present", () => {
    history.replaceState({}, "", `/view?siteId=s1&tenantId=${GUID}#calendar`);
    const before = window.location.href;
    backfillTenantIdInUrl(GUID);
    expect(window.location.href).toBe(before);
  });
});

describe("discoverTenantIdFromDomain", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (impl: (url: string) => { ok: boolean; json?: () => Promise<unknown> } | Promise<never>) =>
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(impl(url))));

  it("resolves a work email to the tenant GUID from the OIDC issuer", async () => {
    stubFetch((url) => {
      expect(url).toContain("login.microsoftonline.com/contoso.com/v2.0/.well-known/openid-configuration");
      return { ok: true, json: async () => ({ issuer: `https://login.microsoftonline.com/${GUID}/v2.0` }) };
    });
    expect(await discoverTenantIdFromDomain("alex@contoso.com")).toBe(GUID);
  });

  it("accepts a bare domain too", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ token_endpoint: `https://login.microsoftonline.com/${GUID}/oauth2/v2.0/token` }) }));
    expect(await discoverTenantIdFromDomain("contoso.com")).toBe(GUID);
  });

  it("returns null without fetching for something that isn't a domain", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await discoverTenantIdFromDomain("alex")).toBeNull();
    expect(await discoverTenantIdFromDomain("")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null for a domain that isn't a Microsoft 365 tenant (HTTP error)", async () => {
    stubFetch(() => ({ ok: false }));
    expect(await discoverTenantIdFromDomain("not-a-tenant.example")).toBeNull();
  });

  it("returns null for the consumers (personal accounts) tenant", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ issuer: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0" }) }));
    expect(await discoverTenantIdFromDomain("someone@outlook.com")).toBeNull();
  });

  it("returns null on a network error rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    expect(await discoverTenantIdFromDomain("contoso.com")).toBeNull();
  });
});

describe("isCommonEndpointUnsupported", () => {
  it("matches the single-tenant-can't-use-/common AAD error, from any error shape", () => {
    expect(isCommonEndpointUnsupported({ errorMessage: "AADSTS50194: Application is not configured as multi-tenant" })).toBe(true);
    expect(isCommonEndpointUnsupported(new Error("... AADSTS50194 ..."))).toBe(true);
    expect(isCommonEndpointUnsupported("AADSTS50059: no tenant-identifying information")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isCommonEndpointUnsupported(new Error("AADSTS65001: consent required"))).toBe(false);
    expect(isCommonEndpointUnsupported(undefined)).toBe(false);
  });
});
