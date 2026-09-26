import { describe, expect, it } from "vitest";
import { resolveAcpServiceTierTarget } from "./service-tier.js";
import type { AcpConfigOption } from "../wire.js";

function option(
  value: Pick<AcpConfigOption, "id" | "type"> &
    Omit<Partial<AcpConfigOption>, "id" | "type" | "options"> & {
      options?: AcpConfigOption["options"];
    },
): AcpConfigOption {
  return { ...value, options: value.options ?? [] };
}

describe("resolveAcpServiceTierTarget", () => {
  it.each([
    ["default", "false"],
    ["fast", "true"],
  ] as const)("maps Cursor's %s tier to %s", (tier, value) => {
    const target = resolveAcpServiceTierTarget(
      [
        option({
          id: "fast",
          type: "select",
          options: [{ value: "false" }, { value: "true" }],
        }),
      ],
      tier,
    );

    expect(target?.value).toBe(value);
    expect(target?.option.id).toBe("fast");
  });

  it.each([
    ["default", "off"],
    ["fast", "on"],
  ] as const)("maps Codex's %s tier to %s", (tier, value) => {
    const target = resolveAcpServiceTierTarget(
      [
        option({
          id: "fast-mode",
          type: "select",
          options: [{ value: "off" }, { value: "on" }],
        }),
      ],
      tier,
    );

    expect(target?.value).toBe(value);
    expect(target?.option.id).toBe("fast-mode");
  });

  it("prefers Codex's exact id when both known encodings are present", () => {
    const target = resolveAcpServiceTierTarget(
      [
        option({
          id: "fast",
          type: "select",
          options: [{ value: "false" }, { value: "true" }],
        }),
        option({
          id: "fast-mode",
          type: "select",
          options: [{ value: "off" }, { value: "on" }],
        }),
      ],
      "fast",
    );

    expect(target).toMatchObject({ option: { id: "fast-mode" }, value: "on" });
  });

  it("supports a boolean Codex option", () => {
    const target = resolveAcpServiceTierTarget(
      [option({ id: "fast-mode", type: "boolean" })],
      "fast",
    );

    expect(target).toMatchObject({
      option: { id: "fast-mode" },
      type: "boolean",
      value: true,
    });
  });

  it("does not guess from an unrelated or incomplete option", () => {
    expect(
      resolveAcpServiceTierTarget(
        [option({ id: "speed", type: "select", options: [{ value: "on" }] })],
        "fast",
      ),
    ).toBeUndefined();
    expect(
      resolveAcpServiceTierTarget(
        [
          option({
            id: "fast-mode",
            type: "select",
            options: [{ value: "yes" }],
          }),
        ],
        "fast",
      ),
    ).toBeUndefined();
  });
});
