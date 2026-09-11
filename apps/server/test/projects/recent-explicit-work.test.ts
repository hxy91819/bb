import { archiveThread, getProject, getThread } from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createQueuedMessageForThread,
  sendNextQueuedMessageIfPresent,
} from "../../src/services/threads/queued-messages.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  createUserAnswerResolution,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

afterEach(() => vi.restoreAllMocks());

function sequenceOf(harness: TestAppHarness, projectId: string) {
  return getProject(harness.db, projectId)?.recentExplicitWorkSequence ?? null;
}

function seedIdleProjectThread(
  harness: TestAppHarness,
  value: number,
  options: { status?: "active" | "idle" } = {},
) {
  const { host } = seedHostSession(harness.deps, {
    id: `host-recent-work-${value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    name: `project-${value}`,
    path: `/tmp/recent-work-${value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/recent-work-${value}`,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: options.status ?? "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: `provider-recent-work-${value}`,
    threadId: thread.id,
  });
  return { environment, host, project, thread };
}

describe("recent explicit work promotion", () => {
  it.each([
    {
      name: "accepted follow-up send",
      run: async (harness: TestAppHarness) => {
        const { project, thread } = seedIdleProjectThread(harness, 1);
        await acceptThreadSendRequest(harness.deps, {
          thread: getThread(harness.db, thread.id)!,
          payload: { input: textInput("Continue"), mode: "start" },
        });
        return project.id;
      },
    },
    {
      name: "accepted thread create",
      run: async (harness: TestAppHarness) => {
        const { host } = seedHostSession(harness.deps, {
          id: "host-recent-create",
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/recent-create",
        });
        seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: "/tmp/recent-create",
          status: "ready",
        });
        await createThreadFromRequest(harness.deps, {
          environment: {
            type: "host",
            hostId: host.id,
            workspace: { type: "unmanaged", path: "/tmp/recent-create" },
          },
          input: textInput("Start work"),
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          startedOnBehalfOf: null,
        });
        return project.id;
      },
    },
    {
      name: "accepted queued user message",
      run: async (harness: TestAppHarness) => {
        const { project, thread } = seedIdleProjectThread(harness, 2);
        await createQueuedMessageForThread(harness.deps, {
          payload: { input: textInput("Queue this") },
          thread: getThread(harness.db, thread.id)!,
        });
        return project.id;
      },
    },
  ])("promotes the project for $name", async ({ run }) => {
    await withTestHarness(async (harness) => {
      const projectId = await run(harness);
      expect(sequenceOf(harness, projectId)).toBe(1);
    });
  });

  it("promotes an immediate explicit retry and ignores a scheduled retry", async () => {
    await withTestHarness(async (harness) => {
      const immediate = seedIdleProjectThread(harness, 3, { status: "active" });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.failed" },
        threadId: immediate.thread.id,
      });
      await retryFailedTurn(harness.deps, {
        thread: getThread(harness.db, immediate.thread.id)!,
        request: {
          turnRequestId: null,
          sendAt: null,
          reason: "Retry",
        },
      });
      expect(sequenceOf(harness, immediate.project.id)).toBe(1);

      const scheduled = seedIdleProjectThread(harness, 4, { status: "active" });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.failed" },
        threadId: scheduled.thread.id,
      });
      await retryFailedTurn(harness.deps, {
        thread: getThread(harness.db, scheduled.thread.id)!,
        request: {
          turnRequestId: null,
          sendAt: Date.now() + 60_000,
          reason: "Rate limited",
        },
      });
      expect(sequenceOf(harness, scheduled.project.id)).toBeNull();
    });
  });

  it("does not promote rejected sends, child creation, or automatic queue drains", async () => {
    await withTestHarness(async (harness) => {
      const rejected = seedIdleProjectThread(harness, 5);
      archiveThread(harness.db, harness.hub, rejected.thread.id);
      await expect(
        acceptThreadSendRequest(harness.deps, {
          thread: getThread(harness.db, rejected.thread.id)!,
          payload: { input: textInput("Nope"), mode: "start" },
        }),
      ).rejects.toThrow();
      expect(sequenceOf(harness, rejected.project.id)).toBeNull();

      const parent = seedIdleProjectThread(harness, 6);
      await createThreadFromRequest(harness.deps, {
        environment: {
          type: "host",
          hostId: parent.host.id,
          workspace: { type: "unmanaged", path: `/tmp/recent-work-6` },
        },
        input: textInput("Child work"),
        origin: "app",
        parentThreadId: parent.thread.id,
        projectId: parent.project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });
      expect(sequenceOf(harness, parent.project.id)).toBeNull();

      const queued = seedIdleProjectThread(harness, 7);
      await createQueuedMessageForThread(harness.deps, {
        payload: { input: textInput("Later") },
        thread: getThread(harness.db, queued.thread.id)!,
      });
      expect(sequenceOf(harness, queued.project.id)).toBe(1);
      await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: queued.thread.id,
      });
      expect(sequenceOf(harness, queued.project.id)).toBe(1);
    });
  });

  it("assigns a later accepted request a higher shared sequence", async () => {
    await withTestHarness(async (harness) => {
      const first = seedIdleProjectThread(harness, 8);
      const second = seedIdleProjectThread(harness, 9);
      await acceptThreadSendRequest(harness.deps, {
        thread: getThread(harness.db, first.thread.id)!,
        payload: { input: textInput("First"), mode: "start" },
      });
      await acceptThreadSendRequest(harness.deps, {
        thread: getThread(harness.db, second.thread.id)!,
        payload: { input: textInput("Second"), mode: "start" },
      });
      expect(sequenceOf(harness, first.project.id)).toBe(1);
      expect(sequenceOf(harness, second.project.id)).toBe(2);
    });
  });

  it("promotes a project when a pending interaction answer is accepted", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedIdleProjectThread(harness, 10, {
        status: "active",
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        turnId: "turn-recent-work",
        providerThreadId: "provider-recent-work-10",
      });
      const created =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-recent-work",
            providerId: "codex",
            providerThreadId: "provider-recent-work-10",
            providerRequestId: "request-recent-work",
            payload: createUserQuestionPayload(),
          },
        });
      if (created.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${created.reason}`,
        );
      }
      harness.deps.pendingInteractions.resolvePendingInteraction({
        threadId: thread.id,
        interactionId: created.interaction.id,
        resolution: createUserAnswerResolution({
          freeText: "Continue with the current plan.",
        }),
      });
      expect(sequenceOf(harness, project.id)).toBe(1);
    });
  });
});
