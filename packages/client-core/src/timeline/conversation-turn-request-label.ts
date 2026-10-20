import type { TimelineConversationTurnRequest } from "@bb/server-contract";

export function turnRequestLabel(
  turnRequest: TimelineConversationTurnRequest,
): string | null {
  if (turnRequest.kind !== "steer") {
    return null;
  }
  if (turnRequest.status === "pending") return "Steer pending";
  if (turnRequest.status === "rejected") return "Steer failed";
  if (turnRequest.delivery === "interrupted") return "Interrupted and sent";
  if (turnRequest.delivery === "queued") return "Queued";
  return "Steer";
}
