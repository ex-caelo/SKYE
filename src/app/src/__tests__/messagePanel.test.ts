import { describe, it, expect } from "vitest";
import { renderMessagePanel } from "../lib/ui/messagePanel.js";

describe("renderMessagePanel", () => {
  it("renders the title/body and tags the panel with the given level", () => {
    const el = renderMessagePanel("error", "You don't have edit permission", "Ask a site admin for access.", document);
    expect(el.dataset.level).toBe("error");
    expect(el.querySelector("h1")?.textContent).toBe("You don't have edit permission");
    expect(el.querySelector("p")?.textContent).toBe("Ask a site admin for access.");
  });
});
