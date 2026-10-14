// @vitest-environment jsdom

import { useEffect, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  installTestPluginRuntime,
  loadPluginApp,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import {
  definePluginApp,
  experimental_usePluginId,
  experimental_useThreadListContributions,
  experimental_useThreadRowDecorations,
} from "@get-bb/plugin-sdk/app";
import { makePluginProject, makeSidebarThread } from "../model/fixtures.js";
import { preferencesReadyAtom } from "../preferences/preferences-sync.js";
import {
  sidebarCollapsedContributionGroupsAtom,
  sidebarOrganizationModeAtom,
} from "../preferences/atoms.js";
import { buildContributionGroupKey } from "../../shared/preferences.js";

installTestPluginRuntime();
const { ProjectList } = await import("./ProjectList.js");
const { resetSidebarDataCacheForTest } =
  await import("../model/use-sidebar-data.js");

afterEach(() => {
  cleanup();
  resetSidebarDataCacheForTest();
});

const threads = [
  makeSidebarThread({ id: "root-a", title: "Alpha" }),
  makeSidebarThread({ id: "child", title: "Nested", parentThreadId: "root-a" }),
  makeSidebarThread({ id: "root-b", title: "Beta" }),
];

function Harness({
  children,
  store,
}: {
  children: ReactNode;
  store: ReturnType<typeof createStore>;
}) {
  return (
    <TooltipProvider>
      <Provider store={store}>{children}</Provider>
    </TooltipProvider>
  );
}

describe("public thread-list contributions", () => {
  it("merges root and visible demands once per owner, keeps entire trees and recovers saved selection after reload", async () => {
    let groupMounts = 0;
    let rowMounts = 0;
    let groupIds: readonly string[] = [];
    let rowIds: readonly string[] = [];
    let label = "Alpha group";
    let throws = false;
    let hookThrows = false;
    const adapter = await loadPluginApp(
      definePluginApp((app) => {
        app.slots.experimental_threadListGrouping({
          id: "roots",
          title: "Adapter groups",
          useData({ threadIds }) {
            const owner = experimental_usePluginId();
            useEffect(() => {
              groupMounts++;
              return () => {
                groupMounts--;
              };
            }, []);
            groupIds = threadIds;
            if (hookThrows) throw new Error("group hook failed");
            return owner;
          },
          projection({ thread, data }) {
            if (throws) throw new Error("projection failed");
            if (data !== "adapter") return { status: "error" };
            return {
              status: "ready",
              group: {
                key: thread.id,
                label: thread.id === "root-a" ? label : "Beta group",
                avatar: null,
              },
            };
          },
        });
        app.slots.experimental_threadRowDecoration({
          id: "info",
          title: "Adapter info",
          useData({ threadIds }) {
            const owner = experimental_usePluginId();
            useEffect(() => {
              rowMounts++;
              return () => {
                rowMounts--;
              };
            }, []);
            rowIds = threadIds;
            return owner;
          },
          item({ thread, data }) {
            return {
              text: thread.id,
              accessibleLabel: `${data}: ${thread.displayTitle}`,
            };
          },
        });
      }),
    );
    const store = createStore();
    store.set(preferencesReadyAtom(), true);
    store.set(sidebarOrganizationModeAtom, "adapter/roots");
    const plugins = [
      { pluginId: "adapter", generation: 1, registrations: adapter },
    ];
    let selected = 0;
    const ui = (
      <ProjectList
        activeThreadId={null}
        onProjectSelect={() => {
          selected++;
        }}
      />
    );
    const slot = renderSlot(
      { component: Harness },
      { children: ui, store },
      {
        experimental_threadListPlugins: plugins,
        sidebarThreads: {
          threads,
          projects: [makePluginProject()],
          sections: [],
        },
      },
    );
    await screen.findByText("Alpha group");
    expect(
      screen.queryByRole("button", { name: "New thread in Alpha group" }),
    ).toBeNull();
    await waitFor(() => {
      expect(groupIds).toEqual(["root-a", "root-b"]);
      expect(rowIds).toEqual(["child", "root-a", "root-b"]);
      expect(groupMounts).toBe(1);
      expect(rowMounts).toBe(1);
    });
    expect(screen.getByRole("img", { name: "adapter: Nested" })).toBeTruthy();
    const collapsedKey = buildContributionGroupKey(
      "adapter/roots",
      "group",
      "root-a",
    );
    act(() =>
      store.set(sidebarCollapsedContributionGroupsAtom, [collapsedKey]),
    );
    await waitFor(() => expect(rowIds).toEqual(["root-b"]));
    expect(groupIds).toEqual(["root-a", "root-b"]);
    label = "Renamed group";
    slot.lifecycle.rerender(<Harness store={store}>{ui}</Harness>);
    await screen.findByText("Renamed group");
    expect(store.get(sidebarCollapsedContributionGroupsAtom)).toEqual([
      collapsedKey,
    ]);
    expect(screen.queryByText("Nested")).toBeNull();
    throws = true;
    slot.lifecycle.rerender(<Harness store={store}>{ui}</Harness>);
    await screen.findByText("Alpha");
    expect(screen.queryByText("Renamed group")).toBeNull();
    expect(store.get(sidebarOrganizationModeAtom)).toBe("adapter/roots");
    throws = false;
    slot.lifecycle.rerender(<Harness store={store}>{ui}</Harness>);
    await screen.findByText("Renamed group");
    hookThrows = true;
    slot.lifecycle.rerender(<Harness store={store}>{ui}</Harness>);
    await screen.findByText("Alpha");
    hookThrows = false;
    plugins[0].generation++;
    slot.lifecycle.rerender(<Harness store={store}>{ui}</Harness>);
    await screen.findByText("Renamed group");
    plugins.splice(0);
    slot.lifecycle.rerender(<Harness store={store}>{ui}</Harness>);
    await screen.findByText("Alpha");
    expect(store.get(sidebarOrganizationModeAtom)).toBe("adapter/roots");
    await waitFor(() => {
      expect(groupMounts).toBe(0);
      expect(rowMounts).toBe(0);
    });
    plugins.push({
      pluginId: "adapter",
      generation: 3,
      registrations: adapter,
    });
    slot.lifecycle.rerender(<Harness store={store}>{ui}</Harness>);
    await screen.findByText("Renamed group");
    act(() => store.set(sidebarCollapsedContributionGroupsAtom, []));
    await screen.findByRole("img", { name: "adapter: Alpha" });
    const link = screen.getByRole("link", { name: "Open Alpha" });
    expect(link.getAttribute("href")).toBe(threads[0].href);
    fireEvent.click(link);
    expect(selected).toBe(1);
  });

  it("discovers multiple owners without running unselected grouping hooks and stably composes only valid row items", async () => {
    let selectedMounts = 0;
    let unselectedMounts = 0;
    let rows: readonly string[] = [];
    let roots: readonly string[] = [];
    const adapter = await loadPluginApp(
      definePluginApp((app) => {
        app.slots.experimental_threadListGrouping({
          id: "one",
          title: "One",
          useData({ threadIds }) {
            roots = threadIds;
            useEffect(() => {
              selectedMounts++;
              return () => {
                selectedMounts--;
              };
            }, []);
          },
          projection: () => ({ status: "loading" }),
        });
        app.slots.experimental_threadListGrouping({
          id: "two",
          title: "Two",
          useData() {
            useEffect(() => {
              unselectedMounts++;
              return () => {
                unselectedMounts--;
              };
            }, []);
          },
          projection: () => ({ status: "ready", group: null }),
        });
        app.slots.experimental_threadRowDecoration({
          id: "good",
          title: "Good",
          useData({ threadIds }) {
            rows = threadIds;
          },
          item: ({ thread }) => ({
            text: thread.id,
            accessibleLabel: `Good ${thread.id}`,
          }),
        });
        app.slots.experimental_threadRowDecoration({
          id: "hook-error",
          title: "Hook error",
          useData() {
            throw new Error("broken hook");
          },
          item: () => ({ text: "bad", accessibleLabel: "bad" }),
        });
        app.slots.experimental_threadRowDecoration({
          id: "throws",
          title: "Bad",
          item() {
            throw new Error("broken item");
          },
        });
        app.slots.experimental_threadRowDecoration({
          id: "remote",
          title: "Remote",
          item: () => ({
            text: "remote",
            accessibleLabel: "Remote",
            avatar: {
              src: "https://other.invalid/a.png",
              alt: "Remote avatar",
            },
          }),
        });
      }),
    );
    function Row({ id }: { id: string }) {
      const items = experimental_useThreadRowDecorations(
        makeSidebarThread({ id }),
      );
      return <p>{items.map((entry) => entry.key).join(",")}</p>;
    }
    function OtherList() {
      experimental_useThreadListContributions({
        rootThreadIds: ["other-root", "root-a"],
        groupingKey: "z/one",
      });
      experimental_useThreadListContributions({
        rootThreadIds: ["hidden-root"],
        groupingKey: "z/one",
        visible: false,
      });
      return <Row id="child" />;
    }
    function Probe({ more = true }: { more?: boolean }) {
      const groups = experimental_useThreadListContributions({
        rootThreadIds: ["outside-viewport", "root-a"],
        groupingKey: "z/one",
      });
      return (
        <>
          <output>
            {groups.groupings.map((entry) => entry.key).join(",")}
          </output>
          <output>{groups.grouping?.(threads[0]).status ?? "missing"}</output>
          <Row id="root-a" />
          {more ? (
            <>
              <Row id="root-a" />
              <OtherList />
            </>
          ) : null}
        </>
      );
    }
    const slot = renderSlot(
      { component: Probe },
      {},
      {
        experimental_threadListPlugins: [
          { pluginId: "z", registrations: adapter },
          { pluginId: "a", registrations: adapter },
        ],
      },
    );
    await screen.findByText("loading");
    expect(screen.getByText("a/one,a/two,z/one,z/two")).toBeTruthy();
    await waitFor(() => {
      expect(rows).toEqual(["child", "root-a"]);
      expect(selectedMounts).toBe(1);
      expect(roots).toEqual(["other-root", "outside-viewport", "root-a"]);
    });
    expect(unselectedMounts).toBe(0);
    expect(screen.getAllByText("a/good,z/good")).toHaveLength(3);
    slot.lifecycle.rerender(<Probe more={false} />);
    await waitFor(() => {
      expect(rows).toEqual(["root-a"]);
      expect(roots).toEqual(["outside-viewport", "root-a"]);
    });
    slot.lifecycle.unmount();
    expect(selectedMounts).toBe(0);
  });
});
