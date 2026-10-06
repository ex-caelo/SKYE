import { defineConfig } from "astro/config";

// Static output: every route lives behind the client-side hash router
// (openskye.app/form#{formId}/...), so there's nothing for the server to
// vary per-request — see CLAUDE.md / TODO §3.
//
// `site` is the deployed custom domain (see public/CNAME and
// .github/workflows/deploy.yml). It's served at the domain root, so no
// `base` path is needed — several places in this app (redirectUri.ts,
// auth.ts, the switcher's nav links) build root-absolute paths like `/auth`
// and would need updating if this were ever moved under a subpath instead
// (e.g. a github.io/<repo>/ project page).
export default defineConfig({
  output: "static",
  site: "https://openskye.app",
});
