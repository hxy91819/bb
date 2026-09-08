import type { CollapsibleSidebarSectionId } from "@bb/client-core";
import type {
  SidebarChronologicalSort,
  SidebarOrganizationMode,
} from "@bb/domain";
import {
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

const COLLAPSED_PROJECTS_STORAGE_KEY = "bb.sidebar.collapsedProjects";
const COLLAPSED_THREADS_STORAGE_KEY = "bb.sidebar.collapsedThreads";
const COLLAPSED_ENVIRONMENTS_STORAGE_KEY = "bb.sidebar.collapsedEnvironments";
const COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY = "bb.sidebar.collapsedSections";
const SIDEBAR_SECTION_ORDER_STORAGE_KEY = "bb.sidebar.sectionOrder";
const SIDEBAR_MANUAL_SECTION_ORDER_STORAGE_KEY =
  "bb.sidebar.manualSectionOrder";
const LEGACY_SIDEBAR_FOLDER_SECTION_ORDER_STORAGE_KEY =
  "bb.sidebar.folderSectionOrder";
const SIDEBAR_MACHINE_SECTION_ORDER_STORAGE_KEY =
  "bb.sidebar.machineSectionOrder";
export const SIDEBAR_ORGANIZATION_MODE_STORAGE_KEY =
  "bb.sidebar.organizationMode";
const CHRONOLOGICAL_SORT_STORAGE_KEY = "bb.sidebar.chronologicalSort";
const COLLAPSED_THREAD_SECTIONS_STORAGE_KEY =
  "bb.sidebar.collapsedThreadSections";
const LEGACY_COLLAPSED_FOLDERS_STORAGE_KEY = "bb.sidebar.collapsedFolders";
const COLLAPSED_MACHINES_STORAGE_KEY = "bb.sidebar.collapsedMachines";

export type {
  CollapsibleSidebarSectionId,
  SidebarSectionId,
} from "@bb/client-core";

export type { SidebarChronologicalSort, SidebarOrganizationMode };

function createLegacyMigratingStringArrayStorage(
  legacyKey: string,
  migrateItem: (item: string) => string,
): SyncStorage<string[]> {
  const storage = createJsonLocalStorage<string[]>();

  return {
    getItem(key, initialValue) {
      if (
        typeof window === "undefined" ||
        window.localStorage.getItem(key) !== null
      ) {
        return storage.getItem(key, initialValue);
      }

      const legacyJson = window.localStorage.getItem(legacyKey);
      if (legacyJson === null) {
        return initialValue;
      }
      let parsedLegacyValue: unknown;
      try {
        parsedLegacyValue = JSON.parse(legacyJson);
      } catch {
        storage.removeItem(legacyKey);
        return initialValue;
      }
      if (!Array.isArray(parsedLegacyValue)) {
        storage.removeItem(legacyKey);
        return initialValue;
      }
      const migratedValue = parsedLegacyValue
        .filter((item): item is string => typeof item === "string")
        .map(migrateItem);
      storage.setItem(key, migratedValue);
      storage.removeItem(legacyKey);
      return migratedValue;
    },
    setItem: storage.setItem,
    removeItem(key) {
      storage.removeItem(key);
      storage.removeItem(legacyKey);
    },
    subscribe: storage.subscribe,
  };
}

const sidebarManualSectionOrderStorage =
  createLegacyMigratingStringArrayStorage(
    LEGACY_SIDEBAR_FOLDER_SECTION_ORDER_STORAGE_KEY,
    (item) =>
      item === "folders"
        ? "sections"
        : item.startsWith("folder:")
          ? `section:${item.slice("folder:".length)}`
          : item,
  );

const collapsedThreadSectionsStorage = createLegacyMigratingStringArrayStorage(
  LEGACY_COLLAPSED_FOLDERS_STORAGE_KEY,
  (item) => item,
);

const COLLAPSED_SET_WRITE_DEBOUNCE_MS = 300;

export const collapsedProjectIdsAtom = createSyncedPreferenceAtom({
  debounceMs: COLLAPSED_SET_WRITE_DEBOUNCE_MS,
  key: "sidebar.collapsedProjects",
  storage: createJsonLocalStorage<string[]>(),
  storageKey: COLLAPSED_PROJECTS_STORAGE_KEY,
});

export const collapsedThreadIdsAtom = createSyncedPreferenceAtom({
  debounceMs: COLLAPSED_SET_WRITE_DEBOUNCE_MS,
  key: "sidebar.collapsedThreads",
  storage: createJsonLocalStorage<string[]>(),
  storageKey: COLLAPSED_THREADS_STORAGE_KEY,
});

export const collapsedEnvironmentIdsAtom = createSyncedPreferenceAtom({
  debounceMs: COLLAPSED_SET_WRITE_DEBOUNCE_MS,
  key: "sidebar.collapsedEnvironments",
  storage: createJsonLocalStorage<string[]>(),
  storageKey: COLLAPSED_ENVIRONMENTS_STORAGE_KEY,
});

export const collapsedSidebarSectionIdsAtom = createSyncedPreferenceAtom({
  debounceMs: COLLAPSED_SET_WRITE_DEBOUNCE_MS,
  key: "sidebar.collapsedSections",
  storage: createJsonLocalStorage<CollapsibleSidebarSectionId[]>(),
  storageKey: COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY,
});

export const sidebarSectionOrderAtom = createSyncedPreferenceAtom({
  key: "sidebar.sectionOrder",
  storage: createJsonLocalStorage<string[]>(),
  storageKey: SIDEBAR_SECTION_ORDER_STORAGE_KEY,
});

export const sidebarManualSectionOrderAtom = createSyncedPreferenceAtom({
  key: "sidebar.manualSectionOrder",
  storage: sidebarManualSectionOrderStorage,
  storageKey: SIDEBAR_MANUAL_SECTION_ORDER_STORAGE_KEY,
});

export const sidebarMachineSectionOrderAtom = createSyncedPreferenceAtom({
  key: "sidebar.machineSectionOrder",
  storage: createJsonLocalStorage<string[]>(),
  storageKey: SIDEBAR_MACHINE_SECTION_ORDER_STORAGE_KEY,
});

export const sidebarOrganizationModeAtom = createSyncedPreferenceAtom({
  key: "sidebar.organizationMode",
  storage: createJsonLocalStorage<SidebarOrganizationMode>(),
  storageKey: SIDEBAR_ORGANIZATION_MODE_STORAGE_KEY,
});

export const sidebarChronologicalSortAtom = createSyncedPreferenceAtom({
  key: "sidebar.chronologicalSort",
  storage: createJsonLocalStorage<SidebarChronologicalSort>(),
  storageKey: CHRONOLOGICAL_SORT_STORAGE_KEY,
});

export const sidebarCollapsedThreadSectionsAtom = createSyncedPreferenceAtom({
  debounceMs: COLLAPSED_SET_WRITE_DEBOUNCE_MS,
  key: "sidebar.collapsedThreadSections",
  storage: collapsedThreadSectionsStorage,
  storageKey: COLLAPSED_THREAD_SECTIONS_STORAGE_KEY,
});

export const sidebarCollapsedMachinesAtom = createSyncedPreferenceAtom({
  debounceMs: COLLAPSED_SET_WRITE_DEBOUNCE_MS,
  key: "sidebar.collapsedMachines",
  storage: createJsonLocalStorage<string[]>(),
  storageKey: COLLAPSED_MACHINES_STORAGE_KEY,
});
