/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /** "1"/"true" → use the fixture-backed MockGraphClient instead of real Graph + MSAL (dev/test). */
  readonly PUBLIC_MOCK_GRAPH?: string;
  /** Azure app registration (client) id to use when a URL arrives with no `?applicationId=`. Required for the switcher in that case — there's no way to discover a client id. */
  readonly PUBLIC_DEFAULT_APPLICATION_ID?: string;
  /** Entra tenant id to use when a URL has no `?tenantId=`. Optional — a single-tenant deployment that omits it self-heals by asking for the user's work email (see lib/auth/tenantResolver.ts); setting it skips that prompt entirely. */
  readonly PUBLIC_DEFAULT_TENANT_ID?: string;
  /** "1"/"true" → a multi-tenant app registration: try the `/common` authority when no tenant is known, instead of prompting for a work email. Leave unset for single-tenant. */
  readonly PUBLIC_AUTH_ALLOW_COMMON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
