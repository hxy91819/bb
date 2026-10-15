import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { getMessageLinkPath, getThreadRoutePath } from "@/lib/route-paths";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";

export type ThreadNavigationTarget =
  | { match: "message"; seq: number }
  | { match: "sequence"; seq: number | null };

export interface OpenThreadStore {
  get(atom: any): any;
  set(atom: any, ...args: any[]): any;
}

export interface OpenThreadOptions {
  store: OpenThreadStore;
  navigate: (
    route: string,
    options?: { replace?: boolean; state?: Record<string, unknown> },
  ) => void;
  projectId: string;
  threadId: string;
  isCompact?: boolean;
  split?: boolean;
  target?: ThreadNavigationTarget;
}

export function openThread({
  store,
  navigate,
  projectId,
  threadId,
  isCompact = false,
  split = false,
  target,
}: OpenThreadOptions): void {
  store.set(getThreadConversationCollapsedAtom(threadId), false);
  const hash =
    target?.match === "message" ? `#msg=${target.seq}` : undefined;
  const state =
    target?.match === "sequence" && target.seq !== null
      ? { searchMessageSeq: target.seq, searchThreadId: threadId }
      : undefined;
  if (split) {
    openThreadInSplit({
      store,
      navigate,
      projectId,
      threadId,
      isCompact,
      state,
      hash,
    });
    return;
  }
  const route =
    target?.match === "message"
      ? getMessageLinkPath({ projectId, threadId, seq: target.seq })
      : getThreadRoutePath({ projectId, threadId });
  const navigateOptions =
    target?.match === "sequence" ? { state } : undefined;
  navigate(route, navigateOptions);
}
