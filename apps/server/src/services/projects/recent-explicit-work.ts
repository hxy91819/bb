import { getThread, promoteProjectRecentExplicitWork } from "@bb/db";
import type { DbConnection, DbNotifier } from "@bb/db";
import type { Thread } from "@bb/domain";
import type {
  StartedOnBehalfOf,
  ThreadCreateOrigin,
} from "@bb/server-contract";

export interface ExplicitWorkAcceptance {
  origin: ThreadCreateOrigin | null;
  parentThreadId: string | null;
  payloadInputLength: number;
  retryOf: boolean;
  sendAt: number | null;
  sourceKind: "drain" | "inline";
  startedOnBehalfOfInitiator: StartedOnBehalfOf["initiator"] | null;
  threadStatus: Thread["status"];
  trigger: "auto-dispatch" | "user";
}

export function isEligibleExplicitWorkAcceptance(
  args: ExplicitWorkAcceptance,
  now = Date.now(),
): boolean {
  if (args.trigger !== "user" || args.sourceKind !== "inline") {
    return false;
  }
  if (args.startedOnBehalfOfInitiator !== null) {
    return false;
  }
  const isThreadCreation = args.threadStatus === "pending";
  if (isThreadCreation && args.parentThreadId !== null) {
    return false;
  }
  if (isThreadCreation && args.origin === "plugin") {
    return false;
  }
  if (isThreadCreation && args.payloadInputLength === 0) {
    return false;
  }
  if (args.retryOf && args.sendAt !== null && args.sendAt > now) {
    return false;
  }
  return true;
}

export function recordAcceptedExplicitWork(
  deps: { db: DbConnection; hub: DbNotifier },
  projectId: string,
): void {
  promoteProjectRecentExplicitWork(deps.db, deps.hub, projectId);
}

export function recordAcceptedExplicitWorkForThread(
  deps: { db: DbConnection; hub: DbNotifier },
  threadId: string,
): void {
  const thread = getThread(deps.db, threadId);
  if (!thread) {
    return;
  }
  recordAcceptedExplicitWork(deps, thread.projectId);
}
