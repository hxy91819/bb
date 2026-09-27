import {
  deleteUnclaimedQueuedThreadMessagesBySystemNoticeKindInTransaction,
  type DbTransaction,
} from "@bb/db";
import type { AppDeps } from "../../types.js";

export function cancelEnvironmentSwitchContinuationInTransaction(
  db: DbTransaction,
  threadId: string,
): boolean {
  return (
    deleteUnclaimedQueuedThreadMessagesBySystemNoticeKindInTransaction(db, {
      threadId,
      kind: "environment-switched",
    }) > 0
  );
}

export function cancelEnvironmentSwitchContinuation(
  deps: Pick<AppDeps, "db" | "hub">,
  threadId: string,
): boolean {
  const canceled = deps.db.transaction(
    (tx) => cancelEnvironmentSwitchContinuationInTransaction(tx, threadId),
    { behavior: "immediate" },
  );
  if (canceled) {
    deps.hub.notifyThread(threadId, ["queue-changed"]);
  }
  return canceled;
}
