import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import {
  environments,
  projects,
  threadSections,
  threads,
  uiPreferences,
} from "../schema.js";

export interface StoredUiPreference {
  key: string;
  revision: number;
  valueJson: string;
}

export type ReplaceUiPreferenceResult =
  | { outcome: "updated"; revision: number }
  | { outcome: "conflict"; revision: number };

export function listStoredUiPreferences(
  db: DbConnection,
): StoredUiPreference[] {
  return db
    .select({
      key: uiPreferences.key,
      revision: uiPreferences.revision,
      valueJson: uiPreferences.valueJson,
    })
    .from(uiPreferences)
    .all();
}

export function getStoredUiPreference(
  db: DbConnection,
  key: string,
): StoredUiPreference | null {
  return (
    db
      .select({
        key: uiPreferences.key,
        revision: uiPreferences.revision,
        valueJson: uiPreferences.valueJson,
      })
      .from(uiPreferences)
      .where(eq(uiPreferences.key, key))
      .get() ?? null
  );
}

function upsertStoredUiPreference(
  db: DbQueryConnection,
  args: { key: string; revision: number; valueJson: string },
): void {
  const updatedAt = Date.now();
  db.insert(uiPreferences)
    .values({
      key: args.key,
      revision: args.revision,
      updatedAt,
      valueJson: args.valueJson,
    })
    .onConflictDoUpdate({
      target: uiPreferences.key,
      set: { revision: args.revision, updatedAt, valueJson: args.valueJson },
    })
    .run();
}

export function replaceStoredUiPreference(
  db: DbConnection,
  args: { expectedRevision: number; key: string; valueJson: string },
): ReplaceUiPreferenceResult {
  return db.transaction((tx) => {
    const current = tx
      .select({ revision: uiPreferences.revision })
      .from(uiPreferences)
      .where(eq(uiPreferences.key, args.key))
      .get();
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== args.expectedRevision) {
      return { outcome: "conflict", revision: currentRevision };
    }
    const revision = currentRevision + 1;
    upsertStoredUiPreference(tx, {
      key: args.key,
      revision,
      valueJson: args.valueJson,
    });
    return { outcome: "updated", revision };
  });
}

export function overwriteStoredUiPreference(
  db: DbConnection,
  args: { key: string; valueJson: string },
): { revision: number } {
  return db.transaction((tx) => {
    const current = tx
      .select({ revision: uiPreferences.revision })
      .from(uiPreferences)
      .where(eq(uiPreferences.key, args.key))
      .get();
    const revision = (current?.revision ?? 0) + 1;
    upsertStoredUiPreference(tx, {
      key: args.key,
      revision,
      valueJson: args.valueJson,
    });
    return { revision };
  });
}

export interface SidebarEntityIdLists {
  environmentIds: readonly string[];
  projectIds: readonly string[];
  threadIds: readonly string[];
  threadSectionIds: readonly string[];
}

export interface ExistingSidebarEntityIds {
  environmentIds: ReadonlySet<string>;
  projectIds: ReadonlySet<string>;
  threadIds: ReadonlySet<string>;
  threadSectionIds: ReadonlySet<string>;
}

export function listExistingSidebarEntityIds(
  db: DbConnection,
  ids: SidebarEntityIdLists,
): ExistingSidebarEntityIds {
  const projectIds =
    ids.projectIds.length === 0
      ? []
      : db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              inArray(projects.id, [...ids.projectIds]),
              isNull(projects.deletedAt),
            ),
          )
          .all();
  const threadIds =
    ids.threadIds.length === 0
      ? []
      : db
          .select({ id: threads.id })
          .from(threads)
          .where(
            and(
              inArray(threads.id, [...ids.threadIds]),
              isNull(threads.deletedAt),
            ),
          )
          .all();
  const environmentIds =
    ids.environmentIds.length === 0
      ? []
      : db
          .select({ id: environments.id })
          .from(environments)
          .where(
            and(
              inArray(environments.id, [...ids.environmentIds]),
              ne(environments.status, "destroyed"),
            ),
          )
          .all();
  const threadSectionIds =
    ids.threadSectionIds.length === 0
      ? []
      : db
          .select({ id: threadSections.id })
          .from(threadSections)
          .where(inArray(threadSections.id, [...ids.threadSectionIds]))
          .all();
  return {
    environmentIds: new Set(environmentIds.map((row) => row.id)),
    projectIds: new Set(projectIds.map((row) => row.id)),
    threadIds: new Set(threadIds.map((row) => row.id)),
    threadSectionIds: new Set(threadSectionIds.map((row) => row.id)),
  };
}
