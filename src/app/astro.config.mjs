import { defineConfig } from "astro/config";

// Static output: every route lives behind the client-side hash router
// (getskye.app/form#{formId}/...), so there's nothing for the server to
// vary per-request — see CLAUDE.md / TODO §3.
export default defineConfig({
  output: "static",
});
