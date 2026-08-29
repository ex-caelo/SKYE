import { createGraphClient } from "../lib/graph/createGraphClient.js";
import { renderSiteSwitcher, renderFormOrViewPicker, toPickerEntries } from "../lib/routing/siteSwitcher.js";
import {
  buildFormUrlForSelectedSite,
  buildFormUrlForSelectedForm,
  buildSwitcherUrlForSite,
  buildViewUrl,
  hashHasFormId,
} from "../lib/routing/router.js";
import { resolveSiteConfig, SkyeNotConfiguredError } from "../lib/views/viewConfig.js";

/**
 * Entry point for pages/switcher.astro. Resolves "which site / form / view
 * did this visit want" from what's already in the URL:
 *   - no siteId                       -> step 1: pick a site
 *   - siteId + ?view=<id>             -> resume that view
 *   - siteId + a formId in the hash   -> resume that form
 *   - siteId, nothing specific        -> the site's `home` if it has one,
 *                                        otherwise step 2: pick a form or view
 * Needs SOME applicationId to authenticate with (URL's ?applicationId= or a
 * deploy-configured PUBLIC_DEFAULT_APPLICATION_ID); tenantId is carried the
 * same way with a PUBLIC_DEFAULT_TENANT_ID fallback.
 */
async function main() {
  const appRoot = document.getElementById("skye-app");
  if (!appRoot) throw new Error('entry-switcher: missing "#skye-app" mount point in the page.');

  const params = new URLSearchParams(window.location.search);
  const applicationId = params.get("applicationId") ?? import.meta.env.PUBLIC_DEFAULT_APPLICATION_ID;
  if (!applicationId) {
    appRoot.innerHTML = `<p>Couldn't show the switcher: no application is configured. Set PUBLIC_DEFAULT_APPLICATION_ID or include ?applicationId= in the URL.</p>`;
    return;
  }

  const tenantId = params.get("tenantId") ?? import.meta.env.PUBLIC_DEFAULT_TENANT_ID ?? undefined;
  const siteId = params.get("siteId") ?? undefined;
  const pendingViewId = params.get("view") ?? undefined;
  const hash = window.location.hash;
  const graph = createGraphClient(applicationId, tenantId);

  // --- resume cases: the site is known and the visit already names a target ---
  if (siteId && pendingViewId) {
    window.location.assign(buildViewUrl(siteId, applicationId, tenantId, pendingViewId));
    return;
  }
  if (siteId && hashHasFormId(hash)) {
    window.location.assign(buildFormUrlForSelectedSite(siteId, applicationId, tenantId, hash));
    return;
  }

  // --- step 1: pick a site ---
  if (!siteId) {
    const sites = await graph.searchSitesWithSkyeData();
    appRoot.innerHTML = "";
    appRoot.appendChild(
      renderSiteSwitcher(
        sites,
        (site) => {
          if (pendingViewId) {
            window.location.assign(buildViewUrl(site.siteId, applicationId, tenantId, pendingViewId));
          } else if (hashHasFormId(hash)) {
            window.location.assign(buildFormUrlForSelectedSite(site.siteId, applicationId, tenantId, hash));
          } else {
            window.location.assign(buildSwitcherUrlForSite(site.siteId, applicationId, tenantId));
          }
        },
        document
      )
    );
    return;
  }

  // --- site known, nothing specific requested: honor `home`, else pick a form/view ---
  let siteConfig;
  try {
    siteConfig = resolveSiteConfig(await graph.getSkyeSiteConfigFiles(siteId));
  } catch (err) {
    if (err instanceof SkyeNotConfiguredError) {
      appRoot.innerHTML = `<div class="skye-view__message"><h1>SKYE isn't set up here yet</h1><p>This site has no skye_data/config/skye.config.json.</p></div>`;
      return;
    }
    throw err;
  }

  if (siteConfig.home) {
    window.location.assign(
      siteConfig.home.type === "view"
        ? buildViewUrl(siteId, applicationId, tenantId, siteConfig.home.id)
        : buildFormUrlForSelectedForm(siteId, applicationId, tenantId, siteConfig.home.id)
    );
    return;
  }

  const [forms, views] = await Promise.all([graph.listSkyeForms(siteId), graph.listSkyeViews(siteId)]);
  appRoot.innerHTML = "";
  appRoot.appendChild(
    renderFormOrViewPicker(
      toPickerEntries(forms, views),
      (entry) => {
        window.location.assign(
          entry.kind === "view"
            ? buildViewUrl(siteId, applicationId, tenantId, entry.id)
            : buildFormUrlForSelectedForm(siteId, applicationId, tenantId, entry.id)
        );
      },
      document
    )
  );
}

main().catch((err) => {
  console.error("entry-switcher failed:", err);
  const appRoot = document.getElementById("skye-app");
  if (appRoot) appRoot.innerHTML = `<p>Something went wrong loading the switcher. Check the console for details.</p>`;
});
