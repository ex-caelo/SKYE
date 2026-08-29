import type { GraphClient } from "../graph/types.js";
import { canEditFormConfigs, SkyeNotConfiguredError } from "../views/viewConfig.js";

/**
 * Whether the signed-in user may edit form configs on `siteId` — see
 * viewConfig.ts's `canEditFormConfigs` for the actual rule
 * (`skye_data/config/skye.config.json`'s `builderEditors` list, checked
 * against which `[permission]` overlay folders this user can currently
 * read). A site with no SKYE config at all has no way to grant edit access,
 * so this returns false rather than throwing — both `/form`'s "Edit"
 * button and `/builder`'s own access gate treat "can't tell" the same as
 * "no".
 */
export async function canEditFormConfig(graph: GraphClient, siteId: string): Promise<boolean> {
  try {
    const files = await graph.getSkyeSiteConfigFiles(siteId);
    return canEditFormConfigs(files);
  } catch (err) {
    if (err instanceof SkyeNotConfiguredError) return false;
    throw err;
  }
}
