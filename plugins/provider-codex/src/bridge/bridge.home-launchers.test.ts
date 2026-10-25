import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { experimental_createBridgeJsonRpcTestHarness as createHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";
import * as maintenance from "./provider-maintenance.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

let directory: string;
let command: string;
let scriptPath: string;
let processLog: string;
let executionLog: string;
let harness: ReturnType<typeof createHarness>;

function options() {
  return {
    codexExecution: {
      kind: "home",
      providerId: "codex-work",
      codexHome: join(directory, "home"),
      command,
    },
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bb-codex-launcher-"));
  await mkdir(join(directory, "home"));
  scriptPath = join(directory, "script.json");
  processLog = join(directory, "process.log");
  executionLog = join(directory, "execution.jsonl");
  await writeFile(
    scriptPath,
    JSON.stringify({
      processLogPath: processLog,
      executionLogPath: executionLog,
      accountRead: { account: null, requiresOpenaiAuth: false },
    }),
  );
  const fake = fileURLToPath(
    new URL("./fake-codex-app-server.mjs", import.meta.url),
  );
  if (process.platform === "win32") {
    command = join(directory, "launcher with spaces.cmd");
    await writeFile(
      command,
      `@echo off\r\nset BB_TEST_LAUNCHER=work\r\n"${process.execPath}" "${fake}" "${scriptPath}" %*\r\n`,
    );
  } else {
    command = join(directory, "launcher with spaces");
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(
      command,
      `#!/bin/sh\nexport BB_TEST_LAUNCHER=work\nexec ${quote(process.execPath)} ${quote(fake)} ${quote(scriptPath)} "$@"\n`,
      { mode: 0o755 },
    );
  }
  vi.stubEnv("CODEX_POOL_AUTH_TOKEN", "dummy-pool-token");
  vi.stubEnv("CODEX_OPENAI_BASE_URL", "https://pool.invalid/v1");
  vi.spyOn(maintenance, "getCodexProviderHealth").mockResolvedValue({
    supported: true,
    health: {
      status: "unauthenticated",
      statusMessage: null,
      accountEmail: null,
      planLabel: null,
      installedVersion: "1.0.0",
      minimumSupportedVersion: "0.136.0",
      canInstall: true,
      canUpdate: true,
      loginCommand: "codex login",
    },
  });
  harness = createHarness(handleLine);
});

afterEach(async () => {
  experimental_killAllChildrenForTests();
  const launches = (await readFile(executionLog, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => z.object({ pid: z.number() }).parse(JSON.parse(line)));
  await vi.waitFor(() => {
    for (const launch of launches) {
      expect(() => process.kill(launch.pid, 0)).toThrow();
    }
  });
  harness.restore();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

it("uses the selected launcher for model discovery, native start, fork and maintenance", async () => {
  harness.sendRequest(1, "model/list", { providerOptions: options() });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  const sessionOptions = {
    ...FULL_ACCESS_SESSION_OPTIONS,
    providerOptions: options(),
  };
  harness.sendRequest(2, "thread/start", {
    threadId: "launcher-start",
    cwd: directory,
    instructionMode: "append",
    options: sessionOptions,
  });
  const start = await harness.waitForResponse(2);
  expect(start.error).toBeUndefined();
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(start.result);
  harness.sendRequest(3, "thread/fork", {
    threadId: "launcher-fork",
    sourceProviderThreadId: providerThreadId,
    cwd: directory,
    instructionMode: "append",
    options: sessionOptions,
  });
  expect((await harness.waitForResponse(3)).error).toBeUndefined();
  harness.sendRequest(4, "thread/goal/clear", {
    threadId: "not-active",
    providerThreadId,
    providerOptions: options(),
  });
  expect((await harness.waitForResponse(4)).error).toBeUndefined();
  const records = (await readFile(executionLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) =>
      z
        .object({
          codexHome: z.string(),
          sqliteHome: z.string(),
          poolRouted: z.boolean(),
          launcher: z.string(),
        })
        .parse(JSON.parse(line)),
    );
  expect(records.length).toBeGreaterThanOrEqual(4);
  expect(
    records.every(
      (record) =>
        record.launcher === "work" &&
        !record.poolRouted &&
        record.codexHome === join(directory, "home") &&
        record.sqliteHome === record.codexHome,
    ),
  ).toBe(true);
});

it("keeps a launcher-scoped process separate from discovery without a launcher", async () => {
  stubFakeCodexAppServer(scriptPath);
  harness.sendRequest(1, "model/list", { providerOptions: options() });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  harness.sendRequest(2, "model/list", {
    providerOptions: {
      codexExecution: {
        kind: "home",
        providerId: "codex-plain",
        codexHome: join(directory, "home"),
      },
    },
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
  const records = (await readFile(executionLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) =>
      z.object({ launcher: z.string().nullable() }).parse(JSON.parse(line)),
    );
  expect(records.map((record) => record.launcher)).toEqual(["work", null]);
});

it.each(["unauthenticated", "expired"] as const)(
  "recognizes launcher-managed auth from %s and reaps its probe",
  async (status) => {
    vi.mocked(maintenance.getCodexProviderHealth).mockResolvedValueOnce({
      supported: true,
      health: {
        status,
        statusMessage: null,
        accountEmail: null,
        planLabel: null,
        installedVersion: "1.0.0",
        minimumSupportedVersion: "0.136.0",
        canInstall: true,
        canUpdate: true,
        loginCommand: "codex login",
      },
    });
    harness.sendRequest(1, "provider/health", {
      providerId: "codex-work",
      providerOptions: options(),
    });
    const result = await harness.waitForResponse(1);
    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({
      supported: true,
      health: { status: "ready" },
    });
    expect(await readFile(processLog, "utf8")).toContain("exit:");
  },
);

it.each(["missing", "malformed", "login-required"])(
  "preserves structured health for a %s probe",
  async (failure) => {
    if (failure === "missing") command = join(directory, "missing-launcher");
    else
      await writeFile(
        scriptPath,
        JSON.stringify({
          processLogPath: processLog,
          accountRead: {
            requiresOpenaiAuth: failure === "malformed" ? "invalid" : true,
          },
        }),
      );
    harness.sendRequest(1, "provider/health", {
      providerId: "codex-work",
      providerOptions: options(),
    });
    const result = await harness.waitForResponse(1);
    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({
      supported: true,
      health: { status: "unauthenticated" },
    });
    if (failure !== "missing")
      expect(await readFile(processLog, "utf8")).toContain("exit:");
  },
);
