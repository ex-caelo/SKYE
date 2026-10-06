import { describe, it, expect, vi, beforeEach } from "vitest";
import { InteractionRequiredAuthError, BrowserAuthError, BrowserAuthErrorCodes } from "@azure/msal-browser";

// Only PublicClientApplication is mocked — the error classes above are the real ones (plain
// Error subclasses, no DOM dependency), so `err instanceof InteractionRequiredAuthError`/
// `BrowserAuthError` checks inside authProvider.ts see genuine instances, exactly like a real
// MSAL failure would produce.
const mockInstance = {
  initialize: vi.fn().mockResolvedValue(undefined),
  handleRedirectPromise: vi.fn().mockResolvedValue(null),
  getAllAccounts: vi.fn().mockReturnValue([{ homeAccountId: "acct-1" }]),
  acquireTokenSilent: vi.fn(),
  loginPopup: vi.fn(),
  loginRedirect: vi.fn(),
};

vi.mock("@azure/msal-browser", async () => {
  const actual = await vi.importActual<typeof import("@azure/msal-browser")>("@azure/msal-browser");
  return {
    ...actual,
    // A plain `function`, not an arrow — vi.fn() can only be invoked with `new` (as
    // `getMsalInstance` does) when its implementation is a real constructor function that
    // returns the mock instance object explicitly.
    PublicClientApplication: vi.fn().mockImplementation(function () {
      return mockInstance;
    }),
  };
});

const { acquireToken } = await import("../shared/auth/authProvider.js");

describe("acquireToken — silent-acquisition fallback to interactive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstance.initialize.mockResolvedValue(undefined);
    mockInstance.handleRedirectPromise.mockResolvedValue(null);
    mockInstance.getAllAccounts.mockReturnValue([{ homeAccountId: "acct-1" }]);
  });

  it("falls through to loginPopup when acquireTokenSilent throws InteractionRequiredAuthError", async () => {
    mockInstance.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError("interaction_required", "test-correlation-id"));
    mockInstance.loginPopup.mockResolvedValue({ accessToken: "popup-token", tenantId: "tenant-1" });

    const token = await acquireToken("app-1", "tenant-1", ["Sites.Selected"]);

    expect(token).toBe("popup-token");
    expect(mockInstance.loginPopup).toHaveBeenCalledTimes(1);
  });

  it("falls through to loginPopup when acquireTokenSilent throws a BrowserAuthError timed_out (the iframe-timeout case a real user hit)", async () => {
    mockInstance.acquireTokenSilent.mockRejectedValue(new BrowserAuthError(BrowserAuthErrorCodes.timedOut, "test-correlation-id"));
    mockInstance.loginPopup.mockResolvedValue({ accessToken: "popup-token-2", tenantId: "tenant-1" });

    const token = await acquireToken("app-1", "tenant-1", ["Sites.Selected"]);

    expect(token).toBe("popup-token-2");
    expect(mockInstance.loginPopup).toHaveBeenCalledTimes(1);
  });

  it("does NOT fall through for an unrelated silent-acquisition error — it propagates instead", async () => {
    mockInstance.acquireTokenSilent.mockRejectedValue(new Error("network_error"));

    await expect(acquireToken("app-1", "tenant-1", ["Sites.Selected"])).rejects.toThrow("network_error");
    expect(mockInstance.loginPopup).not.toHaveBeenCalled();
  });
});
