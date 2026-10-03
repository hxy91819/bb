import { describe, expect, it } from "vitest";
import {
  appSettingsSchema,
  appSettingsUpdateSchema,
  defaultAppSettings,
  managedBranchPrefixSchema,
  MANAGED_BRANCH_PREFIX_MAX_LENGTH,
} from "../src/app-settings.js";

describe("managedBranchPrefixSchema", () => {
  it("accepts prefixes that start a valid branch name", () => {
    for (const prefix of ["bb/", "", "sawyer/wt-", "team/bb/", "wip_"]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(true);
    }
  });

  it("rejects prefixes that cannot start a valid branch name", () => {
    for (const prefix of [
      " bb/",
      "bb //",
      "-bb/",
      "/bb/",
      "bb//",
      "bb../",
      "bb:",
      "bb~",
      "bb\\",
      "bb@{",
      ".bb/",
      "a".repeat(MANAGED_BRANCH_PREFIX_MAX_LENGTH + 1),
    ]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(false);
    }
  });

  it("defaults to the bb namespace", () => {
    expect(defaultAppSettings.managedBranchPrefix).toBe("bb/");
    expect(appSettingsSchema.parse(defaultAppSettings)).toEqual(
      defaultAppSettings,
    );
  });
});

describe("hiddenProviders", () => {
  it("defaults to an empty list that keeps every provider visible", () => {
    expect(defaultAppSettings.hiddenProviders).toEqual([]);
    expect(appSettingsSchema.parse(defaultAppSettings)).toEqual(
      defaultAppSettings,
    );
  });

  it("accepts provider ids independently of providerOrder", () => {
    const parsed = appSettingsSchema.parse({
      ...defaultAppSettings,
      providerOrder: ["codex", "claude-code"],
      hiddenProviders: ["acp-cursor"],
    });
    expect(parsed.hiddenProviders).toEqual(["acp-cursor"]);
    expect(parsed.providerOrder).toEqual(["codex", "claude-code"]);
  });

  it("rejects empty ids and non-string entries", () => {
    expect(
      appSettingsSchema.safeParse({
        ...defaultAppSettings,
        hiddenProviders: [""],
      }).success,
    ).toBe(false);
    expect(
      appSettingsSchema.safeParse({
        ...defaultAppSettings,
        hiddenProviders: [42],
      }).success,
    ).toBe(false);
  });

  it("lets older clients omit hiddenProviders from a full settings update", () => {
    const { hiddenProviders, ...legacyPayload } = defaultAppSettings;
    expect(hiddenProviders).toEqual([]);
    expect(appSettingsUpdateSchema.safeParse(legacyPayload).success).toBe(true);
    expect(
      appSettingsUpdateSchema.safeParse({
        ...legacyPayload,
        showUnhandledProviderEvents: false,
      }).success,
    ).toBe(true);
  });
});
