import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import type { ThreadWithRuntime } from "@bb/domain";
import {
  findSidebarNavigationThreadPlaceholder,
  getCachedThreadListPlaceholder,
} from "@/hooks/cache-owners/query-cache";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { promoteSidebarProjectActivityAtom } from "@/components/sidebar/sidebarCollapsedAtoms";

function getCachedThreadProjectId(
  queryClient: ReturnType<typeof useQueryClient>,
  threadId: string,
): string | null {
  return (
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId))
      ?.projectId ??
    getCachedThreadListPlaceholder(queryClient, threadId)?.projectId ??
    findSidebarNavigationThreadPlaceholder(queryClient, threadId)?.projectId ??
    null
  );
}

export function useAcceptedThreadWorkPromotion() {
  const queryClient = useQueryClient();
  const promoteProject = useSetAtom(promoteSidebarProjectActivityAtom);

  return useCallback(
    ({ projectId, threadId }: { projectId?: string; threadId: string }) => {
      const resolvedProjectId =
        projectId ?? getCachedThreadProjectId(queryClient, threadId);
      if (resolvedProjectId) {
        promoteProject(resolvedProjectId);
      }
    },
    [promoteProject, queryClient],
  );
}
