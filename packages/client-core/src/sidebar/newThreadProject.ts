import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  compareStandardThreads,
  type StandardThreadSortFields,
} from "./projectThreadGroups.js";

export function resolveSidebarNewThreadProjectId({
  recentThreads,
  rememberedProjectId,
  routeProjectId,
}: {
  recentThreads: readonly (StandardThreadSortFields & { projectId: string })[];
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
