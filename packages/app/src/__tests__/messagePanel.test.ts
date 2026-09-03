import { describe, it, expect, afterEach } from "vitest";
import { showMessagePanel } from "../shared/ui/messagePanel.js";
import { mountComponents } from "./helpers/astroFixture.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("showMessagePanel", () => {
  it("reveals the panel, tags it with the level, and fills title/body from the .astro skeleton", () => {
    const root = mountComponents("MessagePanel");
    const panel = showMessagePanel(root, "error", "You don't have edit permission", "Ask a site admin for access.");
    expect(panel.hidden).toBe(false);
    expect(panel.dataset.level).toBe("error");
    expect(panel.querySelector("h1")?.textContent).toBe("You don't have edit permission");
    expect(panel.querySelector("p")?.textContent).toBe("Ask a site admin for access.");
  });

  it("hides any other [data-state] section on the same root", () => {
    const root = mountComponents("MessagePanel");
    const other = document.createElement("section");
    other.id = "state-other";
    other.setAttribute("data-state", "");
    root.appendChild(other);

    showMessagePanel(root, "info", "t", "b");
    expect(other.hidden).toBe(true);
  });
});
