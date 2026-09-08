import {
  listExistingSidebarEntityIds,
  listStoredUiPreferences,
  overwriteStoredUiPreference,
  replaceStoredUiPreference,
  type StoredUiPreference,
} from "@bb/db";
import {
  UI_PREFERENCE_KEYS,
  getUiPreferenceDefault,
  isUiPreferenceKey,
  parseUiPreferenceValue,
  type UiPreferenceEntries,
  type UiPreferenceEntry,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";

function parseStoredJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toEntry<Key extends UiPreferenceKey>(
  key: Key,
  stored: StoredUiPreference | undefined,
): UiPreferenceEntry<Key> {
  const defaultEntry: UiPreferenceEntry<Key> = {
    revision: stored?.revision ?? 0,
    value: getUiPreferenceDefault(key),
  };
  if (stored === undefined) return defaultEntry;
  const parsed = parseUiPreferenceValue(key, parseStoredJson(stored.valueJson));
  return parsed.success
    ? { revision: stored.revision, value: parsed.value }
    : defaultEntry;
}

export function readUiPreferences(deps: AppDeps): UiPreferenceEntries {
  const stored = new Map<string, StoredUiPreference>();
  for (const row of listStoredUiPreferences(deps.db)) {
    if (isUiPreferenceKey(row.key)) stored.set(row.key, row);
  }
  const entries: Partial<UiPreferenceEntries> = {};
  for (const key of UI_PREFERENCE_KEYS) {
    assignEntry(entries, key, toEntry(key, stored.get(key)));
  }
  return entries as UiPreferenceEntries;
}

function assignEntry<Key extends UiPreferenceKey>(
  entries: Partial<UiPreferenceEntries>,
  key: Key,
  entry: UiPreferenceEntry<Key>,
): void {
  entries[key] = entry as UiPreferenceEntries[Key];
}

const SECTION_KEY_SEPARATOR = "::";

function threadSectionIdFromKey(sectionKey: string): string | null {
  const separatorIndex = sectionKey.lastIndexOf(SECTION_KEY_SEPARATOR);
  if (separatorIndex === -1) return null;
  const sectionId = sectionKey.slice(
    separatorIndex + SECTION_KEY_SEPARATOR.length,
  );
  return sectionId.length > 0 ? sectionId : null;
}

function pruneCollapsedIds(
  ids: readonly string[],
  keep: (id: string) => boolean,
): string[] {
  const pruned = ids.filter(keep);
  return pruned.length === ids.length ? [...ids] : pruned;
}

export function pruneUiPreferenceValue<Key extends UiPreferenceKey>(
  deps: Pick<AppDeps, "db">,
  key: Key,
  value: UiPreferenceValue<Key>,
): UiPreferenceValue<Key> {
  switch (key) {
    case "sidebar.collapsedProjects": {
      const ids = value as string[];
      const existing = listExistingSidebarEntityIds(deps.db, {
        environmentIds: [],
        projectIds: ids,
        threadIds: [],
        threadSectionIds: [],
      });
      return pruneCollapsedIds(ids, (id) =>
        existing.projectIds.has(id),
      ) as UiPreferenceValue<Key>;
    }
    case "sidebar.collapsedThreads": {
      const ids = value as string[];
      const existing = listExistingSidebarEntityIds(deps.db, {
        environmentIds: [],
        projectIds: [],
        threadIds: ids,
        threadSectionIds: [],
      });
      return pruneCollapsedIds(ids, (id) =>
        existing.threadIds.has(id),
      ) as UiPreferenceValue<Key>;
    }
    case "sidebar.collapsedEnvironments": {
      const ids = value as string[];
      const existing = listExistingSidebarEntityIds(deps.db, {
        environmentIds: ids,
        projectIds: [],
        threadIds: [],
        threadSectionIds: [],
      });
      return pruneCollapsedIds(ids, (id) =>
        existing.environmentIds.has(id),
      ) as UiPreferenceValue<Key>;
    }
    case "sidebar.collapsedThreadSections": {
      const keys = value as string[];
      const sectionIds = keys
        .map(threadSectionIdFromKey)
        .filter((id): id is string => id !== null);
      const existing = listExistingSidebarEntityIds(deps.db, {
        environmentIds: [],
        projectIds: [],
        threadIds: [],
        threadSectionIds: sectionIds,
      });
      return pruneCollapsedIds(keys, (sectionKey) => {
        const sectionId = threadSectionIdFromKey(sectionKey);
        return sectionId === null || existing.threadSectionIds.has(sectionId);
      }) as UiPreferenceValue<Key>;
    }
    default:
      return value;
  }
}

export type WriteUiPreferenceResult<Key extends UiPreferenceKey> =
  | { outcome: "updated"; entry: UiPreferenceEntry<Key> }
  | { outcome: "conflict"; revision: number };

export function writeUiPreference<Key extends UiPreferenceKey>(
  deps: AppDeps,
  args: { expectedRevision: number; key: Key; value: UiPreferenceValue<Key> },
): WriteUiPreferenceResult<Key> {
  const value = pruneUiPreferenceValue(deps, args.key, args.value);
  const result = replaceStoredUiPreference(deps.db, {
    expectedRevision: args.expectedRevision,
    key: args.key,
    valueJson: JSON.stringify(value),
  });
  if (result.outcome === "conflict") {
    return { outcome: "conflict", revision: result.revision };
  }
  deps.hub.notifySystem(["ui-preferences-changed"]);
  return {
    outcome: "updated",
    entry: { revision: result.revision, value },
  };
}

export function resetUiPreference<Key extends UiPreferenceKey>(
  deps: AppDeps,
  key: Key,
): UiPreferenceEntry<Key> {
  const value = getUiPreferenceDefault(key);
  const { revision } = overwriteStoredUiPreference(deps.db, {
    key,
    valueJson: JSON.stringify(value),
  });
  deps.hub.notifySystem(["ui-preferences-changed"]);
  return { revision, value };
}
