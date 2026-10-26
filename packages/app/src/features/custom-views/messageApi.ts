// The host's request-dispatch surface for a mounted Custom View — every
// capability a view can reach, and nothing else. Kept free of any iframe /
// postMessage wiring so it can be unit-tested directly; viewHost.ts owns
// the transport and calls handle() per message.
//
// Security properties this file is responsible for:
//   - No write-shaped handler EXISTS. A view calling anything create/update/
//     delete-shaped gets an "unknownType" error because the capability isn't
//     here, not a checked-and-denied 403 (CUSTOM-VIEWS-SPEC.md §4.5).
//   - Every list name is checked against the site config allowlist before
//     any Graph call. The allowlist is exact-match, so a raw Graph path
//     ("/me/messages") or a traversal ("../..") can never resolve.
//   - Every query is structurally validated against the list's real column
//     schema and compiled to OData here — a view never supplies a filter
//     string (CUSTOM-VIEWS-SPEC.md §3.6, §4.3).

import type { GraphClient } from "../../shared/sharepoint/types.js";
import { compileQueryToOData } from "./compileQueryToOData.js";
import { resolveNavigation, type NavigationDecision } from "./navigationPolicy.js";
import { validateViewQuery } from "./validateViewQuery.js";
import type { SkyeSiteConfig } from "../../shared/site-config.js";
import type { ViewListResult } from "./viewQuery.js";

export interface ViewApiContext {
  siteId: string;
  applicationId: string;
  tenantId?: string;
}

/** A file a view asked the host to save to the viewer's own device — see `skye:download`. */
export interface DownloadDecision {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

export interface ViewApiDeps {
  graph: GraphClient;
  siteConfig: SkyeSiteConfig;
  ctx: ViewApiContext;
  /** The host injects the actual navigation effect (window.location / window.open). */
  navigate: (decision: NavigationDecision) => void;
  /** The host injects the actual save-to-disk effect (Blob + <a download> in the TRUSTED top page — the bytes never enter the sandboxed frame at all, unlike skye:image). */
  download: (decision: DownloadDecision) => void;
}

/** Error carrying a stable `code` the runtime surfaces to the view as `err.name`. */
export class ViewApiError extends Error {
  code: string;
  constructor(message: string, code = "Error") {
    super(message);
    this.name = "ViewApiError";
    this.code = code;
  }
}

/** A column as exposed to a view — a safe subset of GraphListColumn, renamed for the author API. */
export interface ViewSchemaColumn {
  name: string;
  label: string;
  type: string;
  required: boolean;
  choices?: string[];
}

/** id / item-id values from a view must be simple slugs (list items are numeric in SharePoint, but stay permissive of GUIDs). */
const SAFE_ITEM_ID = /^[A-Za-z0-9_-]+$/;

/**
 * A view-supplied download filename becomes a real file on the viewer's disk (see `skye:download`)
 * — no path separators, no traversal, no control characters. The browser itself also refuses to
 * write outside the downloads folder, but this stays consistent with SAFE_ITEM_ID's own
 * defense-in-depth posture elsewhere in this file rather than trusting the author string as-is.
 * Treated as a BASE name, no extension — see `extensionForContentType` below for why.
 */
const SAFE_FILENAME = /^[^/\\\0]{1,200}$/;

/**
 * A rough content-type -> file extension map for a `skye:download`ed file. The VIEW can't pick
 * this itself — by design, the resolved file's real bytes/content-type never reach the sandboxed
 * frame at all (see this handler's own doc comment), so `filename` is just a base name and the
 * host appends whichever extension actually matches what Graph returned. Unrecognized/other
 * content types get no extension rather than a guessed-wrong one.
 */
function extensionForContentType(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "application/pdf": ".pdf",
  };
  return map[contentType] ?? "";
}

/** Chunked base64 so a large image doesn't blow the call stack via String.fromCharCode(...big). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface ViewApi {
  /** True if `type` is a handled request type. */
  has(type: string): boolean;
  /** Dispatches one request. Rejects with a ViewApiError (with `.code`) on anything invalid. */
  handle(type: string, args: unknown): Promise<unknown>;
}

/**
 * Builds the dispatch table for one mounted view. `graph` is the same
 * client the rest of the app uses, so every read runs as the viewing
 * user's own delegated token and SharePoint authorizes it per-user.
 */
export function createViewApi(deps: ViewApiDeps): ViewApi {
  const { graph, siteConfig, ctx } = deps;
  const allowedLists = new Set(siteConfig.views.allowedLists);

  // Per-mount cache: schema and list-name results change rarely within a session (CUSTOM-VIEWS-SPEC.md §4.4).
  const schemaCache = new Map<string, Promise<ViewSchemaColumn[]>>();

  /** Rejects unless `name` is an exact entry in the site config's list allowlist. */
  function requireAllowedList(name: unknown): string {
    if (typeof name !== "string" || !allowedLists.has(name)) {
      throw new ViewApiError(`list "${String(name)}" is not available to this view`, "listNotAllowed");
    }
    return name;
  }

  /** Fetches (and caches) a list's columns, mapped to the view-facing shape. */
  function getSchema(name: string): Promise<ViewSchemaColumn[]> {
    let cached = schemaCache.get(name);
    if (!cached) {
      cached = graph.getListColumns(ctx.siteId, name).then((columns) =>
        columns.map((c) => ({
          name: c.name,
          label: c.displayName,
          type: c.columnType,
          required: Boolean(c.required),
          choices: c.choices,
        }))
      );
      schemaCache.set(name, cached);
    }
    return cached;
  }

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    // The lists this view may name. Pure config — no Graph call.
    "skye:lists": async () => [...allowedLists],

    // A list's column schema, safe subset.
    "skye:schema": async ({ name }) => getSchema(requireAllowedList(name)),

    // A page of list items matching a structured, validated query.
    "skye:list": async ({ name, query }) => {
      const list = requireAllowedList(name);
      const columns = await getSchema(list);
      const allowedFields = new Set(columns.map((c) => c.name));
      const validated = validateViewQuery(query, allowedFields);

      // A cursor is an opaque continuation — pass it straight through, ignore the rest.
      const page = validated.cursor
        ? await graph.searchListItems(ctx.siteId, list, { cursor: validated.cursor })
        : await graph.searchListItems(ctx.siteId, list, compileQueryToOData(validated));

      const result: ViewListResult = {
        items: page.items.map((i) => ({ id: i.id, fields: i.fields })),
        cursor: page.nextLink,
        totalCount: page.totalCount,
      };
      return result;
    },

    // One list item by id.
    "skye:item": async ({ name, id }) => {
      const list = requireAllowedList(name);
      if (typeof id !== "string" || !SAFE_ITEM_ID.test(id)) {
        throw new ViewApiError("item id must be a simple id", "badId");
      }
      const item = await graph.getListItem(ctx.siteId, list, id);
      return { id: item.id, fields: item.fields };
    },

    // An image field's bytes, as a data: URI (the only way a picture reaches an opaque-origin frame).
    "skye:image": async ({ name, id, field }) => {
      const list = requireAllowedList(name);
      if (typeof id !== "string" || !SAFE_ITEM_ID.test(id)) {
        throw new ViewApiError("item id must be a simple id", "badId");
      }
      const columns = await getSchema(list);
      if (typeof field !== "string" || !columns.some((c) => c.name === field)) {
        throw new ViewApiError(`unknown field "${String(field)}" on list "${list}"`, "unknownField");
      }
      const image = await graph.getListItemImage(ctx.siteId, list, id, field);
      return `data:${image.contentType};base64,${bytesToBase64(image.bytes)}`;
    },

    // Saves a file field's bytes to the viewer's own device — same Graph resolution as skye:image
    // (an embedded image column, or a column that just links to a file elsewhere in the site's
    // document libraries, e.g. a "poster" field storing an uploaded file's webUrl), but the bytes
    // go straight from Graph to the host's own save-as effect and are NEVER sent into the
    // sandboxed frame at all — a real download (unlike skye:image's data: URI) needs the TRUSTED
    // top page to trigger it, since a sandbox="allow-scripts" frame with no allow-downloads token
    // can't save a file on its own (and this app deliberately never adds that token — see
    // viewHost.ts's own sandbox-attribute comment).
    "skye:download": async ({ name, id, field, filename }) => {
      const list = requireAllowedList(name);
      if (typeof id !== "string" || !SAFE_ITEM_ID.test(id)) {
        throw new ViewApiError("item id must be a simple id", "badId");
      }
      const columns = await getSchema(list);
      if (typeof field !== "string" || !columns.some((c) => c.name === field)) {
        throw new ViewApiError(`unknown field "${String(field)}" on list "${list}"`, "unknownField");
      }
      if (typeof filename !== "string" || !SAFE_FILENAME.test(filename)) {
        throw new ViewApiError("filename must be a non-empty string with no path separators", "badFilename");
      }
      const image = await graph.getListItemImage(ctx.siteId, list, id, field);
      deps.download({ bytes: image.bytes, contentType: image.contentType, filename: `${filename}${extensionForContentType(image.contentType)}` });
      return { ok: true };
    },

    // Host-mediated navigation. The handler resolves the policy; the host performs the effect.
    "skye:navigate": async ({ target }) => {
      const decision = resolveNavigation(target, {
        siteId: ctx.siteId,
        applicationId: ctx.applicationId,
        tenantId: ctx.tenantId,
        allowedExternalOrigins: siteConfig.navigation.allowedExternalOrigins,
      });
      deps.navigate(decision);
      return { ok: true, kind: decision.kind };
    },
  };

  return {
    // Object.hasOwn, not `in` — otherwise "constructor" / "__proto__" / "toString"
    // would resolve to Object.prototype members and `handle` could invoke one.
    has: (type) => Object.hasOwn(handlers, type),
    handle: async (type, args) => {
      if (!Object.hasOwn(handlers, type)) throw new ViewApiError(`unknown request type: ${type}`, "unknownType");
      return handlers[type]((args ?? {}) as Record<string, unknown>);
    },
  };
}
