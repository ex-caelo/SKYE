import type { GraphClient } from "./types.js";
import { MockGraphClient } from "./mockGraphClient.js";
import { RealGraphClient } from "./graphClient.js";
import { createAuthProvider } from "../auth/authProvider.js";

/**
 * Single decision point for mock vs. real Graph access. Set
 * PUBLIC_MOCK_GRAPH=1 to develop and test rendering/validation/action logic
 * without a live tenant or a signed-in session — see TODO §6 and CLAUDE.md.
 * Must use the PUBLIC_ prefix: this file is bundled into the client, and
 * Astro/Vite only inline env vars with that prefix into client code (a bare
 * MOCK_GRAPH would silently evaluate to undefined in the browser, falling
 * through to RealGraphClient — this was a real bug, found when MOCK_GRAPH=1
 * pnpm dev didn't actually skip auth in an actual browser session).
 */
export function createGraphClient(applicationId: string, tenantId?: string): GraphClient {
  const useMock = import.meta.env.PUBLIC_MOCK_GRAPH === "1" || import.meta.env.PUBLIC_MOCK_GRAPH === "true";
  if (useMock) return new MockGraphClient();
  return new RealGraphClient(createAuthProvider(applicationId, tenantId));
}
