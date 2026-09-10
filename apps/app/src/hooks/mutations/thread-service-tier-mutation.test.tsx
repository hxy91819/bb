// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ResolvedThreadExecutionOptions } from "@bb/domain";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useThreadDefaultExecutionOptions } from "../queries/thread-default-execution-options-query";
import { useUpdateThreadServiceTier } from "./thread-service-tier-mutation";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { update: vi.fn(), defaultExecutionOptions: vi.fn() } },
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
}));

const DEFAULTS: ResolvedThreadExecutionOptions = {
  model: "gpt-5",
  reasoningLevel: "medium",
  permissionMode: "full",
  serviceTier: "fast",
  source: "client/turn/requested",
};

beforeEach(() => {
  vi.mocked(sdk.threads.defaultExecutionOptions).mockResolvedValue(DEFAULTS);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});

function useSelection(threadId: string) {
  const defaults = useThreadDefaultExecutionOptions(threadId);
  const update = useUpdateThreadServiceTier(threadId);
  return { defaults, update };
}

it("keeps a saved tier when returning after leaving during the update", async () => {
  const pending = createDeferredPromise<void>();
  let saved = DEFAULTS;
  vi.mocked(sdk.threads.defaultExecutionOptions).mockImplementation(
    async ({ threadId }) => (threadId === "thr_fast" ? saved : DEFAULTS),
  );
  vi.mocked(sdk.threads.update).mockImplementation(
    async ({ threadId, serviceTier }) => {
      await pending.promise;
      saved = { ...DEFAULTS, serviceTier: serviceTier ?? "fast" };
      return makeThreadResponse({ id: threadId });
    },
  );
  const { wrapper } = createQueryClientTestHarness();
  const { result, rerender, unmount } = renderHook(useSelection, {
    wrapper,
    initialProps: "thr_fast",
  });
  await waitFor(() =>
    expect(result.current.defaults.data?.serviceTier).toBe("fast"),
  );
  act(() =>
    result.current.update.mutate({
      threadId: "thr_fast",
      serviceTier: "default",
    }),
  );
  await waitFor(() => expect(sdk.threads.update).toHaveBeenCalled());
  rerender("thr_other");
  await act(async () => pending.resolve());
  await waitFor(() => expect(saved.serviceTier).toBe("default"));
  expect(result.current.defaults.data?.serviceTier).toBe("fast");
  rerender("thr_fast");
  await waitFor(() =>
    expect(result.current.defaults.data?.serviceTier).toBe("default"),
  );
  unmount();
  const reopened = renderHook(() => useSelection("thr_fast"), { wrapper });
  await waitFor(() =>
    expect(reopened.result.current.defaults.data?.serviceTier).toBe("default"),
  );
});

it("preserves the saved tier when the update fails", async () => {
  vi.mocked(sdk.threads.update).mockRejectedValue(new Error("Save failed"));
  const { wrapper } = createQueryClientTestHarness();
  const { result } = renderHook(() => useSelection("thr_failed"), { wrapper });
  await waitFor(() =>
    expect(result.current.defaults.data?.serviceTier).toBe("fast"),
  );
  act(() =>
    result.current.update.mutate({
      threadId: "thr_failed",
      serviceTier: "default",
    }),
  );
  await waitFor(() => expect(result.current.update.isError).toBe(true));
  expect(result.current.defaults.data?.serviceTier).toBe("fast");
});
