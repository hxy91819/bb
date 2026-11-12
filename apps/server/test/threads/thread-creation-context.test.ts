import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getThreadPluginMetadata, patchThreadPluginMetadata } from "@bb/db";
import { threadResponseSchema } from "@bb/server-contract";
import { createNodeBbSdk } from "@bb/sdk";
import type { JsonObject } from "@bb/domain";
import { readJson } from "../helpers/json.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadIdentity,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  startTestServer,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

async function installContributor(harness: TestAppHarness, pluginId: string) {
  const root = join(harness.config.dataDir, `bb-plugin-${pluginId}`);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${pluginId}`,
      version: "0.1.0",
      bb: {
        name: pluginId,
        description: "Creation context fixture",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(root, "server.ts"),
    "export default function plugin() {}\n",
  );
  expect((await harness.pluginService.installPath(root)).status).toBe(
    "running",
  );
  const api = harness.pluginService.getApi(pluginId);
  if (!api) throw new Error("Contributor did not load");
  return api;
}

function creationFixture(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  const path = join(harness.config.dataDir, "context-workspace");
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path,
  });
  const environment = seedEnvironment(harness.deps, {
    projectId: project.id,
    hostId: host.id,
    path,
  });
  return {
    environment,
    request: {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      environment: { type: "reuse" as const, environmentId: environment.id },
      origin: "app" as const,
      input: textInput("Create"),
      startedOnBehalfOf: null,
      sendAt: Date.now() + 3_600_000,
    },
  };
}

async function post(
  harness: TestAppHarness,
  body: object,
  path = "/api/v1/threads",
) {
  const response = await harness.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
}

function storedThreadCount(harness: TestAppHarness, projectId: string) {
  return harness.db.$client
    .prepare("SELECT COUNT(*) AS count FROM threads WHERE project_id = ?")
    .get(projectId);
}

describe("thread creation context through HTTP and loaded plugins", () => {
  it("commits native and plugin-origin snapshots with all namespaces and preserves legacy seeds", async () => {
    const server = await startTestServer();
    try {
      const fixture = creationFixture(server);
      const team = await installContributor(server, "context-team");
      const launcher = await installContributor(server, "context-launcher");
      let rejectPreparation = false;
      team.experimental_threadCreationContext.register({
        input: z.object({ memberId: z.string() }).strict(),
        prepare: ({ context }) => {
          if (rejectPreparation)
            throw new Error("Preparation must not rerun on dispatch");
          return context.present ? { memberId: context.value.memberId } : null;
        },
      });
      launcher.experimental_threadCreationContext.register({
        input: z.null(),
        prepare: ({ legacySeed }) => ({ hasSeed: legacySeed !== null }),
      });
      const native = await post(server, {
        ...fixture.request,
        experimental_pluginContext: { "context-team": { memberId: "A" } },
      });
      expect(native.status).toBe(201);
      const nativeThread = threadResponseSchema.parse(native.body);
      expect(nativeThread.originPluginId).toBeNull();
      expect(
        getThreadPluginMetadata(server.db, nativeThread.id, "context-team")
          .metadata,
      ).toEqual({ memberId: "A" });
      expect(
        getThreadPluginMetadata(server.db, nativeThread.id, "context-launcher")
          .metadata,
      ).toEqual({ hasSeed: false });

      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const created = await launcher.sdk.threads.spawn({
        ...fixture.request,
        origin: "plugin",
        experimental_pluginContext: { "context-team": { memberId: "B" } },
        pluginMetadata: { issueKey: "BB-42" },
      });
      expect(created.originPluginId).toBe("context-launcher");
      expect(
        getThreadPluginMetadata(server.db, created.id, "context-launcher")
          .metadata,
      ).toEqual({ issueKey: "BB-42", hasSeed: true });
      expect(
        getThreadPluginMetadata(server.db, created.id, "context-team").metadata,
      ).toEqual({ memberId: "B" });

      const sdk = createNodeBbSdk({ baseUrl: server.baseUrl });
      for (const experimental_pluginContext of [undefined, {}]) {
        const unassigned = await sdk.threads.spawn({
          ...fixture.request,
          ...(experimental_pluginContext === undefined
            ? {}
            : { experimental_pluginContext }),
        });
        expect(
          getThreadPluginMetadata(server.db, unassigned.id, "context-team")
            .metadata,
        ).toEqual({});
      }
      const before = storedThreadCount(server, fixture.request.projectId);
      const cycle: JsonObject = {};
      cycle.self = cycle;
      for (const value of [
        Number.NaN,
        cycle,
        { [Symbol("hidden")]: 1 },
        { nested: undefined },
      ]) {
        await expect(
          sdk.threads.spawn({
            ...fixture.request,
            experimental_pluginContext: { "context-team": value } as Record<
              string,
              import("@bb/domain").JsonValue
            >,
          }),
        ).rejects.toThrow();
      }
      expect(storedThreadCount(server, fixture.request.projectId)).toEqual(
        before,
      );
      rejectPreparation = true;
      const queued = await sdk.threads.queuedMessages.list({
        threadId: nativeThread.id,
      });
      const message = queued[0];
      if (!message) throw new Error("Expected scheduled first message");
      await sdk.threads.queuedMessages.send({
        threadId: nativeThread.id,
        queuedMessageId: message.id,
        mode: "auto",
      });
      await waitForQueuedCommand(
        server,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === nativeThread.id,
      );
      expect(
        getThreadPluginMetadata(server.db, nativeThread.id, "context-team")
          .metadata,
      ).toEqual({ memberId: "A" });
    } finally {
      await server.close();
    }
  });

  it.each([
    ["input", "plugin_context_invalid_input"],
    ["throw", "plugin_context_prepare_failed"],
    ["invalid", "plugin_context_invalid_output"],
    ["large", "plugin_context_metadata_too_large"],
    ["conflict", "plugin_context_metadata_conflict"],
    ["unavailable", "plugin_context_unavailable"],
  ])("rejects %s without a thread or partial namespace", async (mode, code) => {
    await withTestHarness(async (harness) => {
      const { request } = creationFixture(harness);
      const api = await installContributor(harness, "context-team");
      const other = await installContributor(harness, "context-other");
      other.experimental_threadCreationContext.register({
        input: z.null(),
        prepare: () => ({ ready: true }),
      });
      api.experimental_threadCreationContext.register({
        input: z.object({ memberId: z.string() }),
        prepare: (): JsonObject => {
          if (mode === "throw") throw new Error("invalid member");
          if (mode === "invalid") return { invalid: Number.NaN };
          if (mode === "large") return { large: "x".repeat(256 * 1024) };
          return { memberId: "A" };
        },
      });
      const result = await post(harness, {
        ...request,
        ...(mode === "conflict"
          ? {
              origin: "plugin",
              originPluginId: "context-team",
              pluginMetadata: { memberId: "A" },
            }
          : {}),
        experimental_pluginContext: {
          [mode === "unavailable" ? "missing" : "context-team"]:
            mode === "input" ? 1 : { memberId: "A" },
        },
      });
      expect(result.body).toMatchObject({ code });
      expect(storedThreadCount(harness, request.projectId)).toEqual({
        count: 0,
      });
      expect(
        harness.db.$client
          .prepare("SELECT COUNT(*) AS count FROM thread_plugin_metadata")
          .get(),
      ).toEqual({ count: 0 });
    });
  });

  it("aborts an in-flight generation on disable, discards late results, and permits native creation", async () => {
    await withTestHarness(async (harness) => {
      const { request } = creationFixture(harness);
      const api = await installContributor(harness, "context-team");
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signal: AbortSignal | undefined;
      api.experimental_threadCreationContext.register({
        input: z.null(),
        async prepare(args) {
          signal = args.signal;
          entered();
          await wait;
          return { memberId: "late" };
        },
      });
      const pending = post(harness, {
        ...request,
        experimental_pluginContext: { "context-team": null },
      });
      await started;
      const disabling = harness.pluginService.setEnabled("context-team", false);
      expect((await pending).body).toMatchObject({
        code: "plugin_context_changed",
      });
      expect(signal?.aborted).toBe(true);
      release();
      await disabling;
      expect(storedThreadCount(harness, request.projectId)).toEqual({
        count: 0,
      });
      expect((await post(harness, request)).status).toBe(201);
      expect(
        (
          await post(harness, {
            ...request,
            experimental_pluginContext: { "context-team": null },
          })
        ).body,
      ).toMatchObject({ code: "plugin_context_unavailable" });
      await harness.pluginService.setEnabled("context-team", true);
      const fresh = harness.pluginService.getApi("context-team");
      if (!fresh) throw new Error("Contributor did not reload");
      fresh.experimental_threadCreationContext.register({
        input: z.null(),
        prepare: () => ({ memberId: "fresh" }),
      });
      const created = await post(harness, request);
      expect(created.status).toBe(201);
      const thread = threadResponseSchema.parse(created.body);
      expect(
        getThreadPluginMetadata(harness.db, thread.id, "context-team").metadata,
      ).toEqual({ memberId: "fresh" });
    });
  });

  it("times out preparation and never writes its late result", async () => {
    await withTestHarness(async (harness) => {
      const { request } = creationFixture(harness);
      const api = await installContributor(harness, "context-team");
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signal: AbortSignal | undefined;
      api.experimental_threadCreationContext.register({
        input: z.null(),
        async prepare(args) {
          signal = args.signal;
          await wait;
          return { memberId: "late" };
        },
      });
      const result = await post(harness, request);
      expect(result.body).toMatchObject({ code: "plugin_context_timeout" });
      expect(signal?.aborted).toBe(true);
      release();
      expect(storedThreadCount(harness, request.projectId)).toEqual({
        count: 0,
      });
    });
  }, 20_000);

  it("rejects namespace-count, UTF-8 input size, and aggregate output limits before persistence", async () => {
    await withTestHarness(async (harness) => {
      const { request } = creationFixture(harness);
      for (const context of [
        Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [`plugin-${index}`, null]),
        ),
        { team: "界".repeat(90_000) },
      ]) {
        const response = await post(harness, {
          ...request,
          experimental_pluginContext: context,
        });
        expect(response.status).toBe(413);
        expect(response.body).toMatchObject({
          code: "plugin_context_too_large",
        });
      }
      for (let index = 0; index < 5; index++) {
        const api = await installContributor(harness, `context-${index}`);
        api.experimental_threadCreationContext.register({
          input: z.null(),
          prepare: () => ({ data: "x".repeat(220 * 1024) }),
        });
      }
      const result = await post(harness, request);
      expect(result.status).toBe(413);
      expect(result.body).toMatchObject({
        code: "plugin_context_metadata_too_large",
      });
      expect(storedThreadCount(harness, request.projectId)).toEqual({
        count: 0,
      });
      expect(
        harness.db.$client
          .prepare("SELECT COUNT(*) AS count FROM thread_plugin_metadata")
          .get(),
      ).toEqual({ count: 0 });
    });
  });

  it("lets a handler inherit only its parent's metadata while forks receive source metadata without a parent", async () => {
    await withTestHarness(async (harness) => {
      const { request, environment } = creationFixture(harness);
      const api = await installContributor(harness, "context-team");
      api.experimental_threadCreationContext.register({
        input: z.object({ memberId: z.string() }),
        prepare: ({
          context,
          parentMetadata,
          sourceMetadata,
          creation,
        }): JsonObject | null => {
          if (context.present)
            return {
              memberId: context.value.memberId,
              sourceMember: sourceMetadata?.memberId ?? null,
              parent: creation.parentThreadId,
            };
          return parentMetadata === null
            ? null
            : { memberId: parentMetadata.memberId ?? null };
        },
      });
      const source = seedThread(harness.deps, {
        projectId: request.projectId,
        environmentId: environment.id,
      });
      seedThreadIdentity(harness.deps, {
        threadId: source.id,
        environmentId: environment.id,
        providerThreadId: "provider-context-source",
      });
      seedTurnStarted(harness.deps, {
        threadId: source.id,
        turnId: "turn-context-source",
        providerThreadId: "provider-context-source",
      });
      patchThreadPluginMetadata(harness.db, {
        threadId: source.id,
        pluginId: "context-team",
        set: { memberId: "A" },
        remove: [],
      });
      patchThreadPluginMetadata(harness.db, {
        threadId: source.id,
        pluginId: "context-other",
        set: { secret: "other" },
        remove: [],
      });
      const childResponse = await post(harness, {
        ...request,
        parentThreadId: source.id,
      });
      expect(childResponse.status).toBe(201);
      const child = threadResponseSchema.parse(childResponse.body);
      expect(child.parentThreadId).toBe(source.id);
      expect(child.sourceThreadId).toBeNull();
      expect(
        getThreadPluginMetadata(harness.db, child.id, "context-team").metadata,
      ).toEqual({ memberId: "A" });
      for (const context of [
        undefined,
        { "context-team": { memberId: "B" } },
      ]) {
        const forkResponse = await post(
          harness,
          {
            sourceThreadId: source.id,
            ...(context === undefined
              ? {}
              : { experimental_pluginContext: context }),
          },
          "/api/v1/threads/fork",
        );
        expect(forkResponse.status, JSON.stringify(forkResponse.body)).toBe(
          201,
        );
        const fork = threadResponseSchema.parse(forkResponse.body);
        expect(fork.parentThreadId).toBeNull();
        expect(fork.sourceThreadId).toBe(source.id);
        expect(
          getThreadPluginMetadata(harness.db, fork.id, "context-team").metadata,
        ).toEqual(
          context === undefined
            ? {}
            : { memberId: "B", sourceMember: "A", parent: null },
        );
        expect(
          getThreadPluginMetadata(harness.db, fork.id, "context-other")
            .metadata,
        ).toEqual({});
      }
    });
  });
});
