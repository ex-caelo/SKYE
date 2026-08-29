import { describe, it, expect } from "vitest";
import { mergeConfig } from "../merge/mergeConfig.js";
import type { FormConfig } from "../schema/types.js";

const base: FormConfig = {
  title: "Base title",
  list: { id: "list-1" },
  pages: { aboutYou: { title: "About you", order: 1 } },
  fields: {
    name: { page: "aboutYou", source: "sharepoint", bindTo: "Title", controlType: "text", required: true },
    price: { page: "aboutYou", source: "sharepoint", bindTo: "Price", controlType: "currency", readonly: true },
  },
};

describe("mergeConfig", () => {
  it("adds a new page/field from an overlay without touching existing ones", () => {
    const { config, nullValueErrors } = mergeConfig(base, {
      pages: { adminReview: { title: "Admin review", order: 2 } },
      fields: { staffNotes: { page: "adminReview", source: "sharepoint", bindTo: "Staff", controlType: "peoplePicker" } },
    });

    expect(nullValueErrors).toHaveLength(0);
    expect(config.pages.aboutYou.title).toBe("About you"); // untouched
    expect(config.pages.adminReview.title).toBe("Admin review"); // added
    expect(config.fields.name).toEqual(base.fields.name); // untouched
    expect(config.fields.staffNotes.controlType).toBe("peoplePicker"); // added
  });

  it("loosens an existing constraint (readonly: true -> false)", () => {
    const { config } = mergeConfig(base, { fields: { price: { readonly: false } } });
    expect(config.fields.price.readonly).toBe(false);
    expect(config.fields.price.bindTo).toBe("Price"); // rest of the field survives the patch
  });

  it("applies multiple overlays in order, later overlays winning on shared keys", () => {
    const { config } = mergeConfig(
      base,
      { title: "Editor title" },
      { title: "Admin title" }
    );
    expect(config.title).toBe("Admin title");
  });

  it("treats a literal null as a disallowed delete: records an error and keeps the base value", () => {
    const { config, nullValueErrors } = mergeConfig(base, {
      // @ts-expect-error deliberately testing the disallowed shape
      fields: { name: { required: null } },
    });
    expect(nullValueErrors).toContain("fields.name.required");
    expect(config.fields.name.required).toBe(true); // base value preserved, not deleted
  });
});
