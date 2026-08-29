import { test, expect, type Frame } from "@playwright/test";

/** Waits for the sandboxed view frame to attach and returns it. */
async function viewFrame(page: import("@playwright/test").Page): Promise<Frame> {
  const handle = await page.waitForSelector("iframe.skye-view__frame", { timeout: 30_000 });
  const frame = await handle.contentFrame();
  if (!frame) throw new Error("view iframe has no content frame");
  return frame;
}

test.describe("Custom View sandbox", () => {
  test("the calendar demo view mounts and renders inside the frame", async ({ page }) => {
    await page.goto("/view?siteId=x&applicationId=x#calendar");
    const frame = await viewFrame(page);
    await expect(frame.locator(".grid .cell").first()).toBeVisible({ timeout: 30_000 });
    // A clean mount clears the host status line (a teardown reason would set it).
    await expect(page.locator(".skye-view__status")).toHaveText("", { timeout: 30_000 });
  });

  test("every security probe reports BLOCKED", async ({ page }) => {
    // The host logs every probe verdict as `[probe] <label> : <verdict>` —
    // that's the source of truth, since the final navigation probes can tear
    // the frame down before it can render its own summary.
    const verdicts: string[] = [];
    page.on("console", (m) => {
      const t = m.text();
      if (t.startsWith("[probe]") && t.includes(" : ")) verdicts.push(t);
    });

    await page.goto("/view?siteId=x&applicationId=x#security-probes");

    // Wait for the full battery to have reported.
    await expect.poll(() => verdicts.length, { timeout: 45_000, message: "probe verdicts" }).toBeGreaterThan(18);
    await page.waitForTimeout(1500); // let any stragglers land

    const leaked = verdicts.filter((v) => v.includes("LEAKED"));
    expect(leaked, `leaked probes:\n${leaked.join("\n")}`).toEqual([]);
    expect(verdicts.every((v) => v.includes("BLOCKED"))).toBe(true);
  });

  test("the host refuses to hand a view its port if the sandbox attribute is stripped", async ({ page }) => {
    // Deterministically prevent the host from ever sandboxing its frame. That
    // makes the srcdoc frame same-origin, so the host's fail-closed
    // `contentWindow.document` read succeeds instead of throwing — and the
    // view must be torn down with a clear reason rather than run.
    await page.addInitScript(() => {
      const original = HTMLIFrameElement.prototype.setAttribute;
      HTMLIFrameElement.prototype.setAttribute = function (name: string, value: string) {
        if (name.toLowerCase() === "sandbox") return;
        return original.call(this, name, value);
      };
    });

    await page.goto("/view?siteId=x&applicationId=x#calendar");
    await expect(page.locator(".skye-view__status")).toContainText("sandbox boundary missing", { timeout: 30_000 });
  });
});
