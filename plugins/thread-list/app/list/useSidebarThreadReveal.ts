import { useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { NO_MACHINE_GROUP_KEY } from "../model/machine-thread-groups.js";
import { buildPinnedSidebarState } from "../model/pinned-sidebar-threads.js";
import {
  CHRONOLOGICAL_CONTAINER_ID,
  resolveSidebarProjectId,
  getCandidateRootThreads,
} from "../model/project-thread-groups.js";
import { sectionKeyForThreadSection } from "../model/section-keys.js";
import type { CollapsibleSidebarSectionId } from "../model/sidebar-section-id.js";
import {
  useBbContext,
  experimental_useThreadListContributions,
} from "@get-bb/plugin-sdk/app";
import {
  builtInOrganizationModeSchema,
  buildContributionGroupKey,
  type OrganizationMode as SidebarOrganizationMode,
} from "../../shared/preferences.js";
import { useSidebarData } from "../model/use-sidebar-data.js";
import {
  collapsedEnvironmentIdsAtom,
  collapsedProjectIdsAtom,
  collapsedSidebarSectionIdsAtom,
  sidebarCollapsedMachinesAtom,
  sidebarCollapsedThreadSectionsAtom,
  sidebarOrganizationModeAtom,
  sidebarCollapsedContributionGroupsAtom,
} from "../preferences/atoms.js";
import { usePreferencesReady } from "../preferences/PreferencesSync.js";
import { useExpandThreadAncestors } from "./useReadStatusGrouping.js";

interface ThreadSidebarExpansionArgs {
  organizationMode: SidebarOrganizationMode;
  isPinned: boolean;
  thread: SidebarThread;
  sidebarProjectId: string;
  personalProjectId: string | null;
}

interface ThreadSidebarExpansion {
  sectionKey?: string;
  machineKey?: string;
  projectId?: string;
  sidebarSectionId?: CollapsibleSidebarSectionId;
}

function removeCollapsedIds<T extends string>(
  current: T[],
  idsToRemove: ReadonlySet<string>,
): T[] {
  if (idsToRemove.size === 0) {
    return current;
  }
  let removed = false;
  const next = current.filter((id) => {
    if (!idsToRemove.has(id)) {
      return true;
    }
    removed = true;
    return false;
  });
  return removed ? next : current;
}

export function getThreadSidebarExpansion({
  organizationMode,
  isPinned,
  thread,
  sidebarProjectId,
  personalProjectId,
}: ThreadSidebarExpansionArgs): ThreadSidebarExpansion {
  if (isPinned) {
    return { sidebarSectionId: "pinned" };
  }

  if (organizationMode === "machine") {
    return {
      machineKey: thread.host?.id ?? NO_MACHINE_GROUP_KEY,
    };
  }

  if (organizationMode === "chronological") {
    const sectionKey = sectionKeyForThreadSection(
      CHRONOLOGICAL_CONTAINER_ID,
      thread.sectionId,
    );
    return sectionKey ? { sectionKey } : { sidebarSectionId: "threads" };
  }

  if (sidebarProjectId === personalProjectId) {
    return { sidebarSectionId: "threads" };
  }

  return { projectId: sidebarProjectId };
}

export function useSidebarThreadReveal(): void {
  const { threadId: routedThreadId } = useBbContext();
  const { status, projects, personalProject } = useSidebarData();
  const preferencesReady = usePreferencesReady();
  const threads = useMemo<SidebarThread[]>(
    () => projects.flatMap((project) => project.threads),
    [projects],
  );
  useSidebarThreadRevealCore({
    selectedThreadId: routedThreadId ?? undefined,
    threads,
    threadsReady: status === "ready",
    preferencesReady,
    personalProjectId: personalProject?.id ?? null,
  });
}

export interface SidebarThreadRevealState {
  previousThreadId: string | undefined;
  pendingNavigation: string | undefined;
  previousUnreadIds: ReadonlySet<string> | null;
}

export const INITIAL_SIDEBAR_THREAD_REVEAL_STATE: SidebarThreadRevealState = {
  previousThreadId: undefined,
  pendingNavigation: undefined,
  previousUnreadIds: null,
};

interface SidebarThreadRevealStepInputs {
  selectedThreadId: string | undefined;
  threads: readonly SidebarThread[];
  threadById: ReadonlyMap<string, SidebarThread>;
  threadsReady: boolean;
  preferencesReady: boolean;
}

interface SidebarThreadRevealStep {
  state: SidebarThreadRevealState;
  revealIds: ReadonlySet<string>;
  navigationRevealId: string | undefined;
}

export function stepSidebarThreadReveal(
  state: SidebarThreadRevealState,
  {
    selectedThreadId,
    threads,
    threadById,
    threadsReady,
    preferencesReady,
  }: SidebarThreadRevealStepInputs,
): SidebarThreadRevealStep {
  let { previousThreadId, pendingNavigation } = state;
  if (previousThreadId !== selectedThreadId) {
    previousThreadId = selectedThreadId;
    pendingNavigation = selectedThreadId;
  }
  if (!preferencesReady || !threadsReady) {
    return {
      state: {
        previousThreadId,
        pendingNavigation,
        previousUnreadIds: state.previousUnreadIds,
      },
      revealIds: new Set(),
      navigationRevealId: undefined,
    };
  }
  const revealIds = new Set<string>();
  const navigationRevealId = pendingNavigation;
  if (navigationRevealId && threadById.has(navigationRevealId)) {
    revealIds.add(navigationRevealId);
    pendingNavigation = undefined;
  }
  const unreadIds = new Set<string>();
  for (const thread of threads) {
    if (thread.isHidden || !thread.isUnread) {
      continue;
    }
    unreadIds.add(thread.id);
    if (
      state.previousUnreadIds &&
      !state.previousUnreadIds.has(thread.id) &&
      thread.id !== selectedThreadId
    ) {
      revealIds.add(thread.id);
    }
  }
  return {
    state: {
      previousThreadId,
      pendingNavigation,
      previousUnreadIds: unreadIds,
    },
    revealIds,
    navigationRevealId,
  };
}

interface ThreadRevealExpansionArgs {
  thread: SidebarThread;
  threadById: ReadonlyMap<string, SidebarThread>;
  effectivePinnedThreadIds: ReadonlySet<string>;
  organizationMode: SidebarOrganizationMode;
  personalProjectId: string | null;
}

export function resolveThreadRevealExpansion({
  thread,
  threadById,
  effectivePinnedThreadIds,
  organizationMode,
  personalProjectId,
}: ThreadRevealExpansionArgs) {
  const threadIdsToExpand = new Set<string>();
  const environmentIdsToExpand = new Set<string>();
  let currentThread: SidebarThread | undefined = thread;
  let remainingHops = threadById.size;
  while (currentThread && remainingHops > 0) {
    const environmentId = currentThread.environment?.id ?? null;
    if (environmentId !== null) {
      environmentIdsToExpand.add(environmentId);
    }
    const parentThreadId = currentThread.parentThreadId;
    if (parentThreadId === null) {
      break;
    }
    const parentThread = threadById.get(parentThreadId);
    if (!parentThread) {
      break;
    }
    threadIdsToExpand.add(parentThread.id);
    currentThread = parentThread;
    remainingHops -= 1;
  }
  const expansion = getThreadSidebarExpansion({
    organizationMode,
    isPinned: effectivePinnedThreadIds.has(thread.id),
    thread,
    sidebarProjectId: resolveSidebarProjectId(thread, threadById),
    personalProjectId,
  });
  return {
    threadIdsToExpand,
    environmentIdsToExpand,
    expansion,
    currentThread,
  };
}

export interface SidebarThreadRevealInputs {
  selectedThreadId: string | undefined;
  threads: readonly SidebarThread[];
  threadsReady: boolean;
  preferencesReady: boolean;
  personalProjectId: string | null;
}

export function useSidebarThreadRevealCore({
  selectedThreadId,
  threads,
  threadsReady,
  preferencesReady,
  personalProjectId,
}: SidebarThreadRevealInputs): void {
  const organizationMode = useAtomValue(sidebarOrganizationModeAtom);
  const providerKey = builtInOrganizationModeSchema.safeParse(organizationMode)
    .success
    ? null
    : organizationMode;
  const candidateRoots = useMemo(
    () => getCandidateRootThreads(threads),
    [threads],
  );
  const { grouping } = experimental_useThreadListContributions({
    rootThreadIds: candidateRoots.map((thread) => thread.id),
    groupingKey: providerKey,
  });
  const setCollapsedContributionGroups = useSetAtom(
    sidebarCollapsedContributionGroupsAtom,
  );
  const expandThreadAncestors = useExpandThreadAncestors();
  const setCollapsedEnvironmentIdList = useSetAtom(collapsedEnvironmentIdsAtom);
  const setCollapsedProjectIdList = useSetAtom(collapsedProjectIdsAtom);
  const setCollapsedMachineKeyList = useSetAtom(sidebarCollapsedMachinesAtom);
  const setCollapsedSectionList = useSetAtom(
    sidebarCollapsedThreadSectionsAtom,
  );
  const setCollapsedSidebarSectionIdList = useSetAtom(
    collapsedSidebarSectionIdsAtom,
  );
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );
  const effectivePinnedThreadIds = useMemo(
    () => buildPinnedSidebarState({ threads }).effectivePinnedThreadIds,
    [threads],
  );
  const pendingGroupingReveal = useRef(new Set<string>());
  const revealState = useRef(INITIAL_SIDEBAR_THREAD_REVEAL_STATE);

  useEffect(() => {
    const step = stepSidebarThreadReveal(revealState.current, {
      selectedThreadId,
      threads,
      threadById,
      threadsReady,
      preferencesReady,
    });
    revealState.current = step.state;
    const revealIds = new Set([
      ...step.revealIds,
      ...pendingGroupingReveal.current,
    ]);
    const navigationRevealId = step.navigationRevealId;
    for (const threadId of revealIds) {
      const thread = threadById.get(threadId);
      if (!thread || thread.isHidden) {
        pendingGroupingReveal.current.delete(threadId);
        if (threadId === navigationRevealId)
          revealState.current.pendingNavigation = undefined;
        continue;
      }
      const {
        threadIdsToExpand,
        environmentIdsToExpand,
        expansion,
        currentThread,
      } = resolveThreadRevealExpansion({
        thread,
        threadById,
        effectivePinnedThreadIds,
        organizationMode: providerKey ? "chronological" : organizationMode,
        personalProjectId,
      });

      expandThreadAncestors(
        threadIdsToExpand,
        threadId === step.navigationRevealId,
      );
      setCollapsedEnvironmentIdList((current) =>
        removeCollapsedIds(current, environmentIdsToExpand),
      );

      const isPinned = effectivePinnedThreadIds.has(thread.id);
      let awaitingGroup = providerKey !== null && !isPinned;
      if (providerKey && grouping && currentThread && !isPinned) {
        const result = grouping(currentThread);
        awaitingGroup = result.status !== "ready";
        if (result.status === "ready") {
          const key =
            result.group === null
              ? buildContributionGroupKey(providerKey, "ungrouped")
              : buildContributionGroupKey(
                  providerKey,
                  "group",
                  result.group.key,
                );
          setCollapsedContributionGroups((current) =>
            removeCollapsedIds(current, new Set([key])),
          );
        }
      }
      if (awaitingGroup) pendingGroupingReveal.current.add(threadId);
      else {
        pendingGroupingReveal.current.delete(threadId);
        if (threadId === navigationRevealId)
          revealState.current.pendingNavigation = undefined;
      }
      if (expansion.machineKey) {
        const machineKey = expansion.machineKey;
        setCollapsedMachineKeyList((current) =>
          removeCollapsedIds(current, new Set([machineKey])),
        );
      }
      if (expansion.sectionKey) {
        const sectionKey = expansion.sectionKey;
        setCollapsedSectionList((current) =>
          removeCollapsedIds(current, new Set([sectionKey])),
        );
      }
      if (expansion.projectId) {
        const projectId = expansion.projectId;
        setCollapsedProjectIdList((current) =>
          removeCollapsedIds(current, new Set([projectId])),
        );
      }
      if (expansion.sidebarSectionId) {
        const sidebarSectionId = expansion.sidebarSectionId;
        setCollapsedSidebarSectionIdList((current) =>
          removeCollapsedIds(current, new Set([sidebarSectionId])),
        );
      }
    }
  }, [
    selectedThreadId,
    threadsReady,
    preferencesReady,
    personalProjectId,
    organizationMode,
    providerKey,
    grouping,
    setCollapsedContributionGroups,
    threads,
    threadById,
    effectivePinnedThreadIds,
    expandThreadAncestors,
    setCollapsedEnvironmentIdList,
    setCollapsedProjectIdList,
    setCollapsedMachineKeyList,
    setCollapsedSectionList,
    setCollapsedSidebarSectionIdList,
  ]);
}
