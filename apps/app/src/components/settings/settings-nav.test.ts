import { describe, expect, it } from "vitest";
import {
  useSettingsNavSections,
  resolveSettingsRoute,
} from "./settings-nav";

describe("resolveSettingsRoute", () => {
  it.each([
    {
      pathname: "/settings/providers",
      activeSection: "providers",
      hasUnknownSection: false,
    },
    {
      pathname: "/settings/archived",
      activeSection: "archived",
      hasUnknownSection: false,
    },
    {
      pathname: "/settings/plugins",
      activeSection: "plugins",
      hasUnknownSection: false,
    },
  ])("resolves $pathname", ({ pathname, ...expected }) => {
    expect(resolveSettingsRoute({ pathname, search: "" })).toMatchObject(
      expected,
    );
  });
});

describe("useSettingsNavSections", () => {
  it("offers remote SSH file settings without a local helper", () => {
    expect(useSettingsNavSections().map(({ id }) => id)).toContain("files");
  });
});
