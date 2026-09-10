// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { PendingInteraction } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { threadQueryKey } from "../queries/query-keys";
import { useResolveThreadPendingInteraction } from "./thread-interaction-mutations";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      threads: {
        interactions: {
          resolve: vi.fn(),
        },
      },
    },
  };
});

beforeEach(() => {
  vi.mocked(sdk.threads.interactions.resolve).mockResolvedValue(
    {} as PendingInteraction,
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("thread interaction mutations", () => {
  it("promotes a project only after a pending interaction answer is accepted", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(
      threadQueryKey("thread-1"),
      makeThreadResponse({ id: "thread-1", projectId: "project-1" }),
    );
    const { result } = renderHook(
      () => useResolveThreadPendingInteraction(),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        interactionId: "interaction-1",
        resolution: { kind: "user_answer", answers: {} },
        threadId: "thread-1",
      });
    });

    expect(
      JSON.parse(
        window.localStorage.getItem("bb.sidebar.projectActivityPromotions") ??
          "",
      ),
    ).toEqual({
      promotions: { "project-1": 1 },
      sequence: 1,
      version: 1,
    });

    vi.mocked(sdk.threads.interactions.resolve).mockRejectedValueOnce(
      new Error("resolution rejected"),
    );
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          interactionId: "interaction-2",
          resolution: { kind: "user_answer", answers: {} },
          threadId: "thread-1",
        }),
      ).rejects.toThrow("resolution rejected");
    });

    expect(
      JSON.parse(
        window.localStorage.getItem("bb.sidebar.projectActivityPromotions") ??
          "",
      ),
    ).toEqual({
      promotions: { "project-1": 1 },
      sequence: 1,
      version: 1,
    });
  });
});
