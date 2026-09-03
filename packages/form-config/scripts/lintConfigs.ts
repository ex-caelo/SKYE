// CLI entry point for `pnpm lint:configs`.
//
// Walks a local checkout of `skye_data/forms/` (e.g. a synced copy of the
// SharePoint document library, or a git-tracked mirror used for review) and
// for every form:
//   1. Validates form.config.json against the JSON Schema.
//   2. For every [permission] subfolder, validates its overlay against the
//      schema too, then lints it against the base config for additive-only
//      compliance (see lintOverlay.ts).
//   3. Also checks the one thing the schema itself can't express: every
//      gridTemplateAreas row has the same token count as gridTemplateColumns.
//
// Usage: pnpm lint:configs -- <path-to-skye_data-forms-directory>
// Exits non-zero if any schema violation or additive-only error is found,
// so this is CI-friendly.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import type { FormConfig } from "../src/schema/types.js";
import { lintOverlay } from "../src/merge/lintOverlay.js";

const SCHEMA_PATH = new URL("../src/schema/form.config.schema.json", import.meta.url);
const OVERLAY_SCHEMA_PATH = new URL("../src/schema/form.config.overlay.schema.json", import.meta.url);

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Checks the one cross-field consistency rule JSON Schema can't express: every gridTemplateAreas row needs the same number of space-separated tokens as gridTemplateColumns defines. */
function lintGridConsistency(config: FormConfig, formLabel: string): string[] {
  const issues: string[] = [];
  const formCols = config.layout?.gridTemplateColumns ?? 12;
  const formColCount = typeof formCols === "number" ? formCols : formCols.trim().split(/\s+/).length;

  for (const [pageKey, page] of Object.entries(config.pages)) {
    const pageCols = page.layout?.gridTemplateColumns ?? formCols;
    const expectedCount = typeof pageCols === "number" ? pageCols : pageCols.trim().split(/\s+/).length;
    const areas = page.layout?.gridTemplateAreas ?? [];

    areas.forEach((row, i) => {
      const tokenCount = row.trim().split(/\s+/).length;
      if (tokenCount !== expectedCount) {
        issues.push(
          `${formLabel} page "${pageKey}" gridTemplateAreas row ${i} has ${tokenCount} tokens, expected ${expectedCount} (from gridTemplateColumns).`
        );
      }
    });
  }

  // Fall through to formColCount only referenced for clarity above; suppress unused warning if column count matches default path.
  void formColCount;
  return issues;
}

async function main() {
  const rootDir = process.argv[2];
  if (!rootDir) {
    console.error("Usage: pnpm lint:configs -- <path-to-skye_data-forms-directory>");
    process.exit(2);
  }

  // fileURLToPath (not `.pathname`, which leaves percent-encoding like %20 for spaces intact and
  // isn't a valid filesystem path) — this broke on any checkout under a directory with a space.
  const schema = loadJson(fileURLToPath(SCHEMA_PATH));
  const overlaySchema = loadJson(fileURLToPath(OVERLAY_SCHEMA_PATH));
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(schema as object); // registered under its own $id; the overlay schema's relative $refs resolve against that same $id
  const validate = ajv.getSchema((schema as { $id: string }).$id)!;
  const validateOverlay = ajv.compile(overlaySchema as object);

  let hadErrors = false;
  const formIds = readdirSync(rootDir).filter((name) => statSync(join(rootDir, name)).isDirectory());

  for (const formId of formIds) {
    const basePath = join(rootDir, formId, "form.config.json");
    let base: FormConfig;
    try {
      base = loadJson(basePath) as FormConfig;
    } catch (err) {
      console.error(`[${formId}] Could not read/parse base config: ${(err as Error).message}`);
      hadErrors = true;
      continue;
    }

    if (!validate(base)) {
      console.error(`[${formId}] Base config fails schema validation:`);
      console.error(validate.errors);
      hadErrors = true;
    }

    for (const gridIssue of lintGridConsistency(base, `[${formId}]`)) {
      console.error(gridIssue);
      hadErrors = true;
    }

    const entries = readdirSync(join(rootDir, formId), { withFileTypes: true });
    const permissionFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    for (const permission of permissionFolders) {
      const overlayPath = join(rootDir, formId, permission, "form.config.json");
      let overlay: Partial<FormConfig>;
      try {
        overlay = loadJson(overlayPath) as Partial<FormConfig>;
      } catch (err) {
        console.error(`[${formId}/${permission}] Could not read/parse overlay: ${(err as Error).message}`);
        hadErrors = true;
        continue;
      }

      if (!validateOverlay(overlay)) {
        console.error(`[${formId}/${permission}] Overlay fails schema validation:`);
        console.error(validateOverlay.errors);
        hadErrors = true;
      }

      const additiveIssues = lintOverlay(base, overlay);
      for (const issue of additiveIssues) {
        const line = `[${formId}/${permission}] (${issue.severity}) ${issue.path}: ${issue.message}`;
        if (issue.severity === "error") {
          console.error(line);
          hadErrors = true;
        } else {
          console.warn(line);
        }
      }
    }
  }

  if (hadErrors) {
    console.error("\nlint:configs found errors — see above.");
    process.exit(1);
  }
  console.log(`lint:configs OK — checked ${formIds.length} form(s).`);
}

main();
