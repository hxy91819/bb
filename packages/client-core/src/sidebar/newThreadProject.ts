import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  compareStandardThreads,
  type StandardThreadSortFields,
} from "./projectThreadGroups.js";

export function resolveSidebarNewThreadProjectId({
  availableProjectIds,
  recentThreads,
  rememberedProjectId,
  routeProjectId,
}: {
  availableProjectIds: readonly string[] | undefined;
  recentThreads: readonly (StandardThreadSortFields & { projectId: string })[];
  rememberedProjectId: string;
  routeProjectId: string | null | undefined;
}): string {
  const isAvailable = (projectId: string) =>
    availableProjectIds === undefined ||
    availableProjectIds.includes(projectId);
  if (
    routeProjectId &&
    routeProjectId !== PERSONAL_PROJECT_ID &&
    isAvailable(routeProjectId)
  )
    return routeProjectId;
  if (
    rememberedProjectId !== PERSONAL_PROJECT_ID &&
    isAvailable(rememberedProjectId)
  )
    return rememberedProjectId;
  return (
    [...recentThreads]
      .sort(compareStandardThreads)
      .find(
        (thread) =>
          thread.projectId !== PERSONAL_PROJECT_ID &&
          isAvailable(thread.projectId),
      )?.projectId ?? PERSONAL_PROJECT_ID
  );
}
