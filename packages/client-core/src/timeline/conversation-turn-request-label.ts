import type { TimelineConversationTurnRequest } from "@bb/server-contract";

export function turnRequestLabel(
  turnRequest: TimelineConversationTurnRequest,
): string | null {
  if (turnRequest.kind !== "steer") {
    return null;
  }
  if (turnRequest.status === "pending") return "Steer pending";
  if (turnRequest.status === "rejected") return "Steer failed";
  if (turnRequest.delivery === "interrupted") return "降级为中断并发送";
  if (turnRequest.delivery === "queued") return "排队发送";
  return "Steer";
}
