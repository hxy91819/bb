import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { experimental_createBridgeJsonRpcTestHarness as createHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

let directory: string;
let executionLog: string;
let harness: ReturnType<typeof createHarness>;

function providerOptions(id: string) {
  return {
    codexExecution: {
      kind: "home",
      providerId: `codex-${id}`,
      codexHome: join(directory, id),
    },
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bb-codex-bound-children-"));
  executionLog = join(directory, "children.jsonl");
  for (const id of ["a", "b"]) await mkdir(join(directory, id));
  const scriptPath = join(directory, "script.json");
  await writeFile(
    scriptPath,
    JSON.stringify({ executionLogPath: executionLog }),
  );
  stubFakeCodexAppServer(scriptPath);
  vi.stubEnv("CODEX_POOL_AUTH_TOKEN", "dummy-inherited-pool-token");
  vi.stubEnv("CODEX_OPENAI_BASE_URL", "https://pool.invalid/v1");
  vi.stubEnv("OPENAI_API_KEY", "dummy-inherited-api-key");
  harness = createHarness(handleLine);
});

afterEach(async () => {
  experimental_killAllChildrenForTests();
  harness.restore();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function children() {
  return z
    .array(
      z.object({
        codexHome: z.string(),
        sqliteHome: z.string(),
        poolRouted: z.boolean(),
        apiKeyPresent: z.boolean(),
      }),
    )
    .parse(
      (await readFile(executionLog, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );
}

it("isolates concurrent model discovery and its cached processes by home, without inherited pool credentials", async () => {
  harness.sendRequest(1, "model/list", {
    providerOptions: providerOptions("a"),
  });
  harness.sendRequest(2, "model/list", {
    providerOptions: providerOptions("b"),
  });
  const [a, b] = await Promise.all([
    harness.waitForResponse(1),
    harness.waitForResponse(2),
  ]);
  expect(a.error).toBeUndefined();
  expect(b.error).toBeUndefined();
  expect(a.result).not.toEqual(b.result);
  harness.sendRequest(3, "model/list", {
    providerOptions: providerOptions("a"),
  });
  expect((await harness.waitForResponse(3)).result).toEqual(a.result);
  const records = await children();
  expect(records.map((record) => record.codexHome).sort()).toEqual(
    [join(directory, "a"), join(directory, "b")].sort(),
  );
  expect(
    records.every(
      (record) =>
        !record.poolRouted &&
        !record.apiKeyPresent &&
        record.sqliteHome === record.codexHome,
    ),
  ).toBe(true);
});

it("starts and forks native sessions in the same home and uses it for maintenance after release", async () => {
  const options = {
    ...FULL_ACCESS_SESSION_OPTIONS,
    providerOptions: providerOptions("a"),
  };
  harness.sendRequest(1, "thread/start", {
    threadId: "bound-a",
    cwd: directory,
    instructionMode: "append",
    options,
  });
  const started = await harness.waitForResponse(1);
  expect(started.error).toBeUndefined();
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);
  harness.sendRequest(2, "thread/fork", {
    threadId: "bound-a-fork",
    sourceProviderThreadId: providerThreadId,
    cwd: directory,
    instructionMode: "append",
    options,
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
  harness.sendRequest(3, "thread/stop", {
    threadId: "bound-a",
    providerThreadId,
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(3);
  harness.sendRequest(4, "thread/goal/clear", {
    threadId: "bound-a",
    providerThreadId,
    providerOptions: providerOptions("a"),
  });
  expect((await harness.waitForResponse(4)).error).toBeUndefined();
  const records = await children();
  expect(records.length).toBeGreaterThanOrEqual(3);
  expect(
    records.every(
      (record) =>
        record.codexHome === join(directory, "a") && !record.poolRouted,
    ),
  ).toBe(true);
});

it("refreshes model discovery after the bound home receives updated credentials", async () => {
  const auth = join(directory, "a", "auth.json");
  await writeFile(
    auth,
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "dummy-before" }),
  );
  harness.sendRequest(1, "model/list", {
    providerOptions: providerOptions("a"),
  });
  const first = await harness.waitForResponse(1);
  expect(first.error).toBeUndefined();
  await writeFile(
    auth,
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "dummy-after" }),
  );
  harness.sendRequest(2, "model/list", {
    providerOptions: providerOptions("a"),
  });
  const second = await harness.waitForResponse(2);
  expect(second.error).toBeUndefined();
  expect(second.result).not.toEqual(first.result);
  expect(await children()).toHaveLength(2);
});
