import { describe, it, expect } from "vitest";
import { interpolate, type FormConfig, type TemplateContext } from "@skye/form-config";
import adminConfig from "../../../../skye_data/forms/luddy-llc-event-proposal/admin/form.config.json" with { type: "json" };

/**
 * Pins the Luddy approve page's field defaults (see form.config.json) to the
 * real templating engine, so an edit to either default that breaks how it
 * resolves fails here, not on a live approve click.
 */
const fields = (adminConfig as unknown as FormConfig).fields;

describe("luddy admin approval page field defaults", () => {
  const ctx: TemplateContext = {
    fields: { host: ["host@iu.edu"], cohosts: ["c1@iu.edu", "c2@iu.edu"] },
    item: {},
    results: {},
    currentUser: { email: "viewer@iu.edu" },
  };

  it("hostEmail defaults to the signed-in viewer's email", () => {
    expect(interpolate(fields.hostEmail.defaultValue, ctx)).toBe("viewer@iu.edu");
  });

  it("reviewer defaults to the viewer plus the host and all cohosts", () => {
    expect(interpolate(fields.reviewer.defaultValue, ctx)).toEqual([
      "viewer@iu.edu",
      "host@iu.edu",
      "c1@iu.edu",
      "c2@iu.edu",
    ]);
  });
});
