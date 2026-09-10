import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { CollapsibleSidebarSectionId } from "@bb/client-core";
import {
  createLocalStorageEnumStorage,
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";

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
export const SIDEBAR_PROJECT_ORDER_STORAGE_KEY = "bb.sidebar.projectOrder";
export const SIDEBAR_PROJECT_ACTIVITY_PROMOTIONS_STORAGE_KEY =
  "bb.sidebar.projectActivityPromotions";
const COLLAPSED_THREAD_SECTIONS_STORAGE_KEY =
  "bb.sidebar.collapsedThreadSections";
const LEGACY_COLLAPSED_FOLDERS_STORAGE_KEY = "bb.sidebar.collapsedFolders";
const COLLAPSED_MACHINES_STORAGE_KEY = "bb.sidebar.collapsedMachines";

export type {
  CollapsibleSidebarSectionId,
  SidebarSectionId,
} from "@bb/client-core";

export type SidebarOrganizationMode = "project" | "chronological" | "machine";
export type SidebarChronologicalSort = "updated" | "created" | "alpha" | "none";
export type SidebarProjectOrder = "recent" | "manual";

export interface SidebarProjectActivityPromotions {
  promotions: Record<string, number>;
  sequence: number;
  version: 1;
}

const DEFAULT_SIDEBAR_SECTION_ORDER: readonly string[] = [
  "pinned",
  "projects",
  "threads",
];

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

export const collapsedProjectIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_PROJECTS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedThreadIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_THREADS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedEnvironmentIdsAtom = atomWithStorage<string[]>(
  COLLAPSED_ENVIRONMENTS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const collapsedSidebarSectionIdsAtom = atomWithStorage<
  CollapsibleSidebarSectionId[]
>(
  COLLAPSED_SIDEBAR_SECTIONS_STORAGE_KEY,
  [],
  createJsonLocalStorage<CollapsibleSidebarSectionId[]>(),
  { getOnInit: true },
);

export const sidebarSectionOrderAtom = atomWithStorage<string[]>(
  SIDEBAR_SECTION_ORDER_STORAGE_KEY,
  [...DEFAULT_SIDEBAR_SECTION_ORDER],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const sidebarManualSectionOrderAtom = atomWithStorage<string[]>(
  SIDEBAR_MANUAL_SECTION_ORDER_STORAGE_KEY,
  ["pinned", "sections", "threads"],
  sidebarManualSectionOrderStorage,
  { getOnInit: true },
);

export const sidebarMachineSectionOrderAtom = atomWithStorage<string[]>(
  SIDEBAR_MACHINE_SECTION_ORDER_STORAGE_KEY,
  ["pinned", "machines", "threads"],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const sidebarOrganizationModeAtom =
  atomWithStorage<SidebarOrganizationMode>(
    SIDEBAR_ORGANIZATION_MODE_STORAGE_KEY,
    "project",
    createJsonLocalStorage<SidebarOrganizationMode>(),
    { getOnInit: true },
  );

export const sidebarChronologicalSortAtom =
  atomWithStorage<SidebarChronologicalSort>(
    CHRONOLOGICAL_SORT_STORAGE_KEY,
    "updated",
    createJsonLocalStorage<SidebarChronologicalSort>(),
    { getOnInit: true },
  );

function isSidebarProjectOrder(value: string): value is SidebarProjectOrder {
  return value === "recent" || value === "manual";
}

function isSidebarProjectActivityPromotions(
  value: unknown,
): value is SidebarProjectActivityPromotions {
  const candidate = value as {
    promotions?: unknown;
    sequence?: unknown;
    version?: unknown;
  };
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    candidate.version !== 1 ||
    typeof candidate.sequence !== "number" ||
    !Number.isSafeInteger(candidate.sequence) ||
    candidate.sequence < 0 ||
    typeof candidate.promotions !== "object" ||
    candidate.promotions === null ||
    Array.isArray(candidate.promotions)
  ) {
    return false;
  }

  const sequenceLimit = candidate.sequence;
  const promotions = candidate.promotions;
  return Object.entries(promotions).every(
    ([projectId, sequence]) =>
      projectId.length > 0 &&
      Number.isSafeInteger(sequence) &&
      sequence > 0 &&
      sequence <= sequenceLimit,
  );
}

const INITIAL_SIDEBAR_PROJECT_ACTIVITY_PROMOTIONS: SidebarProjectActivityPromotions =
  {
    promotions: {},
    sequence: 0,
    version: 1,
  };

function compactSidebarProjectActivityPromotions(
  current: SidebarProjectActivityPromotions,
  projectId: string,
): SidebarProjectActivityPromotions {
  const promotions = Object.fromEntries(
    Object.entries(current.promotions)
      .filter(([id]) => id !== projectId)
      .sort(
        ([leftId, leftSequence], [rightId, rightSequence]) =>
          leftSequence - rightSequence ||
          (leftId < rightId ? -1 : leftId > rightId ? 1 : 0),
      )
      .map(([id], index) => [id, index + 1]),
  );
  const sequence = Object.keys(promotions).length + 1;
  return {
    promotions: { ...promotions, [projectId]: sequence },
    sequence,
    version: 1,
  };
}

export function promoteSidebarProjectActivity(
  current: SidebarProjectActivityPromotions,
  projectId: string,
): SidebarProjectActivityPromotions {
  if (!projectId) return current;
  if (current.sequence === Number.MAX_SAFE_INTEGER) {
    return compactSidebarProjectActivityPromotions(current, projectId);
  }
  const sequence = current.sequence + 1;
  return {
    promotions: { ...current.promotions, [projectId]: sequence },
    sequence,
    version: 1,
  };
}

export const sidebarProjectOrderAtom = atomWithStorage<SidebarProjectOrder>(
  SIDEBAR_PROJECT_ORDER_STORAGE_KEY,
  "manual",
  createLocalStorageEnumStorage(isSidebarProjectOrder),
  { getOnInit: true },
);

export const sidebarProjectActivityPromotionsAtom =
  atomWithStorage<SidebarProjectActivityPromotions>(
    SIDEBAR_PROJECT_ACTIVITY_PROMOTIONS_STORAGE_KEY,
    INITIAL_SIDEBAR_PROJECT_ACTIVITY_PROMOTIONS,
    createJsonLocalStorage(isSidebarProjectActivityPromotions),
    { getOnInit: true },
  );

export const promoteSidebarProjectActivityAtom = atom(
  null,
  (get, set, projectId: string) => {
    set(
      sidebarProjectActivityPromotionsAtom,
      promoteSidebarProjectActivity(
        get(sidebarProjectActivityPromotionsAtom),
        projectId,
      ),
    );
  },
);
export const sidebarCollapsedThreadSectionsAtom = atomWithStorage<string[]>(
  COLLAPSED_THREAD_SECTIONS_STORAGE_KEY,
  [],
  collapsedThreadSectionsStorage,
  { getOnInit: true },
);

export const sidebarCollapsedMachinesAtom = atomWithStorage<string[]>(
  COLLAPSED_MACHINES_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);
