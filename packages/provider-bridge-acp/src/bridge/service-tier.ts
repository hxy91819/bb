import type { ServiceTier } from "@bb/domain";
import type { AcpConfigOption } from "../wire.js";

export type AcpServiceTierTarget =
  | { option: AcpConfigOption; type?: undefined; value: string }
  | { option: AcpConfigOption; type: "boolean"; value: boolean };

const SERVICE_TIER_CONFIG_IDS = ["fast-mode", "fast"] as const;

function valuesForConfigId(
  configId: (typeof SERVICE_TIER_CONFIG_IDS)[number],
  serviceTier: ServiceTier,
): string | boolean {
  if (configId === "fast-mode") {
    return serviceTier === "fast" ? "on" : "off";
  }
  return serviceTier === "fast" ? "true" : "false";
}

export function resolveAcpServiceTierTarget(
  configOptions: readonly AcpConfigOption[] | undefined,
  serviceTier: ServiceTier,
): AcpServiceTierTarget | undefined {
  for (const configId of SERVICE_TIER_CONFIG_IDS) {
    const option = configOptions?.find(
      (candidate) => candidate.id === configId,
    );
    if (option === undefined) {
      continue;
    }
    if (option.type === "boolean") {
      return { option, type: "boolean", value: serviceTier === "fast" };
    }
    if (option.type !== "select") {
      continue;
    }
    const value = valuesForConfigId(configId, serviceTier);
    if (
      typeof value === "string" &&
      option.options?.some((candidate) => candidate.value === value)
    ) {
      return { option, value };
    }
  }
  return undefined;
}
