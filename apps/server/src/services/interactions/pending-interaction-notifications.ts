import { formatPendingInteractionSubjectDetailLines } from "@bb/core-ui";
import { getThread } from "@bb/db";
import type { PendingInteraction } from "@bb/domain";
import {
  isApprovalPendingInteractionPayload,
  isPluginExtensionInteractionRequestPayload,
  isPluginPendingInteraction,
  isUserQuestionPendingInteractionPayload,
  parseExtensionKind,
} from "@bb/domain";
import { sliceUtf16Head } from "@bb/text-utils";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import { isParentNotifiableChildThread } from "../threads/thread-parent.js";
import { queueChildThreadNeedsAttentionNotificationBestEffort } from "../threads/child-thread-notifications.js";

const CHILD_THREAD_BLOCKER_SUMMARY_MAX_LINES = 4;
const CHILD_THREAD_BLOCKER_SUMMARY_MAX_CHARS = 700;
const CHILD_THREAD_BLOCKER_SUMMARY_TRUNCATION_MARKER =
  "\n[... summary truncated ...]";

function pendingInteractionBlockerLabel(
  interaction: PendingInteraction,
): string {
  if (isUserQuestionPendingInteractionPayload(interaction.payload)) {
    return "user question";
  }
  if (isPluginExtensionInteractionRequestPayload(interaction.payload)) {
    return `${parseExtensionKind(interaction.payload.kind).pluginId} request`;
  }
  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    return "plugin request";
  }
  switch (interaction.payload.subject.kind) {
    case "command":
      return "command approval";
    case "file_change":
      return "file-change approval";
    case "permission_grant":
      return "permission grant";
    case "plan":
      return "plan review";
    case "tool_use":
      return "tool-use approval";
    default: {
      const exhaustiveCheck: never = interaction.payload.subject;
      return exhaustiveCheck;
    }
  }
}

function truncateChildThreadBlockerSummary(summary: string): string {
  if (summary.length <= CHILD_THREAD_BLOCKER_SUMMARY_MAX_CHARS) {
    return summary;
  }
  const retainedLength = Math.max(
    0,
    CHILD_THREAD_BLOCKER_SUMMARY_MAX_CHARS -
      CHILD_THREAD_BLOCKER_SUMMARY_TRUNCATION_MARKER.length,
  );
  return `${sliceUtf16Head(summary, retainedLength).trimEnd()}${CHILD_THREAD_BLOCKER_SUMMARY_TRUNCATION_MARKER}`;
}

function pluginFormTitleLines(interaction: PendingInteraction): string[] {
  const { payload } = interaction;
  return isApprovalPendingInteractionPayload(payload) ||
    isUserQuestionPendingInteractionPayload(payload)
    ? []
    : [payload.title];
}

export function buildChildThreadBlockerSummary(
  interaction: PendingInteraction,
): string | null {
  const detailLines = formatPendingInteractionSubjectDetailLines(interaction);
  const details = (
    detailLines.length > 0 ? detailLines : pluginFormTitleLines(interaction)
  )
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, CHILD_THREAD_BLOCKER_SUMMARY_MAX_LINES);
  if (details.length === 0) {
    return null;
  }
  return truncateChildThreadBlockerSummary(
    [
      `Blocked on ${pendingInteractionBlockerLabel(interaction)}:`,
      ...details,
    ].join("\n"),
  );
}

export function requestChildThreadNeedsAttentionNotification(
  deps: LoggedPendingInteractionWorkSessionDeps,
  interaction: PendingInteraction,
): void {
  const childThread = getThread(deps.db, interaction.threadId);
  if (
    !childThread ||
    !isParentNotifiableChildThread(childThread, "needs-attention")
  ) {
    return;
  }
  const parentThreadId = childThread.parentThreadId;

  deferAfterResponse({
    config: deps.config,
    context: {
      childThreadId: childThread.id,
      parentThreadId,
    },
    logger: deps.logger,
    name: "Child thread needs-attention notification",
    work: async () => {
      const current = deps.pendingInteractions.getThreadInteraction({
        threadId: childThread.id,
        interactionId: interaction.id,
      });
      if (current.status !== "pending" && current.status !== "resolving")
        return;
      const summary = buildChildThreadBlockerSummary(current);
      const formGuidance = isPluginPendingInteraction(current)
        ? [
            `Inspect the current form: bb thread interactions show ${current.id} ${childThread.id} --json`,
            `Submit the form with bb thread interactions respond ${current.id} ${childThread.id} --value '<json>' using its response instructions. A thread message does not submit this form.`,
          ].join("\n")
        : null;
      await queueChildThreadNeedsAttentionNotificationBestEffort(deps, {
        blockerSummary:
          [summary, formGuidance].filter(Boolean).join("\n\n") || null,
        childThread,
        parentThreadId,
      });
    },
  });
}
