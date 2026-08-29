import { parseCurrentViewRoute, buildViewSwitcherRedirectUrl } from "../lib/routing/router.js";
import { createGraphClient } from "../lib/graph/createGraphClient.js";
import { resolveSiteConfig, SkyeNotConfiguredError } from "../lib/views/viewConfig.js";
import { mountView } from "../lib/views/viewHost.js";

/**
 * Entry point for pages/view.astro. Resolves the route, loads and merges
 * the site's skye.config.json, and mounts the requested Custom View in a
 * sandboxed iframe via lib/views/viewHost.ts. If the route can't be
 * resolved (no siteId), it bounces to /switcher exactly like entry-form.ts.
 * If the site has no config at all, it shows a plain "not set up" page.
 */
async function main() {
  const appRoot = document.getElementById("skye-app");
  if (!appRoot) throw new Error('entry-view: missing "#skye-app" mount point in the page.');

  const route = parseCurrentViewRoute();

  if (route.page === "unresolved") {
    // Carry the wanted view id to the switcher so it can resume once a site is picked.
    const viewId = window.location.hash.replace(/^#/, "").split("/").filter(Boolean)[0] ?? "";
    window.location.assign(buildViewSwitcherRedirectUrl(route.siteId, route.applicationId, route.tenantId, viewId));
    return;
  }

  const graph = createGraphClient(route.applicationId, route.tenantId);

  let siteConfig;
  try {
    siteConfig = resolveSiteConfig(await graph.getSkyeSiteConfigFiles(route.siteId));
  } catch (err) {
    if (err instanceof SkyeNotConfiguredError) {
      renderMessage(appRoot, "SKYE isn't set up here yet", "This site has no skye_data/config/skye.config.json. A site owner needs to add one before views will load.");
      return;
    }
    throw err;
  }

  appRoot.innerHTML = "";
  await mountView({
    container: appRoot,
    graph,
    siteConfig,
    viewId: route.viewId,
    ctx: { siteId: route.siteId, applicationId: route.applicationId, tenantId: route.tenantId },
  });
}

/** Renders a centered heading + explanation into the mount point. */
function renderMessage(root: HTMLElement, heading: string, detail: string): void {
  root.innerHTML = "";
  const box = document.createElement("div");
  box.className = "skye-view__message";
  const h = document.createElement("h1");
  h.textContent = heading;
  const p = document.createElement("p");
  p.textContent = detail;
  box.append(h, p);
  root.append(box);
}

main().catch((err) => {
  console.error("entry-view failed:", err);
  const appRoot = document.getElementById("skye-app");
  if (appRoot) appRoot.innerHTML = `<p>Something went wrong loading this view. Check the console for details.</p>`;
});
