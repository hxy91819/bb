// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { makeProjectResponse } from "@/test/fixtures/projects";
import { ProjectModeSections } from "./ProjectList";
import {
  sidebarProjectOrderAtom,
  sidebarSectionOrderAtom,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";

const mockUseSidebarSortable = vi.hoisted(() => vi.fn());
const mockProjectRows = vi.hoisted(() => new Map<string, boolean>());

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: vi.fn(() => ({ data: [] })),
  usePrimaryHost: vi.fn(() => null),
}));

vi.mock("@/hooks/queries/host-path-queries", () => ({
  isHostPathMissing: vi.fn(() => false),
  useHostPathExistence: vi.fn(() => ({})),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: vi.fn(() => ({
    data: { experiments: { sidebarProgressiveDisclosure: false } },
  })),
}));

vi.mock("./ProjectRow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ProjectRow")>();
  return {
    ...actual,
    ProjectThreadTree: () => null,
  };
});

vi.mock("./ProjectListProjects", () => ({
  SortableProjectRow: (props: {
    project: { id: string; name: string };
    reorderDisabled: boolean;
    sortableId: string;
  }) => {
    mockProjectRows.set(props.sortableId, props.reorderDisabled);
    return <div data-testid={props.sortableId}>{props.project.name}</div>;
  },
}));

vi.mock("./sortableMotion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sortableMotion")>();
  return {
    ...actual,
    useSidebarSortable: (args: { id: string; disabled: boolean }) => {
      mockUseSidebarSortable(args);
      return {
        dragBindings: {
          attributes: {},
          disabled: args.disabled,
          listeners: undefined,
          setActivatorNodeRef: vi.fn(),
        },
        isOver: false,
        setNodeRef: vi.fn(),
        style: {},
      };
    },
  };
});

function assertDocumentOrder(elements: HTMLElement[]) {
  for (let index = 1; index < elements.length; index += 1) {
    expect(
      elements[index - 1].compareDocumentPosition(elements[index]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  }
}

function renderProjectMode({
  store,
  oldSequence = null,
  newSequence = null,
  personalSequence = null,
}: {
  store: ReturnType<typeof createStore>;
  oldSequence?: number | null;
  newSequence?: number | null;
  personalSequence?: number | null;
}) {
  return render(
    <JotaiProvider store={store}>
      <ProjectModeSections
        personalProject={makeProjectResponse({
          id: PERSONAL_PROJECT_ID,
          kind: "personal",
          name: "Personal",
          recentExplicitWorkSequence: personalSequence,
        })}
        projects={[
          makeProjectResponse({
            id: "project_old",
            name: "Old project",
            recentExplicitWorkSequence: oldSequence,
          }),
          makeProjectResponse({
            id: "project_new",
            name: "New project",
            recentExplicitWorkSequence: newSequence,
          }),
        ]}
        threads={[
          makeThreadListEntry({
            id: "old",
            projectId: "project_old",
          }),
          makeThreadListEntry({
            id: "new",
            projectId: "project_new",
          }),
          makeThreadListEntry({
            id: "personal",
            projectId: PERSONAL_PROJECT_ID,
          }),
        ]}
        draftThreadIds={new Set()}
        effectivePinnedThreadIds={new Set()}
        status="ready"
        showPinnedSection
        pinnedSection={{ label: "Pinned", content: <div>Pinned content</div> }}
        threadsSection={{ label: "Threads" }}
        collapsedSectionIds={new Set()}
        collapsedThreadIds={new Set()}
        collapsedEnvironmentIds={new Set()}
        compareThreads={() => 0}
        onCreateProjectThread={vi.fn()}
        onToggleCollapsed={vi.fn()}
        onToggleThreadCollapsed={vi.fn()}
        onToggleEnvironmentCollapsed={vi.fn()}
      />
    </JotaiProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockProjectRows.clear();
  window.localStorage.clear();
});

describe("ProjectModeSections project order", () => {
  it("renders recent activity from server sequences, disables reordering, and restores drag order", async () => {
    const store = createStore();
    const manualOrder: SidebarSectionId[] = [
      "project:project_old",
      "threads",
      "project:project_new",
      "pinned",
    ];
    store.set(sidebarSectionOrderAtom, manualOrder);
    store.set(sidebarProjectOrderAtom, "manual");

    const view = renderProjectMode({ store });

    assertDocumentOrder([
      screen.getByTestId("project:project_old"),
      screen.getByText("Threads"),
      screen.getByTestId("project:project_new"),
      screen.getByText("Pinned content"),
    ]);
    expect(mockProjectRows.get("project:project_old")).toBe(false);
    expect(mockProjectRows.get("project:project_new")).toBe(false);

    act(() => store.set(sidebarProjectOrderAtom, "recent"));

    await waitFor(() => {
      assertDocumentOrder([
        screen.getByText("Pinned content"),
        screen.getByTestId("project:project_old"),
        screen.getByText("Threads"),
        screen.getByTestId("project:project_new"),
      ]);
    });
    expect(mockProjectRows.get("project:project_old")).toBe(true);
    expect(mockProjectRows.get("project:project_new")).toBe(true);
    expect(store.get(sidebarSectionOrderAtom)).toEqual(manualOrder);

    view.rerender(
      <JotaiProvider store={store}>
        <ProjectModeSections
          personalProject={makeProjectResponse({
            id: PERSONAL_PROJECT_ID,
            kind: "personal",
            name: "Personal",
            recentExplicitWorkSequence: null,
          })}
          projects={[
            makeProjectResponse({
              id: "project_old",
              name: "Old project",
              recentExplicitWorkSequence: null,
            }),
            makeProjectResponse({
              id: "project_new",
              name: "New project",
              recentExplicitWorkSequence: 1,
            }),
          ]}
          threads={[
            makeThreadListEntry({ id: "old", projectId: "project_old" }),
            makeThreadListEntry({ id: "new", projectId: "project_new" }),
            makeThreadListEntry({
              id: "personal",
              projectId: PERSONAL_PROJECT_ID,
            }),
          ]}
          draftThreadIds={new Set()}
          effectivePinnedThreadIds={new Set()}
          status="ready"
          showPinnedSection
          pinnedSection={{
            label: "Pinned",
            content: <div>Pinned content</div>,
          }}
          threadsSection={{ label: "Threads" }}
          collapsedSectionIds={new Set()}
          collapsedThreadIds={new Set()}
          collapsedEnvironmentIds={new Set()}
          compareThreads={() => 0}
          onCreateProjectThread={vi.fn()}
          onToggleCollapsed={vi.fn()}
          onToggleThreadCollapsed={vi.fn()}
          onToggleEnvironmentCollapsed={vi.fn()}
        />
      </JotaiProvider>,
    );

    await waitFor(() => {
      assertDocumentOrder([
        screen.getByText("Pinned content"),
        screen.getByTestId("project:project_new"),
        screen.getByTestId("project:project_old"),
        screen.getByText("Threads"),
      ]);
    });

    mockProjectRows.clear();
    act(() => store.set(sidebarProjectOrderAtom, "manual"));

    await waitFor(() => {
      assertDocumentOrder([
        screen.getByTestId("project:project_old"),
        screen.getByText("Threads"),
        screen.getByTestId("project:project_new"),
        screen.getByText("Pinned content"),
      ]);
    });
    expect(mockProjectRows.get("project:project_old")).toBe(false);
    expect(mockProjectRows.get("project:project_new")).toBe(false);
    expect(store.get(sidebarSectionOrderAtom)).toEqual(manualOrder);
  });

  it("does not reorder when thread lifecycle changes without a new sequence", () => {
    const store = createStore();
    store.set(sidebarSectionOrderAtom, [
      "project:project_old",
      "threads",
      "project:project_new",
      "pinned",
    ]);
    store.set(sidebarProjectOrderAtom, "recent");

    const view = renderProjectMode({ store, newSequence: 1 });
    assertDocumentOrder([
      screen.getByText("Pinned content"),
      screen.getByTestId("project:project_new"),
      screen.getByTestId("project:project_old"),
      screen.getByText("Threads"),
    ]);

    view.rerender(
      <JotaiProvider store={store}>
        <ProjectModeSections
          personalProject={makeProjectResponse({
            id: PERSONAL_PROJECT_ID,
            kind: "personal",
            name: "Personal",
            recentExplicitWorkSequence: null,
          })}
          projects={[
            makeProjectResponse({
              id: "project_old",
              name: "Old project",
              recentExplicitWorkSequence: null,
            }),
            makeProjectResponse({
              id: "project_new",
              name: "New project",
              recentExplicitWorkSequence: 1,
            }),
          ]}
          threads={[
            makeThreadListEntry({
              id: "old",
              projectId: "project_old",
              status: "active",
            }),
            makeThreadListEntry({
              id: "new",
              projectId: "project_new",
              status: "error",
              latestAttentionAt: 10_000,
            }),
            makeThreadListEntry({
              id: "personal",
              projectId: PERSONAL_PROJECT_ID,
            }),
          ]}
          draftThreadIds={new Set()}
          effectivePinnedThreadIds={new Set()}
          status="ready"
          showPinnedSection
          pinnedSection={{
            label: "Pinned",
            content: <div>Pinned content</div>,
          }}
          threadsSection={{ label: "Threads" }}
          collapsedSectionIds={new Set()}
          collapsedThreadIds={new Set()}
          collapsedEnvironmentIds={new Set()}
          compareThreads={() => 0}
          onCreateProjectThread={vi.fn()}
          onToggleCollapsed={vi.fn()}
          onToggleThreadCollapsed={vi.fn()}
          onToggleEnvironmentCollapsed={vi.fn()}
        />
      </JotaiProvider>,
    );

    assertDocumentOrder([
      screen.getByText("Pinned content"),
      screen.getByTestId("project:project_new"),
      screen.getByTestId("project:project_old"),
      screen.getByText("Threads"),
    ]);
  });
});
