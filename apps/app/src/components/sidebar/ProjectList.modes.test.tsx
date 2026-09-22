// @vitest-environment jsdom

import { useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createStore,
  Provider as JotaiProvider,
  useAtom,
  useAtomValue,
} from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import {
  ActiveSidebarModeSections,
  MachineModeSections,
  resolveSidebarNewThreadProjectId,
} from "./ProjectList";
import { buildMachineThreadGroups } from "@bb/client-core";
import {
  collapsedSidebarSectionIdsAtom,
  sidebarCollapsedMachinesAtom,
  sidebarManualSectionOrderAtom,
  sidebarMachineSectionOrderAtom,
  sidebarOrganizationModeAtom,
  sidebarSectionOrderAtom,
  type CollapsibleSidebarSectionId,
  type SidebarOrganizationMode,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import { useSidebarModeSectionOrder } from "./useSidebarModeSectionOrder";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";

const mockUseHosts = vi.hoisted(() => vi.fn(() => ({ data: [] })));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: mockUseHosts,
  usePrimaryHost: vi.fn(() => undefined),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));

const queryClient = new QueryClient();

vi.mock("@bb/client-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/client-core")>();
  return {
    ...actual,
    buildMachineThreadGroups: vi.fn(actual.buildMachineThreadGroups),
  };
});

const mockBuildMachineThreadGroups = vi.mocked(buildMachineThreadGroups);

function getModeOrderProbeConfig(mode: SidebarOrganizationMode): {
  entitySectionIds: SidebarSectionId[];
  hasThreadsSection?: boolean;
} {
  switch (mode) {
    case "project":
      return { entitySectionIds: ["project:a"] };
    case "chronological":
      return { entitySectionIds: ["section:a"] };
    case "machine":
      return { entitySectionIds: [], hasThreadsSection: true };
  }
}

function ModeOrderProbe({ mode }: { mode: SidebarOrganizationMode }) {
  const config = getModeOrderProbeConfig(mode);
  const { order } = useSidebarModeSectionOrder({
    mode,
    entitySectionIds: config.entitySectionIds,
    hasThreadsSection: config.hasThreadsSection,
    showPinnedSection: true,
  });

  return <div data-testid={`${mode}-order`}>{order.join(",")}</div>;
}

interface ActiveModeOrderProbeProps {
  mode: SidebarOrganizationMode;
  renderChronological?: () => ReactNode;
  renderMachine?: () => ReactNode;
  renderProject?: () => ReactNode;
}

function ActiveModeOrderProbe({
  mode,
  renderChronological = () => (
    <ModeOrderProbe key="chronological" mode="chronological" />
  ),
  renderMachine = () => <ModeOrderProbe key="machine" mode="machine" />,
  renderProject = () => <ModeOrderProbe key="project" mode="project" />,
}: ActiveModeOrderProbeProps) {
  return (
    <ActiveSidebarModeSections
      mode={mode}
      renderChronological={renderChronological}
      renderMachine={renderMachine}
      renderProject={renderProject}
    />
  );
}

function StoredActiveModeOrderProbe() {
  const mode = useAtomValue(sidebarOrganizationModeAtom);
  return <ActiveModeOrderProbe mode={mode} />;
}

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_machine",
    projectId: "proj_machine",
    title: "Machine activity",
    titleFallback: "Machine activity",
    status: "active",
    lastReadAt: 1,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 1,
      activeGoalCount: 0,
    },
    runtime: {
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  });
}

function MachineModeProbe({ threads = [] }: { threads?: ThreadListEntry[] }) {
  const [collapsedSectionIds, setCollapsedSectionIds] = useAtom(
    collapsedSidebarSectionIdsAtom,
  );
  const collapsedSectionIdSet = useMemo(
    () => new Set(collapsedSectionIds),
    [collapsedSectionIds],
  );
  const handleToggleCollapsed = (id: CollapsibleSidebarSectionId) => {
    setCollapsedSectionIds((current) =>
      current.includes(id)
        ? current.filter((sectionId) => sectionId !== id)
        : [...current, id],
    );
  };

  return (
    <QueryClientProvider client={queryClient}>
      <MachineModeSections
        threads={threads}
        draftThreadIds={new Set()}
        effectivePinnedThreadIds={new Set()}
        status="ready"
        showPinnedSection={false}
        pinnedSection={{ label: "Pinned", content: null }}
        pinnedReorderPending={false}
        pinnedRootNodes={[]}
        pinnedThreads={[]}
        onReorderPinnedThread={vi.fn()}
        threadsSection={{ label: "Threads" }}
        collapsedSectionIds={collapsedSectionIdSet}
        collapsedThreadIds={new Set()}
        collapsedEnvironmentIds={new Set()}
        compareThreads={() => 0}
        renderSectionDisplayOptions={() => null}
        isSectionDisplayOptionsOpen={() => false}
        onToggleCollapsed={handleToggleCollapsed}
        onToggleThreadCollapsed={vi.fn()}
        onToggleEnvironmentCollapsed={vi.fn()}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("sidebar organization mode sections", () => {
  it("does not mount inactive ordering or machine-grouping work", async () => {
    const store = createStore();
    store.set(sidebarSectionOrderAtom, ["threads", "project:a", "pinned"]);
    store.set(sidebarManualSectionOrderAtom, ["section:stale"]);
    store.set(sidebarMachineSectionOrderAtom, ["machine:stale"]);
    const renderChronological = vi.fn(() => (
      <ModeOrderProbe mode="chronological" />
    ));
    const renderMachine = vi.fn(() => <MachineModeProbe />);
    const renderProject = vi.fn(() => <ModeOrderProbe mode="project" />);

    render(
      <JotaiProvider store={store}>
        <ActiveModeOrderProbe
          mode="project"
          renderChronological={renderChronological}
          renderMachine={renderMachine}
          renderProject={renderProject}
        />
      </JotaiProvider>,
    );

    await screen.findByTestId("project-order");
    expect(renderProject).toHaveBeenCalledOnce();
    expect(renderChronological).not.toHaveBeenCalled();
    expect(renderMachine).not.toHaveBeenCalled();
    expect(mockUseHosts).not.toHaveBeenCalled();
    expect(mockBuildMachineThreadGroups).not.toHaveBeenCalled();
    expect(store.get(sidebarManualSectionOrderAtom)).toEqual(["section:stale"]);
    expect(store.get(sidebarMachineSectionOrderAtom)).toEqual([
      "machine:stale",
    ]);
  });

  it("preserves each persisted order while switching modes", async () => {
    const store = createStore();
    const projectOrder = ["threads", "project:a", "pinned"];
    const sectionOrder = ["section:a", "pinned", "threads"];
    const machineOrder = ["threads", "pinned"];
    store.set(sidebarSectionOrderAtom, projectOrder);
    store.set(sidebarManualSectionOrderAtom, sectionOrder);
    store.set(sidebarMachineSectionOrderAtom, machineOrder);
    store.set(sidebarOrganizationModeAtom, "project");
    render(
      <JotaiProvider store={store}>
        <StoredActiveModeOrderProbe />
      </JotaiProvider>,
    );

    expect(await screen.findByTestId("project-order")).not.toBeNull();
    act(() => store.set(sidebarOrganizationModeAtom, "chronological"));
    expect(await screen.findByTestId("chronological-order")).not.toBeNull();
    act(() => store.set(sidebarOrganizationModeAtom, "machine"));
    expect(await screen.findByTestId("machine-order")).not.toBeNull();
    act(() => store.set(sidebarOrganizationModeAtom, "project"));
    expect(await screen.findByTestId("project-order")).not.toBeNull();

    await waitFor(() => {
      expect(store.get(sidebarSectionOrderAtom)).toEqual(projectOrder);
      expect(store.get(sidebarManualSectionOrderAtom)).toEqual(sectionOrder);
      expect(store.get(sidebarMachineSectionOrderAtom)).toEqual(machineOrder);
    });
  });

  it("collapses and expands empty-machine Threads", () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["threads"]);
    store.set(collapsedSidebarSectionIdsAtom, []);

    render(
      <JotaiProvider store={store}>
        <MachineModeProbe />
      </JotaiProvider>,
    );

    expect(screen.getByText("No threads")).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Threads section" }),
    );
    expect(screen.queryByText("No threads")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Expand Threads section" }),
    );
    expect(screen.getByText("No threads")).not.toBeNull();
    expect(mockBuildMachineThreadGroups).toHaveBeenCalledWith([], []);
  });

  it("surfaces shared runtime activity for a collapsed machine section", () => {
    const store = createStore();
    store.set(sidebarMachineSectionOrderAtom, ["machine:no-machine"]);
    store.set(sidebarCollapsedMachinesAtom, ["no-machine"]);

    render(
      <JotaiProvider store={store}>
        <MachineModeProbe threads={[makeThread()]} />
      </JotaiProvider>,
    );

    expect(screen.queryByText("Machine activity")).toBeNull();
    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
  });
});

describe("sidebar new-thread project defaults", () => {
  it("inherits the selected thread project before considering recent threads", () => {
    expect(
      resolveSidebarNewThreadProjectId({
        recentThreads: [
          makeThread({ projectId: "proj_recent", updatedAt: 20 }),
        ],
        rememberedProjectId: "proj_remembered",
        routeProjectId: "proj_selected",
      }),
    ).toBe("proj_selected");
  });

  it("uses the most recent project thread when no thread is selected", () => {
    expect(
      resolveSidebarNewThreadProjectId({
        recentThreads: [
          makeThread({
            id: "thr_personal",
            projectId: PERSONAL_PROJECT_ID,
            status: "idle",
            latestAttentionAt: 100,
          }),
          makeThread({
            id: "thr_project",
            projectId: "proj_recent",
            status: "idle",
            latestAttentionAt: 50,
          }),
        ],
        rememberedProjectId: PERSONAL_PROJECT_ID,
        routeProjectId: undefined,
      }),
    ).toBe("proj_recent");
  });

  it("falls back to the remembered project when no project thread exists", () => {
    expect(
      resolveSidebarNewThreadProjectId({
        recentThreads: [makeThread({ projectId: PERSONAL_PROJECT_ID })],
        rememberedProjectId: "proj_remembered",
        routeProjectId: undefined,
      }),
    ).toBe("proj_remembered");
  });
});
