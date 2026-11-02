import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { experimental_createBridgeJsonRpcTestHarness as createHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
const { queryMock, forkSessionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  forkSessionMock: vi.fn(),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
  forkSession: forkSessionMock,
}));
import { handleLine } from "../bridge.js";
const originalEnv = { ...process.env };
afterEach(() => {
  for (const name of Object.keys(process.env))
    if (!(name in originalEnv)) delete process.env[name];
  Object.assign(process.env, originalEnv);
});
it("uses the bound home for models, sessions, resume and SDK-local forks, and rejects a different home in that worker", async () => {
  const envs: Array<NodeJS.ProcessEnv | undefined> = [];
  queryMock.mockImplementation(({ options }) => {
    envs.push(options.env ? { ...options.env } : undefined);
    let finish = () => {};
    const stopped = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const stream = (async function* () {
      await stopped;
    })();
    return Object.assign(stream, {
      initializationResult: vi.fn().mockResolvedValue({
        models: [
          {
            value: "glm-5.3-flash",
            resolvedModel: "glm-5.3-flash",
            displayName: "GLM Flash",
            description: "Custom model",
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
        ],
        commands: [],
      }),
      close: vi.fn(finish),
      applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    });
  });
  forkSessionMock.mockImplementation(async () => {
    expect(process.env.CLAUDE_CONFIG_DIR).toBe("/tmp/bound-claude-home");
    return { sessionId: "forked-home-session" };
  });
  process.env.ANTHROPIC_AUTH_TOKEN = "unrelated-auth";
  process.env.ANTHROPIC_BASE_URL = "https://unrelated.invalid";
  const binding = {
    id: "work",
    displayName: "Work",
    claudeConfigDir: "/tmp/bound-claude-home",
    reasoningLevels: ["low", "high", "max"],
    defaultReasoningLevel: "max",
    supportsFastMode: false,
  };
  const providerOptions = { claudeExecution: binding };
  const options = {
    model: "glm-5.3-flash",
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    permissionEscalation: "ask",
    approvalReviewer: "user",
    providerOptions,
  };
  const bridge = createHarness(handleLine);
  bridge.sendRequest(1, "model/list", { providerOptions });
  const models = await bridge.waitForResponse(1);
  expect(models.result).toMatchObject({
    models: [
      {
        model: "glm-5.3-flash",
        defaultReasoningEffort: "max",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "high" },
          { reasoningEffort: "max" },
        ],
        supportedServiceTiers: [],
      },
    ],
  });
  expect(envs[0]?.CLAUDE_CONFIG_DIR).toBe(binding.claudeConfigDir);
  expect(envs[0]?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  expect(envs[0]?.ANTHROPIC_BASE_URL).toBeUndefined();
  bridge.sendRequest(2, "thread/start", {
    threadId: "bound-thread",
    cwd: "/tmp",
    instructionMode: "append",
    options,
  });
  const start = await bridge.waitForResponse(2);
  expect(start.error).toBeUndefined();
  expect(envs.at(-1)?.CLAUDE_CONFIG_DIR).toBe(binding.claudeConfigDir);
  bridge.sendRequest(3, "thread/resume", {
    threadId: "resumed-thread",
    providerThreadId: "saved-home-session",
    cwd: "/tmp",
    instructionMode: "append",
    options,
  });
  expect((await bridge.waitForResponse(3)).error).toBeUndefined();
  expect(envs.at(-1)?.CLAUDE_CONFIG_DIR).toBe(binding.claudeConfigDir);
  bridge.sendRequest(4, "thread/fork", {
    threadId: "forked-thread",
    sourceProviderThreadId: "saved-home-session",
    cwd: "/tmp",
    instructionMode: "append",
    options,
  });
  expect((await bridge.waitForResponse(4)).error).toBeUndefined();
  expect(forkSessionMock).toHaveBeenCalled();
  bridge.sendRequest(6, "model/list", {
    providerOptions: {
      claudeExecution: { ...binding, displayName: "Renamed" },
    },
  });
  expect((await bridge.waitForResponse(6)).error).toBeUndefined();
  bridge.sendRequest(5, "model/list", {
    providerOptions: {
      claudeExecution: { ...binding, claudeConfigDir: "/tmp/other-home" },
    },
  });
  expect((await bridge.waitForResponse(5)).error?.message).toContain(
    "cannot switch home bindings",
  );
  const createdId = z
    .object({ providerThreadId: z.string() })
    .parse(start.result).providerThreadId;
  for (const [index, [threadId, providerThreadId]] of [
    ["bound-thread", createdId],
    ["resumed-thread", "saved-home-session"],
    ["forked-thread", "forked-home-session"],
  ].entries()) {
    bridge.sendRequest(10 + index, "thread/discard", {
      threadId,
      providerThreadId,
    });
    expect((await bridge.waitForResponse(10 + index)).error).toBeUndefined();
  }
});
