// @vitest-environment jsdom

import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BbHttpError } from "@bb/sdk/browser";
import {
  defaultUiPreferences,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import type { UiPreferencesResponse } from "@bb/server-contract";
import {
  getCachedUiPreferences,
  setCachedUiPreferences,
} from "@/hooks/cache-owners/ui-preferences-cache-owner";
import { createJsonLocalStorage } from "../browser-storage";
import { createSyncedPreferenceAtom } from "./synced-preference-atom";
import {
  hasPendingUiPreferenceWrite,
  reconcileUiPreferences,
  resetUiPreferencesSyncForTest,
  startUiPreferencesSync,
  waitForUiPreferenceWrites,
} from "./ui-preferences-sync";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  set: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/sdk", async () => {
  const actual = await import("@bb/sdk/browser");
  return {
    BbHttpError: actual.BbHttpError,
    sdk: {
      system: {
        uiPreferences: {
          list: mocks.list,
          set: mocks.set,
        },
      },
    },
  };
});

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: mocks.toastError },
}));

function serverResponse(
  overrides: Partial<{
    [Key in UiPreferenceKey]: {
      revision: number;
      value: UiPreferenceValue<Key>;
    };
  }> = {},
): UiPreferencesResponse {
  const preferences = Object.fromEntries(
    Object.entries(defaultUiPreferences).map(([key, value]) => [
      key,
      { revision: 0, value },
    ]),
  ) as UiPreferencesResponse["preferences"];
  return { preferences: { ...preferences, ...overrides } };
}

function conflict(currentRevision: number): BbHttpError {
  return new BbHttpError({
    body: { code: "ui_preference_conflict", details: { currentRevision } },
    code: "ui_preference_conflict",
    message: "UI preference changed on another client",
    status: 409,
  });
}

function createHarness() {
  const queryClient = new QueryClient();
  const store = createStore();
  const modeAtom = createSyncedPreferenceAtom({
    key: "sidebar.organizationMode",
    storage:
      createJsonLocalStorage<UiPreferenceValue<"sidebar.organizationMode">>(),
    storageKey: "test.sidebar.organizationMode",
  });
  const orderAtom = createSyncedPreferenceAtom({
    key: "sidebar.sectionOrder",
    storage: createJsonLocalStorage<string[]>(),
    storageKey: "test.sidebar.sectionOrder",
  });
  const collapsedAtom = createSyncedPreferenceAtom({
    debounceMs: 50,
    key: "sidebar.collapsedProjects",
    storage: createJsonLocalStorage<string[]>(),
    storageKey: "test.sidebar.collapsedProjects",
  });
  return { collapsedAtom, modeAtom, orderAtom, queryClient, store };
}

describe("ui preferences sync", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.list.mockReset();
    mocks.set.mockReset();
    mocks.toastError.mockReset();
    mocks.set.mockImplementation(
      async (input: {
        key: string;
        value: unknown;
        expectedRevision: number;
      }) => ({
        key: input.key,
        revision: input.expectedRevision + 1,
        value: input.value,
      }),
    );
  });

  afterEach(() => {
    resetUiPreferencesSyncForTest();
    vi.useRealTimers();
  });

  it("keeps writes local when no sync context has started", () => {
    const { modeAtom, store } = createHarness();
    store.set(modeAtom, "machine");
    expect(store.get(modeAtom)).toBe("machine");
    expect(window.localStorage.getItem("test.sidebar.organizationMode")).toBe(
      '"machine"',
    );
    expect(mocks.set).not.toHaveBeenCalled();
    expect(hasPendingUiPreferenceWrite("sidebar.organizationMode")).toBe(false);
  });

  it("adopts the server value over the local mirror once it has a revision", () => {
    const { modeAtom, queryClient, store } = createHarness();
    window.localStorage.setItem(
      "test.sidebar.organizationMode",
      '"chronological"',
    );
    startUiPreferencesSync({ queryClient, store });
    reconcileUiPreferences(
      serverResponse({
        "sidebar.organizationMode": { revision: 2, value: "machine" },
      }),
    );
    expect(store.get(modeAtom)).toBe("machine");
    expect(window.localStorage.getItem("test.sidebar.organizationMode")).toBe(
      '"machine"',
    );
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("migrates a non-default local value when the server has no revision yet", async () => {
    const { modeAtom, queryClient, store } = createHarness();
    store.set(modeAtom, "chronological");
    mocks.set.mockClear();
    startUiPreferencesSync({ queryClient, store });
    const response = serverResponse();
    setCachedUiPreferences(queryClient, response);
    reconcileUiPreferences(response);
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith({
      expectedRevision: 0,
      key: "sidebar.organizationMode",
      value: "chronological",
    });
    expect(
      getCachedUiPreferences(queryClient)?.preferences[
        "sidebar.organizationMode"
      ],
    ).toEqual({ revision: 1, value: "chronological" });

    reconcileUiPreferences(serverResponse());
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenCalledTimes(1);
  });

  it("does not migrate a default local value", async () => {
    const { queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    reconcileUiPreferences(serverResponse());
    await waitForUiPreferenceWrites();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("writes with the cached revision and records the new entry", async () => {
    const { orderAtom, queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.sectionOrder": {
          revision: 3,
          value: ["pinned", "projects", "threads"],
        },
      }),
    );
    store.set(orderAtom, ["threads", "pinned", "projects"]);
    expect(hasPendingUiPreferenceWrite("sidebar.sectionOrder")).toBe(true);
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenCalledWith({
      expectedRevision: 3,
      key: "sidebar.sectionOrder",
      value: ["threads", "pinned", "projects"],
    });
    expect(
      getCachedUiPreferences(queryClient)?.preferences["sidebar.sectionOrder"],
    ).toEqual({ revision: 4, value: ["threads", "pinned", "projects"] });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("fetches the current revision when nothing is cached", async () => {
    const { modeAtom, queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    mocks.list.mockResolvedValueOnce(
      serverResponse({
        "sidebar.organizationMode": { revision: 5, value: "project" },
      }),
    );
    store.set(modeAtom, "machine");
    await waitForUiPreferenceWrites();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith({
      expectedRevision: 5,
      key: "sidebar.organizationMode",
      value: "machine",
    });
  });

  it("re-applies a functional update on top of the server value after a conflict", async () => {
    const { collapsedAtom, queryClient, store } = createHarness();
    vi.useFakeTimers();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.collapsedProjects": { revision: 1, value: ["prj_a"] },
      }),
    );
    reconcileUiPreferences(getCachedUiPreferences(queryClient)!);
    mocks.set.mockRejectedValueOnce(conflict(2));
    mocks.list.mockResolvedValueOnce(
      serverResponse({
        "sidebar.collapsedProjects": {
          revision: 2,
          value: ["prj_a", "prj_other"],
        },
      }),
    );
    store.set(collapsedAtom, (current) => [...current, "prj_b"]);
    expect(store.get(collapsedAtom)).toEqual(["prj_a", "prj_b"]);
    await vi.advanceTimersByTimeAsync(60);
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenNthCalledWith(1, {
      expectedRevision: 1,
      key: "sidebar.collapsedProjects",
      value: ["prj_a", "prj_b"],
    });
    expect(mocks.set).toHaveBeenNthCalledWith(2, {
      expectedRevision: 2,
      key: "sidebar.collapsedProjects",
      value: ["prj_a", "prj_other", "prj_b"],
    });
    expect(store.get(collapsedAtom)).toEqual(["prj_a", "prj_other", "prj_b"]);
    expect(
      getCachedUiPreferences(queryClient)?.preferences[
        "sidebar.collapsedProjects"
      ],
    ).toEqual({ revision: 3, value: ["prj_a", "prj_other", "prj_b"] });
  });

  it("retries a plain value write with the fresh revision after a conflict", async () => {
    const { modeAtom, queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.organizationMode": { revision: 1, value: "project" },
      }),
    );
    mocks.set.mockRejectedValueOnce(conflict(4));
    mocks.list.mockResolvedValueOnce(
      serverResponse({
        "sidebar.organizationMode": { revision: 4, value: "chronological" },
      }),
    );
    store.set(modeAtom, "machine");
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenLastCalledWith({
      expectedRevision: 4,
      key: "sidebar.organizationMode",
      value: "machine",
    });
    expect(store.get(modeAtom)).toBe("machine");
  });

  it("adopts the server value when the retry also conflicts", async () => {
    const { modeAtom, queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.organizationMode": { revision: 1, value: "project" },
      }),
    );
    mocks.set
      .mockRejectedValueOnce(conflict(2))
      .mockRejectedValueOnce(conflict(3));
    mocks.list
      .mockResolvedValueOnce(
        serverResponse({
          "sidebar.organizationMode": { revision: 2, value: "chronological" },
        }),
      )
      .mockResolvedValueOnce(
        serverResponse({
          "sidebar.organizationMode": { revision: 3, value: "project" },
        }),
      );
    store.set(modeAtom, "machine");
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(store.get(modeAtom)).toBe("project");
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("coalesces writes issued while one is in flight and skips reconcile meanwhile", async () => {
    const { modeAtom, queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.organizationMode": { revision: 1, value: "project" },
      }),
    );
    let releaseFirst: (() => void) | null = null;
    mocks.set.mockImplementationOnce(
      (input: { value: unknown; expectedRevision: number; key: string }) =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({
              key: input.key,
              revision: input.expectedRevision + 1,
              value: input.value,
            });
        }),
    );
    store.set(modeAtom, "machine");
    store.set(modeAtom, "project");
    store.set(modeAtom, "chronological");
    reconcileUiPreferences(
      serverResponse({
        "sidebar.organizationMode": { revision: 9, value: "project" },
      }),
    );
    expect(store.get(modeAtom)).toBe("chronological");
    await vi.waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1));
    releaseFirst!();
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(mocks.set).toHaveBeenLastCalledWith({
      expectedRevision: 2,
      key: "sidebar.organizationMode",
      value: "chronological",
    });
    expect(store.get(modeAtom)).toBe("chronological");
  });

  it("debounces rapid writes into a single request", async () => {
    const { collapsedAtom, queryClient, store } = createHarness();
    vi.useFakeTimers();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.collapsedProjects": { revision: 1, value: [] },
      }),
    );
    store.set(collapsedAtom, (current) => [...current, "prj_a"]);
    store.set(collapsedAtom, (current) => [...current, "prj_b"]);
    await vi.advanceTimersByTimeAsync(30);
    expect(mocks.set).not.toHaveBeenCalled();
    store.set(collapsedAtom, (current) =>
      current.filter((id) => id !== "prj_a"),
    );
    await vi.advanceTimersByTimeAsync(60);
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith({
      expectedRevision: 1,
      key: "sidebar.collapsedProjects",
      value: ["prj_b"],
    });
  });

  it("skips a write whose value already matches the server", async () => {
    const { modeAtom, queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.organizationMode": { revision: 1, value: "machine" },
      }),
    );
    store.set(modeAtom, "machine");
    await waitForUiPreferenceWrites();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("toasts once and invalidates the query on a non-conflict failure", async () => {
    const { modeAtom, queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.organizationMode": { revision: 1, value: "project" },
      }),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    mocks.set.mockRejectedValueOnce(new Error("offline"));
    store.set(modeAtom, "machine");
    await waitForUiPreferenceWrites();
    mocks.set.mockRejectedValueOnce(new Error("offline"));
    store.set(modeAtom, "chronological");
    await waitForUiPreferenceWrites();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(store.get(modeAtom)).toBe("chronological");
  });

  it("never retries a migration against a newer revision", async () => {
    const { modeAtom, queryClient, store } = createHarness();
    store.set(modeAtom, "chronological");
    mocks.set.mockClear();
    startUiPreferencesSync({ queryClient, store });
    const response = serverResponse();
    setCachedUiPreferences(queryClient, response);
    mocks.set.mockRejectedValueOnce(conflict(1));
    mocks.list.mockResolvedValueOnce(
      serverResponse({
        "sidebar.organizationMode": { revision: 1, value: "machine" },
      }),
    );
    reconcileUiPreferences(response);
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith({
      expectedRevision: 0,
      key: "sidebar.organizationMode",
      value: "chronological",
    });
    expect(store.get(modeAtom)).toBe("machine");
  });

  it("does not let a delayed write response roll back a newer cached revision", async () => {
    const { modeAtom, queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.organizationMode": { revision: 1, value: "project" },
      }),
    );
    let release: (() => void) | null = null;
    mocks.set.mockImplementationOnce(
      (input: { value: unknown; expectedRevision: number; key: string }) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              key: input.key,
              revision: input.expectedRevision + 1,
              value: input.value,
            });
        }),
    );
    store.set(modeAtom, "machine");
    await vi.waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1));
    const newer = serverResponse({
      "sidebar.organizationMode": { revision: 3, value: "chronological" },
    });
    setCachedUiPreferences(queryClient, newer);
    reconcileUiPreferences(newer);
    expect(store.get(modeAtom)).toBe("machine");
    release!();
    await waitForUiPreferenceWrites();
    expect(
      getCachedUiPreferences(queryClient)?.preferences[
        "sidebar.organizationMode"
      ],
    ).toEqual({ revision: 3, value: "chronological" });
    expect(store.get(modeAtom)).toBe("chronological");
  });

  it("keeps every debounced functional update when the write conflicts", async () => {
    const { collapsedAtom, queryClient, store } = createHarness();
    vi.useFakeTimers();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.collapsedProjects": { revision: 1, value: [] },
      }),
    );
    mocks.set.mockRejectedValueOnce(conflict(2));
    mocks.list.mockResolvedValueOnce(
      serverResponse({
        "sidebar.collapsedProjects": { revision: 2, value: ["remote"] },
      }),
    );
    store.set(collapsedAtom, (current) => [...current, "prj_a"]);
    store.set(collapsedAtom, (current) => [...current, "prj_b"]);
    await vi.advanceTimersByTimeAsync(60);
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenNthCalledWith(1, {
      expectedRevision: 1,
      key: "sidebar.collapsedProjects",
      value: ["prj_a", "prj_b"],
    });
    expect(mocks.set).toHaveBeenNthCalledWith(2, {
      expectedRevision: 2,
      key: "sidebar.collapsedProjects",
      value: ["remote", "prj_a", "prj_b"],
    });
    expect(store.get(collapsedAtom)).toEqual(["remote", "prj_a", "prj_b"]);
  });

  it("evaluates a functional update against the server value when the mirror is stale", async () => {
    window.localStorage.setItem(
      "test.sidebar.collapsedProjects",
      '["stale_local"]',
    );
    const { collapsedAtom, queryClient, store } = createHarness();
    vi.useFakeTimers();
    startUiPreferencesSync({ queryClient, store });
    mocks.list.mockResolvedValueOnce(
      serverResponse({
        "sidebar.collapsedProjects": { revision: 4, value: ["remote"] },
      }),
    );
    store.set(collapsedAtom, (current) => [...current, "prj_a"]);
    expect(store.get(collapsedAtom)).toEqual(["stale_local", "prj_a"]);
    await vi.advanceTimersByTimeAsync(60);
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenCalledWith({
      expectedRevision: 4,
      key: "sidebar.collapsedProjects",
      value: ["remote", "prj_a"],
    });
    expect(store.get(collapsedAtom)).toEqual(["remote", "prj_a"]);
  });

  it("applies a queued functional update on top of a conflicting in-flight write", async () => {
    const { orderAtom, queryClient, store } = createHarness();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.sectionOrder": { revision: 1, value: ["remote"] },
      }),
    );
    let rejectFirst: (() => void) | null = null;
    mocks.set.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = () => reject(conflict(2));
        }),
    );
    mocks.list.mockResolvedValueOnce(
      serverResponse({
        "sidebar.sectionOrder": { revision: 2, value: ["remote", "other"] },
      }),
    );
    store.set(orderAtom, (current) => [...current, "a"]);
    await vi.waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1));
    store.set(orderAtom, (current) => [...current, "b"]);
    rejectFirst!();
    await waitForUiPreferenceWrites();
    expect(mocks.set).toHaveBeenNthCalledWith(2, {
      expectedRevision: 2,
      key: "sidebar.sectionOrder",
      value: ["remote", "other", "a"],
    });
    expect(mocks.set).toHaveBeenNthCalledWith(3, {
      expectedRevision: 3,
      key: "sidebar.sectionOrder",
      value: ["remote", "other", "a", "b"],
    });
    expect(
      getCachedUiPreferences(queryClient)?.preferences["sidebar.sectionOrder"],
    ).toEqual({ revision: 4, value: ["remote", "other", "a", "b"] });
    expect(store.get(orderAtom)).toEqual(["remote", "other", "a", "b"]);
  });

  it("adopts a pruned server response that arrived while the write was pending", async () => {
    const { collapsedAtom, queryClient, store } = createHarness();
    vi.useFakeTimers();
    startUiPreferencesSync({ queryClient, store });
    setCachedUiPreferences(
      queryClient,
      serverResponse({
        "sidebar.collapsedProjects": { revision: 1, value: [] },
      }),
    );
    let release: (() => void) | null = null;
    mocks.set.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              key: "sidebar.collapsedProjects",
              revision: 2,
              value: [],
            });
        }),
    );
    store.set(collapsedAtom, (current) => [...current, "deleted"]);
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1));
    const broadcast = serverResponse({
      "sidebar.collapsedProjects": { revision: 2, value: [] },
    });
    setCachedUiPreferences(queryClient, broadcast);
    reconcileUiPreferences(broadcast);
    expect(store.get(collapsedAtom)).toEqual(["deleted"]);
    release!();
    await waitForUiPreferenceWrites();
    expect(store.get(collapsedAtom)).toEqual([]);
    expect(window.localStorage.getItem("test.sidebar.collapsedProjects")).toBe(
      "[]",
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
