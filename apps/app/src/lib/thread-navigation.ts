import type { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { getThreadConversationCollapsedAtom as getCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { getMessageLinkPath, getThreadRoutePath } from "@/lib/route-paths";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";
import type { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { SplitLayout } from "@/lib/split-layout";

type ThreadConversationCollapsedAtom = ReturnType<
  typeof getThreadConversationCollapsedAtom
>;

export type ThreadNavigationTarget =
  | { match: "message"; seq: number }
  | { match: "sequence"; seq: number };

export interface OpenThreadStore {
  get(atom: typeof splitLayoutAtom): SplitLayout | null;
  set(atom: typeof splitLayoutAtom, value: SplitLayout): void;
  set(atom: ThreadConversationCollapsedAtom, value: boolean): void;
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
  store.set(getCollapsedAtom(threadId), false);
  const route =
    target?.match === "message"
      ? getMessageLinkPath({ projectId, threadId, seq: target.seq })
      : getThreadRoutePath({ projectId, threadId });
  const hash =
    target?.match === "message" ? route.slice(route.indexOf("#")) : undefined;
  const state =
    target?.match === "sequence"
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
  navigate(route, state === undefined ? undefined : { state });
}
