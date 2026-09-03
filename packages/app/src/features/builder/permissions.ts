import type { GraphClient } from "../../shared/sharepoint/types.js";
import { canEditFormConfigs, SkyeNotConfiguredError } from "../../shared/site-config.js";

/**
 * Whether the signed-in user may edit form configs on `siteId`. Two ways to
 * qualify, OR'd together:
 *
 *  1. **Actual write access to the `skye_data` folder** (`graph.canWriteSkyeData`
 *     — a functional probe). This is the real requirement: creating or saving
 *     a form config is a write into that folder, so anyone who can do that
 *     can use the builder. It's also what makes the builder usable on a
 *     freshly-installed site, before anyone has configured `builderEditors`.
 *  2. **Named in `skye_data/config/skye.config.json`'s `builderEditors`**
 *     (see viewConfig.ts's `canEditFormConfigs`) — kept as an explicit
 *     allowlist path / backward-compatible fallback for the config-driven
 *     grant that predates the write probe.
 *
 * A site with no SKYE config at all has no way to grant edit access, so this
 * returns false rather than throwing — both `/form`'s "Edit" button and
 * `/builder`'s own access gate treat "can't tell" the same as "no".
 */
export async function canEditFormConfig(graph: GraphClient, siteId: string): Promise<boolean> {
  if (await graph.canWriteSkyeData(siteId)) return true;
  try {
    const files = await graph.getSkyeSiteConfigFiles(siteId);
    return canEditFormConfigs(files);
  } catch (err) {
    if (err instanceof SkyeNotConfiguredError) return false;
    throw err;
  }
}
