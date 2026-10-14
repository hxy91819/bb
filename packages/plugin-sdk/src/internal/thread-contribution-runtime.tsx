import {
  Component,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  PluginSidebarThread,
  PluginThreadActionDataInput,
  experimental_ThreadListContributions,
  experimental_ThreadListContributionsInput,
  experimental_ThreadListGroupingRegistration,
  experimental_ThreadRowDecorationEntry,
  experimental_ThreadRowDecorationRegistration,
} from "../app-contract.js";

/** @internal Shared app host lifecycle; not a plugin metadata cache contract. */
export class ThreadDemand {
  private consumers = new Map<object, readonly string[]>();
  private snapshot: readonly string[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingSince: number | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = (): readonly string[] => this.snapshot;

  retain(ids: readonly string[]): () => void {
    const token = {};
    this.consumers.set(token, ids);
    this.schedule();
    return () => {
      this.consumers.delete(token);
      this.schedule();
    };
  }

  private schedule(): void {
    const now = performance.now();
    this.pendingSince ??= now;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.pendingSince = null;
        const next = [...new Set([...this.consumers.values()].flat())].sort();
        if (
          next.length === this.snapshot.length &&
          next.every((id, index) => id === this.snapshot[index])
        )
          return;
        this.snapshot = next;
        for (const listener of this.listeners) listener();
      },
      Math.max(0, Math.min(32, 100 - (now - this.pendingSince))),
    );
  }
}

/** @internal Shared app host lifecycle; not a plugin metadata cache contract. */
export class ContributionCollectorBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { crashed: boolean }
> {
  override state = { crashed: false };
  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }
  override componentDidCatch(error: Error): void {
    this.props.onError(error);
  }
  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

type Owned<Registration> = Registration & {
  pluginId: string;
  generation: number;
};
/** @internal Shared app host lifecycle; not a plugin metadata cache contract. */
export type ThreadGroupingRecord = Owned<
  experimental_ThreadListGroupingRegistration<unknown>
>;
/** @internal Shared app host lifecycle; not a plugin metadata cache contract. */
export type ThreadDecorationRecord = Owned<
  experimental_ThreadRowDecorationRegistration<unknown>
>;

class CollectedData {
  private snapshot: ReadonlyMap<string, { data: unknown; failed: boolean }> =
    new Map();
  private listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = () => this.snapshot;
  publish(key: string, data: unknown, failed = false): void {
    const current = this.snapshot.get(key);
    if (current && Object.is(current.data, data) && current.failed === failed)
      return;
    const next = new Map(this.snapshot);
    next.set(key, { data, failed });
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  drop(key: string): void {
    if (!this.snapshot.has(key)) return;
    const next = new Map(this.snapshot);
    next.delete(key);
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

function registrationKey(record: { pluginId: string; id: string }): string {
  return `${record.pluginId}/${record.id}`;
}
function instanceKey(record: {
  pluginId: string;
  id: string;
  generation: number;
}): string {
  return `${registrationKey(record)}/${record.generation}`;
}

interface ContributionRuntime {
  roots: Map<string, ThreadDemand>;
  rows: ThreadDemand;
  selected: ThreadDemand;
  collected: CollectedData;
  groupings: readonly ThreadGroupingRecord[];
  decorations: readonly ThreadDecorationRecord[];
  visible: boolean;
}
const RuntimeContext = createContext<ContributionRuntime | null>(null);

/** @internal Shared app host lifecycle; not a plugin metadata cache contract. */
export function ContributionDataCollector({
  useData,
  demand,
  publish,
  clear,
}: {
  useData: ((input: PluginThreadActionDataInput) => unknown) | undefined;
  demand: ThreadDemand;
  publish: (data: unknown) => void;
  clear: () => void;
}) {
  const threadIds = useSyncExternalStore(demand.subscribe, demand.getSnapshot);
  const data = useData?.({ threadIds });
  useLayoutEffect(() => {
    publish(data);
  }, [data, publish]);
  useLayoutEffect(() => clear, [clear]);
  return null;
}

function DataCollector({
  record,
  demand,
  collected,
  kind,
}: {
  record: ThreadGroupingRecord | ThreadDecorationRecord;
  demand: ThreadDemand;
  collected: CollectedData;
  kind: string;
}) {
  const key = `${kind}/${instanceKey(record)}`;
  const publish = useCallback(
    (data: unknown) => collected.publish(key, data),
    [collected, key],
  );
  const clear = useCallback(() => collected.drop(key), [collected, key]);
  return (
    <ContributionDataCollector
      useData={record.useData}
      demand={demand}
      publish={publish}
      clear={clear}
    />
  );
}

/** @internal Shared app host lifecycle; not a plugin metadata cache contract. */
export function ThreadListContributionProvider({
  groupings,
  decorations,
  wrapCollector,
  children,
}: {
  groupings: readonly ThreadGroupingRecord[];
  decorations: readonly ThreadDecorationRecord[];
  wrapCollector: (pluginId: string, child: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const [stores] = useState(() => ({
    roots: new Map<string, ThreadDemand>(),
    rows: new ThreadDemand(),
    selected: new ThreadDemand(),
    collected: new CollectedData(),
  }));
  const selected = useSyncExternalStore(
    stores.selected.subscribe,
    stores.selected.getSnapshot,
  );
  const runtime = useMemo(
    () => ({ ...stores, groupings, decorations, visible: true }),
    [stores, groupings, decorations],
  );
  const collector = (
    record: ThreadGroupingRecord | ThreadDecorationRecord,
    kind: string,
    demand: ThreadDemand,
  ) => {
    const key = `${kind}/${instanceKey(record)}`;
    return (
      <ContributionCollectorBoundary
        key={key}
        onError={(error) => {
          console.error(
            `thread list contribution "${registrationKey(record)}" failed in useData`,
            error,
          );
          stores.collected.publish(key, undefined, true);
        }}
      >
        {wrapCollector(
          record.pluginId,
          <DataCollector
            record={record}
            kind={kind}
            demand={demand}
            collected={stores.collected}
          />,
        )}
      </ContributionCollectorBoundary>
    );
  };
  return (
    <RuntimeContext.Provider value={runtime}>
      {groupings
        .filter((record) => selected.includes(registrationKey(record)))
        .map((record) => {
          const demand = stores.roots.get(registrationKey(record));
          return demand ? collector(record, "group", demand) : null;
        })}
      {decorations.map((record) => collector(record, "row", stores.rows))}
      {children}
    </RuntimeContext.Provider>
  );
}

/** @internal Shared app host lifecycle; not a plugin metadata cache contract. */
export function ThreadListContributionVisibility({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const runtime = useContext(RuntimeContext);
  const value = useMemo(
    () =>
      runtime ? { ...runtime, visible: runtime.visible && visible } : null,
    [runtime, visible],
  );
  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}

function useRuntime(): ContributionRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime)
    throw new Error("Thread list contributions need the app contribution host");
  return runtime;
}

function boundedText(value: string, limit: number): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= limit
  );
}
function validAvatar(
  avatar: { src: string; alt: string } | null | undefined,
): boolean {
  if (avatar == null) return true;
  if (!boundedText(avatar.alt, 160) || typeof avatar.src !== "string")
    return false;
  try {
    const url = new URL(avatar.src, window.location.href);
    return (
      url.origin === window.location.origin &&
      ["http:", "https:"].includes(url.protocol)
    );
  } catch {
    return false;
  }
}

/** @internal Shared app host lifecycle; not a plugin metadata cache contract. */
export function useThreadListContributions(
  input: experimental_ThreadListContributionsInput,
): experimental_ThreadListContributions {
  const runtime = useRuntime();
  const collected = useSyncExternalStore(
    runtime.collected.subscribe,
    runtime.collected.getSnapshot,
  );
  const idsKey = JSON.stringify([...new Set(input.rootThreadIds)].sort());
  const ids = useMemo(() => [...new Set(input.rootThreadIds)].sort(), [idsKey]);
  const visible = runtime.visible && input.visible !== false;
  useEffect(() => {
    if (!visible || !input.groupingKey) return;
    let demand = runtime.roots.get(input.groupingKey);
    if (!demand) {
      demand = new ThreadDemand();
      runtime.roots.set(input.groupingKey, demand);
    }
    const releaseRoots = demand.retain(ids);
    const releaseSelected = runtime.selected.retain([input.groupingKey]);
    return () => {
      releaseRoots();
      releaseSelected();
    };
  }, [runtime.roots, runtime.selected, input.groupingKey, ids, visible]);
  const record = runtime.groupings.find(
    (candidate) => registrationKey(candidate) === input.groupingKey,
  );
  const value = record
    ? collected.get(`group/${instanceKey(record)}`)
    : undefined;
  return {
    groupings: [...runtime.groupings]
      .sort((a, b) => (registrationKey(a) < registrationKey(b) ? -1 : 1))
      .map((candidate) => ({
        key: registrationKey(candidate),
        title: candidate.title,
      })),
    grouping:
      record && !value?.failed
        ? (thread) => {
            if (!value) return { status: "loading" };
            try {
              const result = record.projection({ thread, data: value.data });
              if (result.status === "loading" || result.status === "error")
                return result;
              if (
                result.status !== "ready" ||
                (result.group !== null &&
                  (!boundedText(result.group.key, 256) ||
                    !boundedText(result.group.label, 80) ||
                    !validAvatar(result.group.avatar)))
              ) {
                throw new Error(
                  `Invalid grouping from ${registrationKey(record)}`,
                );
              }
              return result;
            } catch (error) {
              console.error(
                `thread list contribution "${registrationKey(record)}" failed in projection`,
                error,
              );
              return { status: "error" };
            }
          }
        : null,
  };
}

/** @internal Shared app host lifecycle; not a plugin metadata cache contract. */
export function useThreadRowDecorations(
  thread: PluginSidebarThread,
): readonly experimental_ThreadRowDecorationEntry[] {
  const runtime = useRuntime();
  const collected = useSyncExternalStore(
    runtime.collected.subscribe,
    runtime.collected.getSnapshot,
  );
  useEffect(
    () => (runtime.visible ? runtime.rows.retain([thread.id]) : undefined),
    [runtime.rows, runtime.visible, thread.id],
  );
  return [...runtime.decorations]
    .sort((a, b) => (registrationKey(a) < registrationKey(b) ? -1 : 1))
    .flatMap((record) => {
      const value = collected.get(`row/${instanceKey(record)}`);
      if (!value || value.failed) return [];
      try {
        const decoration = record.item({ thread, data: value.data });
        if (decoration === null) return [];
        if (
          !boundedText(decoration.text, 80) ||
          !boundedText(decoration.accessibleLabel, 160) ||
          !validAvatar(decoration.avatar)
        )
          throw new Error("Invalid row decoration");
        return [{ key: registrationKey(record), decoration }];
      } catch (error) {
        console.error(
          `thread row contribution "${registrationKey(record)}" failed in item`,
          error,
        );
        return [];
      }
    });
}
