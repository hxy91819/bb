import { describe, expect, it, vi } from "vitest";
import { builtinPluginSource } from "../../../src/services/plugins/builtin-registry.js";
import { appendThreadEvent } from "../../../src/services/threads/thread-events.js";
import { waitForQueuedCommand } from "../../helpers/commands.js";
import { readJson } from "../../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";
import { startTestServer } from "../../helpers/test-app.js";

describe("Codex child async questions", () => {
  it("notifies the parent and delivers a submitted form answer back to the child", async () => {
    const harness = await startTestServer({ seedFirstPartyProviders: false });
    try {
      harness.pluginService.bindSdk({ baseUrl: harness.baseUrl });
      const plugin = await harness.pluginService.install(
        builtinPluginSource("provider-codex"),
        { kind: "root" },
      );
      expect(plugin.statusDetail ?? "").toBe("");
      expect(plugin.status).toBe("running");
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const parent = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const child = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        parentThreadId: parent.id,
      });
      for (const thread of [parent, child]) {
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          inputText: "Deploy the test environment",
          providerThreadId: `provider-${thread.id}`,
          threadId: thread.id,
        });
      }
      appendThreadEvent(harness.deps, {
        threadId: child.id,
        scope: { kind: "thread" },
        type: "thread/extensionState/updated",
        data: {
          providerThreadId: `provider-${child.id}`,
          kind: "provider-codex/async-question",
          payload: {
            itemId: "question-call-1",
            questions: [
              {
                title: "Does the restriction also apply to outbound traffic?",
                options: ["Inbound only", "Both directions"],
              },
            ],
          },
        },
      });
      const pending = () =>
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          child.id,
        );
      await vi.waitFor(() => expect(pending()).toHaveLength(1), {
        timeout: 5_000,
      });
      const interaction = pending()[0]!;
      const notice = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === parent.id,
      );
      expect(notice.command.type).toBe("turn.submit");
      if (notice.command.type !== "turn.submit")
        throw new Error("Expected turn");
      const noticeText = notice.command.input
        .filter((input) => input.type === "text")
        .map((input) => input.text)
        .join("\n");
      expect(noticeText).toContain(
        "Does the restriction also apply to outbound traffic?",
      );
      expect(noticeText).toContain(
        `bb thread interactions show ${interaction.id} ${child.id} --json`,
      );
      expect(noticeText).toContain(
        `bb thread interactions respond ${interaction.id} ${child.id}`,
      );
      const inspected = await readJson(
        await harness.app.request(
          `/api/v1/threads/${child.id}/interactions/${interaction.id}`,
        ),
      );
      expect(inspected).toMatchObject({
        status: "pending",
        payload: {
          data: {
            responseInstructions: expect.stringContaining('"question-1"'),
          },
        },
      });
      const response = await harness.app.request(
        `/api/v1/threads/${child.id}/interactions/${interaction.id}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            value: { answers: { "question-1": { selected: ["option-1"] } } },
          }),
        },
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        status: "resolved",
      });
      expect(pending()).toEqual([]);
      const answer = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === child.id,
      );
      expect(answer.command).toMatchObject({
        input: [
          {
            type: "text",
            text: "> Does the restriction also apply to outbound traffic?\n\nInbound only",
          },
        ],
      });
    } finally {
      await harness.pluginService.stop();
      await harness.close();
    }
  });
});
