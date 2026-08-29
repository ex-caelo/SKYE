import { acquireToken } from "../auth/authProvider.js";

export type RawGraphFetch = (path: string, init: RequestInit) => Promise<Response>;

/**
 * Builds the low-level fetch a `graphRequest` postAction uses — distinct
 * from GraphClient's list-CRUD methods, since a postAction can target any
 * Graph path, not just the ones our higher-level abstraction models.
 */
export function createRealGraphFetch(applicationId: string, tenantId?: string): RawGraphFetch {
  return async (path, init) => {
    const token = await acquireToken(applicationId, tenantId);
    const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
    return fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  };
}

/** Mock version — no network, no auth. Returns a canned success so dev configs with a graphRequest postAction don't crash; extend with fixture-specific responses if a test needs one. */
export function createMockGraphFetch(): RawGraphFetch {
  return async () => new Response(JSON.stringify({ mocked: true }), { status: 200 });
}

export function createGraphFetch(applicationId: string, tenantId?: string): RawGraphFetch {
  const useMock = import.meta.env.PUBLIC_MOCK_GRAPH === "1" || import.meta.env.PUBLIC_MOCK_GRAPH === "true";
  return useMock ? createMockGraphFetch() : createRealGraphFetch(applicationId, tenantId);
}
