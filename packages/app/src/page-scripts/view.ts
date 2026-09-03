import { parseCurrentViewRoute, buildViewSwitcherRedirectUrl } from "../shared/routing.js";
import { createGraphClient } from "../shared/sharepoint/createGraphClient.js";
import { getCachedTenantId } from "../shared/auth/tenantResolver.js";
import { completeRedirectReturn } from "../shared/auth/redirectReturn.js";
import { resolveSiteConfig, SkyeNotConfiguredError } from "../shared/site-config.js";
import { mountView } from "../features/custom-views/viewHost.js";
import { showState, fillSlot } from "../shared/ui/pageState.js";

/**
 * Entry point for pages/view.astro. Resolves the route, loads and merges
 * the site's skye.config.json, and mounts the requested Custom View in a
 * sandboxed iframe via lib/views/viewHost.ts. If the route can't be
 * resolved (no siteId), it bounces to /switcher exactly like entry-form.ts.
 * If the site has no config at all, it reveals the page's "not set up"
 * state. All state markup lives in view.astro.
 */
async function main() {
  // Landing back from an MSAL loginRedirect? Finish it and return to the pre-redirect URL first.
  if (await completeRedirectReturn()) return;

  const appRoot = document.getElementById("skye-app");
  if (!appRoot) throw new Error('entry-view: missing "#skye-app" mount point in the page.');

  const route = parseCurrentViewRoute();

  if (route.page === "unresolved") {
    // Carry the wanted view id to the switcher so it can resume once a site is picked.
    const viewId = window.location.hash.replace(/^#/, "").split("/").filter(Boolean)[0] ?? "";
    window.location.assign(buildViewSwitcherRedirectUrl(route.siteId, route.applicationId, route.tenantId, viewId));
    return;
  }

  // URL → PUBLIC_DEFAULT_TENANT_ID → a tenant id a previous sign-in cached; else /common + self-heal (tenantResolver.ts).
  const tenantId = route.tenantId ?? import.meta.env.PUBLIC_DEFAULT_TENANT_ID ?? getCachedTenantId(route.applicationId);
  const graph = createGraphClient(route.applicationId, tenantId);

  let siteConfig;
  try {
    siteConfig = resolveSiteConfig(await graph.getSkyeSiteConfigFiles(route.siteId));
  } catch (err) {
    if (err instanceof SkyeNotConfiguredError) {
      const panel = showState(appRoot, "state-not-configured");
      fillSlot(panel, "title", "SKYE isn't set up here yet");
      fillSlot(
        panel,
        "body",
        "This site's Site Assets library has no skye_data/config/skye.config.json. A site owner needs to add one (via the site switcher) before views will load."
      );
      return;
    }
    throw err;
  }

  const screen = showState(appRoot, "screen-view");
  await mountView({
    container: screen.querySelector<HTMLElement>('[data-slot="view-mount"]')!,
    graph,
    siteConfig,
    viewId: route.viewId,
    ctx: { siteId: route.siteId, applicationId: route.applicationId, tenantId },
  });
}

main().catch((err) => {
  console.error("entry-view failed:", err);
  const appRoot = document.getElementById("skye-app");
  if (appRoot) {
    try {
      showState(appRoot, "state-error");
    } catch {
      appRoot.textContent = "Something went wrong loading this view. Check the console for details.";
    }
  }
});
