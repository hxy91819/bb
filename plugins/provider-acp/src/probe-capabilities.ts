import type { AcpAgentDefinition } from "./agents.js";
import type { AcpAgentProbe } from "@get-bb/plugin-sdk/provider-bridge/acp";

export interface AcpProbeApplication {
  agent: AcpAgentDefinition;
  reason: string;
}

export function applyAcpAgentProbe(
  agent: AcpAgentDefinition,
  probe: AcpAgentProbe,
): AcpProbeApplication | null {
  if (!probe.reachable) {
    return null;
  }
  const fork = probe.fork ? "tip" : "none";
  if (agent.fork === "none" || agent.fork === fork) {
    return null;
  }
  return {
    agent: { ...agent, fork },
    reason: probe.fork
      ? "the agent advertises session/fork"
      : "the agent does not advertise session/fork",
  };
}
