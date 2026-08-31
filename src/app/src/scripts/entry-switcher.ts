import { createGraphClient } from "../lib/graph/createGraphClient.js";
import {
  populateSitePicker,
  populateFormOrViewPicker,
  wireAddSitePanel,
  fillPermissionsStep,
  wireCreateSiteAssetsStep,
  buildLibraryPermissionsUrl,
  buildFolderPermissionsUrl,
  buildCreateSiteAssetsUrl,
  toPickerEntries,
  type StepReporter,
} from "../lib/routing/siteSwitcher.js";
import { showConfirmDialog } from "../lib/ui/confirmDialog.js";
import { showState } from "../lib/ui/pageState.js";
import { ensureInvokerCommands } from "../lib/ui/invokers.js";
import { SkyeInstallError, type SiteResult } from "../lib/graph/types.js";
import {
  buildFormUrlForSelectedSite,
  buildFormUrlForSelectedForm,
  buildSwitcherUrlForSite,
  buildViewUrl,
  buildBuilderUrl,
  hashHasFormId,
} from "../lib/routing/router.js";
import { resolveSiteConfig, canEditFormConfigs, SkyeNotConfiguredError } from "../lib/views/viewConfig.js";
import { getCachedTenantId } from "../lib/auth/tenantResolver.js";
import { completeRedirectReturn } from "../lib/auth/redirectReturn.js";

/**
 * Entry point for pages/switcher.astro. Resolves "which site / form / view
 * did this visit want" from what's already in the URL:
 *   - no siteId                       -> step 1: pick a site
 *   - siteId + ?view=<id>             -> resume that view
 *   - siteId + a formId in the hash   -> resume that form
 *   - siteId, nothing specific        -> the site's `home` if it has one,
 *                                        otherwise step 2: pick a form or view
 * All screen markup lives in switcher.astro / its components; this script
 * reveals one screen at a time (`showState`) and fills its data-driven
 * parts. Needs SOME applicationId (URL's ?applicationId= or a
 * deploy-configured PUBLIC_DEFAULT_APPLICATION_ID); tenantId is carried the
 * same way with a PUBLIC_DEFAULT_TENANT_ID fallback.
 */
async function main() {
  // Landing back from an MSAL loginRedirect? Finish it and bounce to the pre-redirect URL
  // (which still has ?applicationId=/?tenantId=) before anything here needs them.
  if (await completeRedirectReturn()) return;

  await ensureInvokerCommands();

  const appRoot = document.getElementById("skye-app");
  if (!appRoot) throw new Error('entry-switcher: missing "#skye-app" mount point in the page.');

  const params = new URLSearchParams(window.location.search);
  const applicationId = params.get("applicationId") ?? import.meta.env.PUBLIC_DEFAULT_APPLICATION_ID;
  if (!applicationId) {
    showState(appRoot, "state-config-missing");
    return;
  }

  // URL → PUBLIC_DEFAULT_TENANT_ID → a tenant id a previous sign-in on this browser cached
  // (see lib/auth/tenantResolver.ts); else auth uses /common and self-heals for single-tenant apps.
  const tenantId = params.get("tenantId") ?? import.meta.env.PUBLIC_DEFAULT_TENANT_ID ?? getCachedTenantId(applicationId) ?? undefined;
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

  // Where a chosen site goes next: resume a pending view/form, else the site's form/view picker.
  const goToSite = (chosenSiteId: string) => {
    if (pendingViewId) {
      window.location.assign(buildViewUrl(chosenSiteId, applicationId, tenantId, pendingViewId));
    } else if (hashHasFormId(hash)) {
      window.location.assign(buildFormUrlForSelectedSite(chosenSiteId, applicationId, tenantId, hash));
    } else {
      window.location.assign(buildSwitcherUrlForSite(chosenSiteId, applicationId, tenantId));
    }
  };

  // --- step 1: pick a site (or set SKYE up on a new one) ---
  if (!siteId) {
    const sites = await graph.searchSitesWithSkyeData();
    const section = showState(appRoot, "step-site-picker");
    populateSitePicker(section, sites, (site) => goToSite(site.siteId));

    // After a successful install: show the permissions guidance, then continue into the site.
    // The link targets the skye_data FOLDER's permissions when we have its item id, else the
    // whole library, else nothing.
    const showPermissions = (site: SiteResult, result: { libraryListId: string | null; skyeDataItemId: string | null; libraryName: string }) => {
      const manageAccessUrl =
        result.libraryListId && result.skyeDataItemId
          ? buildFolderPermissionsUrl(site.webUrl, result.libraryListId, result.skyeDataItemId)
          : result.libraryListId
            ? buildLibraryPermissionsUrl(site.webUrl, result.libraryListId)
            : null;
      fillPermissionsStep(showState(appRoot, "step-permissions"), {
        siteName: site.displayName,
        libraryName: result.libraryName,
        manageAccessUrl,
        onContinue: () => goToSite(site.siteId),
      });
    };

    // Runs installSkyeSiteConfig, reporting progress/errors through `reporter`. Resolves "assetsMissing"
    // for the one case the caller has to handle specially; every other error is shown via `reporter`.
    const runInstall = async (site: SiteResult, reporter: StepReporter): Promise<"done" | "assetsMissing"> => {
      reporter.setBusy(true);
      reporter.setStatus(`Setting up SKYE on ${site.displayName}…`);
      try {
        showPermissions(site, await graph.installSkyeSiteConfig(site.siteId));
        return "done";
      } catch (err) {
        if (err instanceof SkyeInstallError && err.kind === "siteAssetsMissing") return "assetsMissing";
        console.error("set-up-a-new-site failed:", err);
        reporter.setStatus(err instanceof SkyeInstallError ? err.message : "Something went wrong setting up that site. Check the console for details.", "error");
        reporter.setBusy(false);
        return "done";
      }
    };

    // The "create Site Assets in SharePoint, then retry" step, with a short auto-poll.
    const showCreateAssetsStep = (site: SiteResult) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      let polls = 0;
      let inFlight = false;

      const step = wireCreateSiteAssetsStep(showState(appRoot, "step-create-assets"), {
        siteName: site.displayName,
        createUrl: buildCreateSiteAssetsUrl(site.webUrl),
        onCancel: () => {
          if (timer) clearInterval(timer);
          window.location.reload();
        },
        onRetry: () => void check(),
      });

      const check = async () => {
        if (inFlight) return;
        inFlight = true;
        const outcome = await runInstall(site, step);
        inFlight = false;
        if (outcome === "assetsMissing") {
          step.setStatus("Still no Site Assets library. Give SharePoint a moment after adding a page, then check again.", "error");
          step.setBusy(false);
        } else if (timer) {
          clearInterval(timer); // "done" — either navigated on, or an error is shown
        }
      };

      timer = setInterval(() => {
        if (++polls > 6) {
          clearInterval(timer);
          return;
        }
        void check();
      }, 5000);
    };

    // "Set up SKYE on another site" — resolve the pasted URL/Teams link, confirm, install.
    const panel = wireAddSitePanel(section, async (siteUrl) => {
      panel.setBusy(true);
      panel.setStatus("Checking that site…");
      const site = await graph.resolveSiteByUrl(siteUrl);
      if (!site) {
        panel.setStatus("Couldn't reach that site. Check the URL, or ask a SharePoint admin to grant SKYE access to it.", "error");
        panel.setBusy(false);
        return;
      }

      if (await graph.hasSkyeConfig(site.siteId)) {
        panel.setStatus(`SKYE is already set up on ${site.displayName}. Opening…`, "success");
        goToSite(site.siteId);
        return;
      }

      const choice = await showConfirmDialog(document, {
        title: `Set up SKYE on ${site.displayName}?`,
        body: "This creates a skye_data folder and a starter configuration file in the site's Site Assets library. You can change everything afterwards.",
        options: [
          { label: "Cancel", value: "cancel" },
          { label: "Set it up", value: "install", primary: true },
        ],
      });
      if (choice !== "install") {
        panel.setStatus("");
        panel.setBusy(false);
        return;
      }

      if ((await runInstall(site, panel)) === "assetsMissing") showCreateAssetsStep(site);
    });
    return;
  }

  // --- site known, nothing specific requested: honor `home`, else pick a form/view ---
  let siteConfig;
  let canBuild = false;
  try {
    const configFiles = await graph.getSkyeSiteConfigFiles(siteId);
    siteConfig = resolveSiteConfig(configFiles);
    // Gates the "Create New Form Config" button — shown when the user can actually write into
    // skye_data (so a Save would succeed), or is named in builderEditors. Same rule /builder's gate uses.
    canBuild = (await graph.canWriteSkyeData(siteId)) || canEditFormConfigs(configFiles);
  } catch (err) {
    if (err instanceof SkyeNotConfiguredError) {
      showState(appRoot, "state-not-set-up");
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
  populateFormOrViewPicker(
    showState(appRoot, "step-form-or-view-picker"),
    toPickerEntries(forms, views),
    (entry) => {
      window.location.assign(
        entry.kind === "view"
          ? buildViewUrl(siteId, applicationId, tenantId, entry.id)
          : buildFormUrlForSelectedForm(siteId, applicationId, tenantId, entry.id)
      );
    },
    canBuild ? () => window.location.assign(buildBuilderUrl(siteId, applicationId, tenantId)) : undefined
  );
}

main().catch((err) => {
  console.error("entry-switcher failed:", err);
  const appRoot = document.getElementById("skye-app");
  if (!appRoot) return;
  try {
    showState(appRoot, "state-error");
  } catch {
    appRoot.textContent = "Something went wrong loading the switcher. Check the console for details.";
  }
});
