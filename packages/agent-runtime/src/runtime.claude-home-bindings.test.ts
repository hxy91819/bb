import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { ThreadEvent } from "@bb/domain";
import { createAgentRuntime } from "./runtime.js";
import { promptTextInput } from "./test/prompt-input.js";
import {
  createScriptedEchoLaunch,
  fullRuntimeOptions,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";

const recordSchema = z.object({
  method: z.string(),
  pid: z.number(),
  directory: z.string(),
  endpoint: z.string(),
  token: z.string(),
  inheritedEndpoint: z.string().nullable(),
  inheritedToken: z.string().nullable(),
  resume: z.string().nullable(),
});
it("keeps default and two bound Claude workers isolated through concurrent discovery, worker loss, native resume and fork", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-claude-runtime-homes-"));
  const executionLog = join(directory, "execution.jsonl");
  const ids = ["default", "a", "b"] as const;
  for (const id of ids) {
    await mkdir(join(directory, id));
    await writeFile(
      join(directory, id, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: `https://${id}.invalid`,
          ANTHROPIC_AUTH_TOKEN: `${id}-token`,
        },
      }),
    );
  }
  const launches = ids.map((id) =>
    createScriptedEchoLaunch({
      pluginId: "provider-claude-code",
      modulePath: fileURLToPath(
        new URL(
          "../dist/test-bridges/claude-home-provider.mjs",
          import.meta.url,
        ),
      ),
      capabilities: {
        supportsThreadArchive: false,
        supportsThreadRename: false,
        fork: "checkpoint",
      },
      providerOptions:
        id === "default"
          ? {}
          : {
              claudeExecution: {
                id,
                displayName: id,
                claudeConfigDir: join(directory, id),
              },
            },
    }),
  );
  const providerIds = ["claude-code", "claude-code-a", "claude-code-b"];
  const events: ThreadEvent[] = [];
  const onProcessExit = vi.fn();
  const runtime = createAgentRuntime({
    workspacePath: directory,
    env: {
      CLAUDE_CONFIG_DIR: join(directory, "default"),
      ANTHROPIC_BASE_URL: "https://inherited.invalid",
      ANTHROPIC_AUTH_TOKEN: "inherited-token",
      BB_CLAUDE_HOME_TEST_LOG: executionLog,
    },
    onEvent: (event) => events.push(event),
    onProcessExit,
    onToolCall: async () => ({ success: false, contentItems: [] }),
  });
  async function records() {
    return (await readFile(executionLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => recordSchema.parse(JSON.parse(line)));
  }
  const args = ids.map((id, index) => ({
    environmentId: "env",
    projectId: "project",
    threadId: `thread-${id}`,
    providerId: providerIds[index]!,
    bridgeLaunch: launches[index]!,
    options: fullRuntimeOptions,
  }));
  try {
    const models = await Promise.all(
      args.map((arg) =>
        runtime.listModels({
          providerId: arg.providerId,
          bridgeLaunch: arg.bridgeLaunch,
        }),
      ),
    );
    expect(models.map((catalog) => catalog.models[0]?.model)).toEqual(
      ids.map((id) => join(directory, id)),
    );
    const started = await Promise.all(
      args.map((arg) => runtime.startThread(arg)),
    );
    const first = await records();
    const pids = ids.map((id) => [
      ...new Set(
        first
          .filter((record) => record.directory === join(directory, id))
          .map((record) => record.pid),
      ),
    ]);
    expect(pids.every((list) => list.length === 1)).toBe(true);
    expect(new Set(pids.flat()).size).toBe(3);
    const aPid = pids[1]![0]!;
    process.kill(aPid, "SIGKILL");
    await vi.waitFor(() =>
      expect(onProcessExit).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: "claude-code-a" }),
      ),
    );
    await runtime.resumeThread({
      ...args[1]!,
      providerThreadId: started[1]!.providerThreadId,
    });
    await runtime.startThread({
      ...args[1]!,
      threadId: "fork-a",
      fork: { sourceProviderThreadId: started[1]!.providerThreadId },
    });
    await Promise.all(
      args.map((arg, index) =>
        runtime.runTurn({
          threadId: arg.threadId,
          input: [promptTextInput({ text: "continue" })],
          clientRequestId: `creq_222222222${index + 2}`,
          options: fullRuntimeOptions,
        }),
      ),
    );
    await Promise.all(
      args.map((arg) =>
        waitForThreadTurnCompleted({ events, threadId: arg.threadId }),
      ),
    );
    const final = await records();
    for (const id of ids) {
      const selected = final.filter(
        (record) => record.directory === join(directory, id),
      );
      expect(selected.length).toBeGreaterThan(1);
      expect(
        selected.every(
          (record) =>
            record.endpoint === `https://${id}.invalid` &&
            record.token === `${id}-token`,
        ),
      ).toBe(true);
      expect(
        selected.every((record) =>
          id === "default"
            ? record.inheritedEndpoint === "https://inherited.invalid" &&
              record.inheritedToken === "inherited-token"
            : record.inheritedEndpoint === null &&
              record.inheritedToken === null,
        ),
      ).toBe(true);
      const allPids = [...new Set(selected.map((record) => record.pid))];
      expect(allPids.length).toBe(id === "a" ? 2 : 1);
      expect(selected.some((record) => record.method === "turn")).toBe(true);
    }
    const a = final.filter(
      (record) => record.directory === join(directory, "a"),
    );
    expect(
      a.some(
        (record) =>
          record.method === "query" &&
          record.resume === started[1]!.providerThreadId &&
          record.pid !== aPid,
      ),
    ).toBe(true);
    expect(
      a.some(
        (record) =>
          record.method === "fork" &&
          record.resume === started[1]!.providerThreadId &&
          record.pid !== aPid,
      ),
    ).toBe(true);
  } finally {
    await runtime.shutdown();
    await Promise.all(
      launches.map((launch) =>
        rm(launch.dataDir, { recursive: true, force: true }),
      ),
    );
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
