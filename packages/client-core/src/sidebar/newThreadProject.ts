import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { compareStandardThreads } from "./projectThreadGroups.js";

export function resolveSidebarNewThreadProjectId({
  recentThreads,
  rememberedProjectId,
  routeProjectId,
}: {
  recentThreads: readonly ThreadListEntry[];
  rememberedProjectId: string;
  routeProjectId: string | null | undefined;
}): string {
  if (routeProjectId) return routeProjectId;
  return (
    [...recentThreads]
      .sort(compareStandardThreads)
      .find((thread) => thread.projectId !== PERSONAL_PROJECT_ID)?.projectId ??
    rememberedProjectId
  );
}
