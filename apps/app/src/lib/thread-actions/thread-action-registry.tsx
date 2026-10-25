import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  BbNavigate,
  PluginBoundThreadAction,
  PluginBrowserBbSdk,
  PluginThreadAction,
  PluginThreadActionEntry,
  PluginThreadActionRegistration,
  PluginThreadActionRegistrationInfo,
  PluginThreadActionTarget,
  PluginThreadActionsOptions,
} from "@get-bb/plugin-sdk";
import { PluginContext } from "@/components/plugin/plugin-context";
import { getActiveThreadPanelOpener } from "@/components/plugin/plugin-thread-panel-navigation";
import { useBbNavigate, useSdk } from "@/lib/plugin-navigation-hooks";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  ContributionCollectorBoundary,
  ContributionDataCollector,
  ThreadDemand,
  ThreadListContributionVisibility,
} from "@get-bb/plugin-sdk/internal/thread-contribution-runtime";

export const CORE_THREAD_ACTION_OWNER = "bb--core";

export interface ThreadActionRegistrationRecord {
  key: string;
  instanceKey: string;
  pluginId: string;
  registration: PluginThreadActionRegistration<unknown>;
}

interface CollectedThreadAction {
  data: unknown;
  sdk: PluginBrowserBbSdk;
  navigate: BbNavigate;
}

interface ThreadActionRegistrySnapshot {
  records: readonly ThreadActionRegistrationRecord[];
  collected: ReadonlyMap<string, CollectedThreadAction>;
  requestRename: (threadId: string) => void;
}

function requestRenameUnavailable(threadId: string): void {
  console.warn(`thread actions: no rename editor for ${threadId}`);
}

let snapshot: ThreadActionRegistrySnapshot = {
  records: [],
  collected: new Map(),
  requestRename: requestRenameUnavailable,
};
const listeners = new Set<() => void>();

function setSnapshot(next: ThreadActionRegistrySnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThreadActionRegistrySnapshot {
  return snapshot;
}

function publishCollected(key: string, value: CollectedThreadAction): void {
  const current = snapshot.collected.get(key);
  if (
    current !== undefined &&
    Object.is(current.data, value.data) &&
    current.sdk === value.sdk &&
    current.navigate === value.navigate
  ) {
    return;
  }
  const collected = new Map(snapshot.collected);
  collected.set(key, value);
  setSnapshot({ ...snapshot, collected });
}

function dropCollected(key: string): void {
  if (!snapshot.collected.has(key)) return;
  const collected = new Map(snapshot.collected);
  collected.delete(key);
  setSnapshot({ ...snapshot, collected });
}

function publishRecords(
  records: readonly ThreadActionRegistrationRecord[],
): void {
  if (
    records.length === snapshot.records.length &&
    records.every(
      (record, index) =>
        record.registration === snapshot.records[index]?.registration,
    )
  ) {
    return;
  }
  setSnapshot({ ...snapshot, records });
}

let threadDemand = new ThreadDemand();

const ThreadActionSurfaceVisibleContext = createContext(true);

export function ThreadActionSurfaceVisibility({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <ThreadActionSurfaceVisibleContext.Provider value={visible}>
      <ThreadListContributionVisibility visible={visible}>
        {children}
      </ThreadListContributionVisibility>
    </ThreadActionSurfaceVisibleContext.Provider>
  );
}

export function resetThreadActionRegistryForTest(): void {
  reportedFailures.clear();
  threadDemand = new ThreadDemand();
  setSnapshot({
    records: [],
    collected: new Map(),
    requestRename: requestRenameUnavailable,
  });
}

const reportedFailures = new Set<string>();

function reportFailure(key: string, phase: string, error: unknown): void {
  const id = `${key}:${phase}`;
  if (reportedFailures.has(id)) return;
  reportedFailures.add(id);
  console.error(`thread action "${key}" failed in ${phase}`, error);
}

function useLatestNavigate(navigate: BbNavigate, pluginId: string): BbNavigate {
  const latest = useRef(navigate);
  useLayoutEffect(() => {
    latest.current = navigate;
  });
  const [stable] = useState<BbNavigate>(() => ({
    toThread: (...args) => latest.current.toThread(...args),
    toProject: (...args) => latest.current.toProject(...args),
    toPluginPanel: (...args) => latest.current.toPluginPanel(...args),
    toCompose: (...args) => latest.current.toCompose(...args),
    openThreadPanel: (options) =>
      getActiveThreadPanelOpener()?.({ ...options, pluginId }) ?? false,
    openUrl: (...args) => latest.current.openUrl(...args),
    experimental_openFilePreview: (...args) =>
      latest.current.experimental_openFilePreview(...args),
    experimental_openFileExternally: (...args) =>
      latest.current.experimental_openFileExternally(...args),
    experimental_openTerminal: (...args) =>
      latest.current.experimental_openTerminal(...args),
  }));
  return stable;
}

function ThreadActionCollector({
  record,
}: {
  record: ThreadActionRegistrationRecord;
}) {
  const sdk = useSdk();
  const navigate = useLatestNavigate(useBbNavigate(), record.pluginId);
  const publish = useCallback(
    (data: unknown) => {
      publishCollected(record.key, { data, sdk, navigate });
    },
    [navigate, record.key, sdk],
  );
  const clear = useCallback(() => dropCollected(record.key), [record.key]);
  return (
    <ContributionDataCollector
      useData={record.registration.useData}
      demand={threadDemand}
      publish={publish}
      clear={clear}
    />
  );
}

function useThreadActionRecords(
  coreRegistrations: readonly PluginThreadActionRegistration<unknown>[],
): readonly ThreadActionRegistrationRecord[] {
  const slots = usePluginSlots().threadActions;
  const records = [
    ...coreRegistrations.map((registration) => ({
      key: `${CORE_THREAD_ACTION_OWNER}/${registration.id}`,
      instanceKey: `${CORE_THREAD_ACTION_OWNER}/${registration.id}`,
      pluginId: CORE_THREAD_ACTION_OWNER,
      registration,
    })),
    ...slots.map((slot) => ({
      key: `${slot.pluginId}/${slot.id}`,
      instanceKey: `${slot.pluginId}/${slot.id}/${slot.generation}`,
      pluginId: slot.pluginId,
      registration: slot,
    })),
  ];
  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) =>
      compareGroupedPlacement(
        left.record.registration,
        left.index,
        right.record.registration,
        right.index,
      ),
    )
    .map(({ record }) => record);
}

export function ThreadActionCollectors({
  coreRegistrations,
  requestRename,
}: {
  coreRegistrations: readonly PluginThreadActionRegistration<unknown>[];
  requestRename: (threadId: string) => void;
}) {
  const records = useThreadActionRecords(coreRegistrations);
  const latestRename = useRef(requestRename);
  useLayoutEffect(() => {
    latestRename.current = requestRename;
  });
  useLayoutEffect(() => {
    publishRecords(records);
  });
  useLayoutEffect(() => {
    setSnapshot({
      ...snapshot,
      requestRename: (threadId) => latestRename.current(threadId),
    });
    return () => {
      setSnapshot({ ...snapshot, requestRename: requestRenameUnavailable });
    };
  }, []);
  return records.map((record) => (
    <PluginContext.Provider key={record.instanceKey} value={record.pluginId}>
      <ContributionCollectorBoundary
        onError={(error) => {
          reportFailure(record.key, "useData", error);
          dropCollected(record.key);
        }}
      >
        <ThreadActionCollector record={record} />
      </ContributionCollectorBoundary>
    </PluginContext.Provider>
  ));
}

function containRun(
  key: string,
  run: () => void | Promise<void>,
): Promise<void> {
  try {
    return Promise.resolve(run()).catch((error: unknown) => {
      console.error(`thread action "${key}" failed`, error);
    });
  } catch (error) {
    console.error(`thread action "${key}" failed`, error);
    return Promise.resolve();
  }
}

export function bindThreadAction(
  key: string,
  action: PluginThreadAction,
  requestRename: (threadId: string) => void,
): PluginBoundThreadAction {
  return {
    ...action,
    run: (value) =>
      containRun(key, () =>
        action.run({
          ...(value !== undefined ? { value } : {}),
          requestRename,
        }),
      ),
  };
}

function evaluateRecord(
  record: ThreadActionRegistrationRecord,
  thread: PluginThreadActionTarget,
  registry: ThreadActionRegistrySnapshot,
  requestRename: (threadId: string) => void,
): PluginThreadActionEntry | null {
  const input = registry.collected.get(record.key);
  if (input === undefined) return null;
  try {
    const action = record.registration.item({
      thread,
      data: input.data,
      sdk: input.sdk,
      navigate: input.navigate,
    });
    if (action === null) return null;
    return {
      key: record.key,
      pluginId: record.pluginId,
      group: record.registration.group,
      action: bindThreadAction(record.key, action, requestRename),
    };
  } catch (error) {
    reportFailure(record.key, "item", error);
    return null;
  }
}

function evaluateThreadActions(
  registry: ThreadActionRegistrySnapshot,
  thread: PluginThreadActionTarget,
  options: PluginThreadActionsOptions | undefined,
): PluginThreadActionEntry[] {
  const requestRename = options?.requestRename ?? registry.requestRename;
  const records =
    options?.keys === undefined
      ? registry.records
      : options.keys.flatMap((key) => {
          const record = registry.records.find(
            (candidate) => candidate.key === key,
          );
          return record === undefined ? [] : [record];
        });
  return records.flatMap((record) => {
    const entry = evaluateRecord(record, thread, registry, requestRename);
    return entry === null ? [] : [entry];
  });
}

export function useThreadActionEntries(
  thread: PluginThreadActionTarget,
  options?: PluginThreadActionsOptions,
): readonly PluginThreadActionEntry[] {
  const registry = useSyncExternalStore(subscribe, getSnapshot);
  const surfaceVisible = useContext(ThreadActionSurfaceVisibleContext);
  useEffect(
    () => (surfaceVisible ? threadDemand.retain([thread.id]) : undefined),
    [surfaceVisible, thread.id],
  );
  return evaluateThreadActions(registry, thread, options);
}

export function useDefaultRequestRename(): (threadId: string) => void {
  return useSyncExternalStore(subscribe, getSnapshot).requestRename;
}

export function useThreadActionRegistrationInfos(): readonly PluginThreadActionRegistrationInfo[] {
  const { records } = useSyncExternalStore(subscribe, getSnapshot);
  return records.map((record) => ({
    key: record.key,
    pluginId: record.pluginId,
    title: record.registration.title,
    icon: record.registration.icon,
  }));
}
