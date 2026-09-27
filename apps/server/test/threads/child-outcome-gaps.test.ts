import {
  getQueuedThreadMessage,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  turnRequestEventDataSchema,
} from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finalizeStoppedThread,
  interruptActiveThreadsForHost,
} from "../../src/services/threads/thread-lifecycle.js";
import { queueChildThreadTurnNotificationBestEffort } from "../../src/services/threads/child-thread-notifications.js";
import { interruptEnvironmentProvisioningForHost } from "../../src/services/environments/environment-engine.js";
import { failThreadProvisioning } from "../../src/services/threads/thread-provisioning-environment.js";
import { recordQueuedMessageDrainFailure } from "../../src/services/threads/queue-drain-failure.js";
import {
  seedQueuedMessage,
  seedEnvironment,
  seedEvent,
  seedHost,
  seedStoredEvent,
  seedThread,
  seedThreadFixture,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedParentAndChild(
  harness: TestAppHarness,
  childStatus: "active" | "starting" | "idle",
) {
  const {
    project,
    environment,
    session,
    thread: parent,
  } = seedThreadFixture(harness);
  seedThreadRuntimeState(harness.deps, {
    threadId: parent.id,
    environmentId: environment.id,
    providerThreadId: "parent-provider-thread",
  });
  const child = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    parentThreadId: parent.id,
    status: childStatus,
    title: "Worker child",
  });
  return { parent, child, environment, session };
}

function parentSystemRequests(harness: TestAppHarness, parentThreadId: string) {
  return listEvents(harness.db, { threadId: parentThreadId })
    .filter((row) => row.type === "client/turn/requested")
    .map((row) => turnRequestEventDataSchema.parse(JSON.parse(row.data)))
    .filter((data) => data.initiator === "system");
}

afterEach(() => vi.useRealTimers());

describe("child outcomes without provider completion", () => {
  it("keeps a manual Stop silent when it synthesizes an open turn interruption", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child, environment } = seedParentAndChild(
        harness,
        "active",
      );
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: child.id,
        turnId: "child-turn",
      });

      vi.useFakeTimers();
      finalizeStoppedThread(harness.deps, { threadId: child.id });
      finalizeStoppedThread(harness.deps, { threadId: child.id });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(parentSystemRequests(harness, parent.id)).toHaveLength(0);
      expect(
        listEvents(harness.db, { threadId: child.id }).some(
          (event) =>
            event.type === "turn/completed" &&
            JSON.parse(event.data).status === "interrupted",
        ),
      ).toBe(true);
    });
  });

  it.each([
    { reason: "manual-stop", expectedNotices: 0 },
    { reason: "host-daemon-restarted", expectedNotices: 1 },
  ])(
    "sends $expectedNotices parent notices for a provider interruption after $reason",
    async ({ reason, expectedNotices }) => {
      await withTestHarness(async (harness) => {
        const { parent, child, environment, session } = seedParentAndChild(
          harness,
          "active",
        );
        seedTurnStarted(harness.deps, {
          environmentId: environment.id,
          threadId: child.id,
          turnId: "child-turn",
        });
        seedEvent(harness.deps, {
          threadId: child.id,
          environmentId: environment.id,
          providerThreadId: "provider-child-turn",
          sequence: 2,
          type: "system/thread/interrupted",
          scope: threadScope(),
          data: { reason },
        });

        vi.useFakeTimers();
        const response = await harness.app.request("/internal/session/events", {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            eventGroups: groupHostDaemonEvents([
              {
                threadId: child.id,
                event: {
                  type: "turn/completed",
                  threadId: child.id,
                  providerThreadId: "provider-child-turn",
                  scope: turnScope("child-turn"),
                  status: "interrupted",
                },
              },
            ]),
          }),
        });
        expect(response.status).toBe(200);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(parentSystemRequests(harness, parent.id)).toHaveLength(
          expectedNotices,
        );
        if (expectedNotices === 1) {
          expect(
            parentSystemRequests(harness, parent.id)[0]?.systemMessageSubject,
          ).toMatchObject({
            outcomes: [
              {
                threadId: child.id,
                status: "interrupted",
                interruption: { reason: "host-daemon-restarted" },
              },
            ],
          });
        }
      });
    },
  );

  it("keeps each interruption cause attached to its child in a batch", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child } = seedParentAndChild(harness, "idle");
      const sibling = seedThread(harness.deps, {
        projectId: parent.projectId,
        environmentId: child.environmentId,
        parentThreadId: parent.id,
        status: "idle",
        title: "Sibling child",
      });

      vi.useFakeTimers();
      await queueChildThreadTurnNotificationBestEffort(harness.deps, {
        author: null,
        childThread: child,
        parentThreadId: parent.id,
        turnStatus: "interrupted",
        interruption: {
          reason: "host-daemon-restarted",
          cause: "host-connection-lost",
        },
      });
      await queueChildThreadTurnNotificationBestEffort(harness.deps, {
        author: null,
        childThread: child,
        parentThreadId: parent.id,
        turnStatus: "interrupted",
      });
      await queueChildThreadTurnNotificationBestEffort(harness.deps, {
        author: null,
        childThread: sibling,
        parentThreadId: parent.id,
        turnStatus: "interrupted",
        interruption: { reason: "host-daemon-restarted" },
      });
      await vi.advanceTimersByTimeAsync(2_000);

      const [notice] = parentSystemRequests(harness, parent.id);
      expect(notice?.systemMessageKind).toBe("child-outcome-batch");
      expect(notice?.systemMessageSubject).toEqual({
        kind: "thread-batch",
        count: 2,
        outcomes: [
          {
            threadId: child.id,
            status: "interrupted",
            interruption: {
              reason: "host-daemon-restarted",
              cause: "host-connection-lost",
            },
          },
          {
            threadId: sibling.id,
            status: "interrupted",
            interruption: { reason: "host-daemon-restarted" },
          },
        ],
      });
      expect(JSON.stringify(notice?.input)).toContain(
        `@thread:${child.id} was interrupted because its host connection was lost`,
      );
      expect(JSON.stringify(notice?.input)).toContain(
        `@thread:${sibling.id} was interrupted because its host daemon restarted`,
      );
    });
  });

  it("names direct user input on a host-interrupted child outcome", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child, environment } = seedParentAndChild(
        harness,
        "active",
      );
      const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
      seedEvent(harness.deps, {
        threadId: child.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId,
          source: "tell",
          initiator: "user",
          senderThreadId: null,
          input: textInput("You may delete the old files."),
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            permissionMode: "full",
            source: "client/turn/requested",
          },
        },
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: child.id,
        turnId: "child-turn",
        sequence: 2,
      });
      seedEvent(harness.deps, {
        threadId: child.id,
        environmentId: environment.id,
        providerThreadId: "provider-child-turn",
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("child-turn"),
        data: { clientRequestId: requestId },
      });

      vi.useFakeTimers();
      interruptActiveThreadsForHost(harness.deps, {
        hostId: environment.hostId,
        reason: "host-daemon-restarted",
        includeStopping: false,
      });
      await vi.advanceTimersByTimeAsync(2_000);

      const [notice] = parentSystemRequests(harness, parent.id);
      expect(notice?.systemMessageKind).toBe("child-interrupted");
      expect(notice?.systemMessageSubject).toMatchObject({
        outcomes: [
          {
            threadId: child.id,
            status: "interrupted",
            directUserInput: true,
            interruption: { reason: "host-daemon-restarted" },
          },
        ],
      });
      const noticeText = JSON.stringify(notice?.input);
      expect(noticeText).toContain(
        "This turn included input from the user directly in this thread",
      );
      expect(noticeText).toContain(
        "direct instructions to this thread take precedence",
      );
    });
  });

  it("attributes a retried turn to the original requester", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child, environment } = seedParentAndChild(
        harness,
        "active",
      );
      const originalRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
      const retryRequestId = encodeClientTurnRequestIdNumber({ value: 2 });
      const requestExecution = {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      };
      seedEvent(harness.deps, {
        threadId: child.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: originalRequestId,
          source: "tell",
          initiator: "user",
          senderThreadId: null,
          input: textInput("You may delete the old files."),
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: requestExecution,
        },
      });
      seedEvent(harness.deps, {
        threadId: child.id,
        environmentId: environment.id,
        sequence: 2,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: retryRequestId,
          retryOfRequestId: originalRequestId,
          retryAttempt: 2,
          source: "tell",
          initiator: "system",
          senderThreadId: null,
          input: textInput("You may delete the old files."),
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: requestExecution,
        },
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: child.id,
        turnId: "child-turn",
        sequence: 3,
      });
      seedEvent(harness.deps, {
        threadId: child.id,
        environmentId: environment.id,
        providerThreadId: "provider-child-turn",
        sequence: 4,
        type: "turn/input/accepted",
        scope: turnScope("child-turn"),
        data: { clientRequestId: retryRequestId },
      });

      vi.useFakeTimers();
      interruptActiveThreadsForHost(harness.deps, {
        hostId: environment.hostId,
        reason: "host-daemon-restarted",
        includeStopping: false,
      });
      await vi.advanceTimersByTimeAsync(2_000);

      const [notice] = parentSystemRequests(harness, parent.id);
      expect(notice?.systemMessageSubject).toMatchObject({
        outcomes: [
          { threadId: child.id, status: "interrupted", directUserInput: true },
        ],
      });
      expect(JSON.stringify(notice?.input)).toContain(
        "This turn included input from the user directly in this thread",
      );
    });
  });

  it("still notifies the parent when a stored turn request is malformed", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child, environment } = seedParentAndChild(
        harness,
        "active",
      );
      const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
      seedStoredEvent(harness.deps, {
        threadId: child.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId,
          source: "tell",
          senderThreadId: null,
          input: textInput("Delete the old files."),
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            permissionMode: "full",
            source: "client/turn/requested",
          },
        },
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: child.id,
        turnId: "child-turn",
        sequence: 2,
      });
      seedEvent(harness.deps, {
        threadId: child.id,
        environmentId: environment.id,
        providerThreadId: "provider-child-turn",
        sequence: 3,
        type: "turn/input/accepted",
        scope: turnScope("child-turn"),
        data: { clientRequestId: requestId },
      });

      vi.useFakeTimers();
      interruptActiveThreadsForHost(harness.deps, {
        hostId: environment.hostId,
        reason: "host-daemon-restarted",
        includeStopping: false,
      });
      await vi.advanceTimersByTimeAsync(2_000);

      const [notice] = parentSystemRequests(harness, parent.id);
      expect(notice?.systemMessageKind).toBe("child-interrupted");
      expect(notice?.systemMessageSubject).toMatchObject({
        outcomes: [
          {
            threadId: child.id,
            status: "interrupted",
            interruption: { reason: "host-daemon-restarted" },
          },
        ],
      });
      const outcome =
        notice?.systemMessageSubject?.kind === "thread"
          ? notice.systemMessageSubject.outcomes?.[0]
          : undefined;
      expect(outcome).not.toHaveProperty("directUserInput");
      expect(JSON.stringify(notice?.input)).not.toContain(
        "did not initiate that input",
      );
    });
  });

  it("notifies the parent when setup fails before the child starts a turn", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child, environment } = seedParentAndChild(
        harness,
        "starting",
      );

      vi.useFakeTimers();
      failThreadProvisioning(harness.deps, {
        thread: child,
        environmentId: environment.id,
        detail: "Workspace setup failed",
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(parentSystemRequests(harness, parent.id)).toMatchObject([
        { systemMessageKind: "child-failed" },
      ]);
      expect(
        JSON.stringify(parentSystemRequests(harness, parent.id)[0]?.input),
      ).toContain("failed during workspace setup before a turn began");
    });
  });

  it("notifies the parent when an environment fails during setup", async () => {
    await withTestHarness(async (harness) => {
      const { parent } = seedParentAndChild(harness, "idle");
      const host = seedHost(harness.deps);
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: parent.projectId,
        status: "provisioning",
      });
      seedThread(harness.deps, {
        projectId: parent.projectId,
        environmentId: environment.id,
        parentThreadId: parent.id,
        status: "starting",
      });

      vi.useFakeTimers();
      interruptEnvironmentProvisioningForHost(harness.deps, {
        hostId: host.id,
        reason: "Host disconnected during setup",
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(parentSystemRequests(harness, parent.id)).toMatchObject([
        { systemMessageKind: "child-failed" },
      ]);
    });
  });

  it("notifies the parent only after a queued send exhausts retries", async () => {
    await withTestHarness(async (harness) => {
      const { parent, child } = seedParentAndChild(harness, "idle");
      const row = seedQueuedMessage(harness.deps, {
        threadId: child.id,
        content: textInput("Continue the child work"),
        waitingOn: { kind: "thread-busy" },
      });

      vi.useFakeTimers();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        recordQueuedMessageDrainFailure(harness.deps, {
          error: new Error("dispatch failed"),
          now: Date.now(),
          row,
          thread: child,
        });
      }
      expect(
        getQueuedThreadMessage(harness.db, row.id)?.nextAttemptAt,
      ).not.toBeNull();
      expect(parentSystemRequests(harness, parent.id)).toHaveLength(0);

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new Error("dispatch failed"),
        now: Date.now(),
        row,
        thread: child,
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(
        getQueuedThreadMessage(harness.db, row.id)?.nextAttemptAt,
      ).toBeNull();
      expect(parentSystemRequests(harness, parent.id)).toMatchObject([
        { systemMessageKind: "child-failed" },
      ]);
      expect(
        JSON.stringify(parentSystemRequests(harness, parent.id)[0]?.input),
      ).toContain("could not send a queued message after retrying");
      expect(listQueuedThreadMessages(harness.db, parent.id)).toHaveLength(0);
    });
  });
});
