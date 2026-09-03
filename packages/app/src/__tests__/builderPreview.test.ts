import { describe, it, expect, vi } from "vitest";
import type { FormConfig } from "@skye/form-config";
import { renderBuilderPreview } from "../features/builder/builderPreview.js";
import type { GraphClient } from "../shared/sharepoint/types.js";

function makeGraphStub(): GraphClient {
  return {
    searchPeople: vi.fn().mockResolvedValue([]),
    searchLookupItems: vi.fn().mockResolvedValue([]),
  } as unknown as GraphClient;
}

function makeConfig(): FormConfig {
  return {
    title: "Preview form",
    list: { id: "list1" },
    pages: { main: { title: "Main", order: 1 }, second: { title: "Second", order: 2 } },
    fields: {
      name: { page: "main", source: "sharepoint", bindTo: "Title", controlType: "text", label: "Name" },
    },
  };
}

describe("renderBuilderPreview", () => {
  it("hides the submit button — this is a preview, not a real submission surface", () => {
    const preview = renderBuilderPreview(makeConfig(), document, makeGraphStub(), "site1", () => {});
    const submitBtn = preview.root.querySelector(".skye-form__submit") as HTMLButtonElement;
    expect(submitBtn.style.display).toBe("none");
  });

  it("clicking a rendered field's control calls onSelectField with that field's key", () => {
    const selected: string[] = [];
    const preview = renderBuilderPreview(makeConfig(), document, makeGraphStub(), "site1", (key) => selected.push(key));
    const control = preview.root.querySelector('[data-field-key="name"]') as HTMLElement;
    control.dispatchEvent(new Event("click", { bubbles: true }));
    expect(selected).toEqual(["name"]);
  });

  it("clicking outside any field does not call onSelectField", () => {
    const selected: string[] = [];
    const preview = renderBuilderPreview(makeConfig(), document, makeGraphStub(), "site1", (key) => selected.push(key));
    preview.root.dispatchEvent(new Event("click", { bubbles: true }));
    expect(selected).toEqual([]);
  });

  it("defaults to the first page, and getActivePageKey reflects it", () => {
    const preview = renderBuilderPreview(makeConfig(), document, makeGraphStub(), "site1", () => {});
    expect(preview.getActivePageKey()).toBe("main");
  });

  it("honors an initialPageKey so a rebuilt preview can restore where the author was", () => {
    const preview = renderBuilderPreview(makeConfig(), document, makeGraphStub(), "site1", () => {}, "second");
    expect(preview.getActivePageKey()).toBe("second");
    const secondPage = preview.root.querySelector('.skye-form__page[data-page-key="second"]') as HTMLElement;
    expect(secondPage.style.display).toBe("grid");
  });

  it("falls back to the first page when initialPageKey doesn't name a real page (e.g. that page was just deleted)", () => {
    const preview = renderBuilderPreview(makeConfig(), document, makeGraphStub(), "site1", () => {}, "doesNotExist");
    expect(preview.getActivePageKey()).toBe("main");
  });
});
