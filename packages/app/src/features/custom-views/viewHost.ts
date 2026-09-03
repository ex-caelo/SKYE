// The trusted host for a Custom View. Runs on SKYE's own origin, holds
// nothing secret in the frame, and is the only code that talks to Graph on
// the view's behalf. Ported from the prototype's skye-host.js — the
// isolation model is unchanged and must stay that way (CUSTOM-VIEWS-SPEC.md
// §3). Differences from the prototype: view files come from GraphClient
// (not same-origin fetch), and there is no fake token in localStorage — the
// parent page already holds the real MSAL session and the frame can only
// message it.

import type { GraphClient } from "../../shared/sharepoint/types.js";
import { createViewApi, type ViewApiContext } from "./messageApi.js";
import type { NavigationDecision } from "./navigationPolicy.js";
import type { SkyeSiteConfig } from "../../shared/site-config.js";
import runtimeSource from "./view-runtime.js?raw";
import viewCss from "./view.css?raw";

/** Watchdog cadence. Higher than the prototype's 4s so a genuinely slow (not hung) dashboard render isn't killed (CUSTOM-VIEWS-SPEC.md §4.6). */
const WATCHDOG_INTERVAL_MS = 15_000;
/** Token-bucket rate limit for view→host requests, so a call-spamming view can't degrade the host page (§4.6). */
const RATE_CAPACITY = 24;
const RATE_REFILL_PER_SEC = 12;

export interface MountViewOptions {
  /** Where the frame + status line are appended. */
  container: HTMLElement;
  graph: GraphClient;
  siteConfig: SkyeSiteConfig;
  viewId: string;
  ctx: ViewApiContext;
  /** Optional hook for surfacing teardown reasons / status to the page. */
  onStatus?: (message: string, level: "info" | "error") => void;
}

export interface MountedView {
  /** Tears the view down (stops the watchdog, closes the port, removes the frame). Safe to call more than once. */
  teardown: (why?: string) => void;
}

/**
 * Mounts one Custom View into `container`. The returned handle's teardown()
 * should be called if the page navigates away or wants to swap views.
 */
export async function mountView(opts: MountViewOptions): Promise<MountedView> {
  const { container, graph, siteConfig, viewId, ctx, onStatus } = opts;

  const status = document.createElement("div");
  status.className = "skye-view__status";
  status.setAttribute("role", "status");
  status.textContent = "Loading view…";
  container.appendChild(status);

  // Fetch the view's files first — but hold them until the handshake proves the wall is up.
  const source = await graph.getSkyeViewFiles(ctx.siteId, viewId);

  let frame: HTMLIFrameElement | null = document.createElement("iframe");
  let port: MessagePort | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let alive = false;

  // Token bucket for rate limiting.
  let tokens = RATE_CAPACITY;
  let lastRefill = Date.now();
  function takeToken(): boolean {
    const now = Date.now();
    tokens = Math.min(RATE_CAPACITY, tokens + ((now - lastRefill) / 1000) * RATE_REFILL_PER_SEC);
    lastRefill = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }

  function teardown(why?: string): void {
    if (watchdog) clearInterval(watchdog);
    window.removeEventListener("message", onHandshake);
    port?.close();
    frame?.remove();
    port = null;
    watchdog = null;
    frame = null;
    if (why) {
      status.textContent = `⚠ ${why}`;
      status.dataset.level = "error";
      console.warn(`[skye-view] ${why}`);
      onStatus?.(why, "error");
    }
  }

  // The API — every capability the view has. Navigation effects happen here,
  // in the host, never inside the frame.
  const api = createViewApi({
    graph,
    siteConfig,
    ctx,
    navigate: (decision: NavigationDecision) => {
      if (decision.kind === "internal") {
        window.location.assign(decision.url);
      } else {
        // New tab, fully severed from this page — the SKYE app is never navigated away.
        window.open(decision.url, "_blank", "noopener,noreferrer");
      }
    },
  });

  async function onRequest(e: MessageEvent): Promise<void> {
    const { type, id, args } = (e.data ?? {}) as { type?: string; id?: number; args?: unknown };
    if (!type) return;

    if (type === "skye:pong") {
      alive = true;
      return;
    }
    if (type === "skye:report") {
      // Demo-only: the security-probes view reports verdicts out here because a
      // navigation probe destroys the frame either way.
      const r = (args ?? {}) as { label?: string; verdict?: string; ok?: boolean };
      if (r.verdict) console[r.ok ? "log" : "error"](`[probe] ${r.label} : ${r.verdict}`);
      return;
    }

    // Everything past here is a real request expecting a reply keyed by `id`.
    if (!takeToken()) {
      port?.postMessage({ id, error: "too many requests", code: "429" });
      return;
    }

    try {
      const result = await api.handle(type, args);
      port?.postMessage({ id, result });
    } catch (err) {
      const e2 = err as { message?: string; code?: string };
      port?.postMessage({ id, error: e2.message ?? "request failed", code: e2.code ?? "Error" });
    }
  }

  function watchdogTick(): void {
    if (!alive) return teardown("view stopped responding (hung, or navigated away)");
    alive = false;
    port?.postMessage({ type: "skye:ping" });
  }

  // Handshake: the frame says hello, we prove the wall is there, then it gets a port and its source.
  const mine = frame;
  function onHandshake(e: MessageEvent): void {
    // Identify by source, not origin — a sandboxed frame's origin is the literal string "null".
    if (!frame || e.source !== frame.contentWindow) return;
    if ((e.data as { type?: string })?.type !== "skye:hello" || port) return;

    // Fail closed. srcdoc on its own is SAME-ORIGIN with us; the sandbox attribute is the only
    // thing making it opaque. Reading .document on a cross-origin window throws — that throw IS
    // the wall. If it does NOT throw, the boundary is missing and we refuse to run the view.
    try {
      void (frame.contentWindow as Window).document;
      return teardown("sandbox boundary missing — refusing to run this view");
    } catch {
      /* SecurityError: good, the frame really is opaque-origin */
    }

    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = onRequest;

    // "*" is unavoidable — you cannot target an opaque origin — so this message carries nothing
    // but the port. The port is bound to this document: if the view navigates itself away,
    // whatever lands there never had it.
    frame.contentWindow!.postMessage({ type: "skye:port" }, "*", [channel.port2]);
    port.postMessage({ type: "skye:mount", ...source });

    alive = true;
    watchdog = setInterval(watchdogTick, WATCHDOG_INTERVAL_MS);
    status.textContent = "";
  }
  window.addEventListener("message", onHandshake);

  // The first load is the srcdoc's own; any load after it is the view moving itself
  // (whether the navigation succeeded or the top page's frame-src blocked it).
  let loads = 0;
  frame.addEventListener("load", () => {
    if (++loads > 1 && frame === mine) teardown("view navigated itself away");
  });

  // NEVER add allow-same-origin (with allow-scripts it hands the frame our real origin and lets
  // it rewrite this very attribute). No allow-popups / allow-forms / allow-top-navigation* either.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.className = "skye-view__frame";

  // Nothing author-written goes into this string — only the CSP meta, SKYE's own CSS, and SKYE's
  // own runtime, so untrusted text never reaches the HTML parser. Nothing of OURS that's sensitive
  // goes in either: the view can read its own document.
  //
  // default-src 'none' kills fetch, XHR, WebSocket, and remote images. The exceptions are
  // deliberate: 'unsafe-inline' permits the runtime, 'unsafe-eval' lets it run the author's code
  // via AsyncFunction, and img-src data: is not an exfil channel because a data: URI makes no request.
  frame.srcdoc = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:">
<style>${viewCss}</style>
<script>${runtimeSource}</script>`;

  container.appendChild(frame);

  return { teardown };
}
