import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";
import { stubFakeCodexAppServer } from "./fake-codex-app-server-harness.js";

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspace: string;
let requestLogPath: string;
let requestId: number;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "bb-codex-writable-roots-"));
  requestLogPath = join(workspace, "requests.jsonl");
  const scriptPath = join(workspace, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath }));
  stubFakeCodexAppServer(scriptPath);
  vi.stubEnv("CODEX_HOME", join(workspace, "missing-home"));
  harness = createBridgeJsonRpcTestHarness(handleLine);
  requestId = 0;
});

afterEach(() => {
  experimental_killAllChildrenForTests();
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspace, { recursive: true, force: true });
});

function home(name: string, config?: string): string {
  const directory = join(workspace, name);
  mkdirSync(directory);
  if (config !== undefined)
    writeFileSync(join(directory, "config.toml"), config);
  return directory;
}

function options(codexHome: string, bbRoots: string[] = ["/bb/storage"]) {
  return {
    permissionMode: "auto",
    permissionScope: "workspace",
    approvalReviewer: "automatic",
    permissionEscalation: "ask",
    envVars: { CODEX_HOME: codexHome },
    providerOptions: { additionalWorkspaceWriteRoots: bbRoots },
  };
}

async function request(
  method: string,
  params: Parameters<typeof harness.sendRequest>[2],
) {
  const id = ++requestId;
  harness.sendRequest(id, method, params);
  return await harness.waitForResponse(id);
}

function requests(method: string) {
  const schema = z.object({
    method: z.string(),
    params: z
      .object({
        config: z.record(z.string(), z.unknown()).optional(),
        sandbox: z.string().optional(),
        sandboxPolicy: z
          .object({ type: z.string(), writableRoots: z.array(z.string()) })
          .optional(),
      })
      .passthrough(),
  });
  return readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => schema.parse(JSON.parse(line)))
    .filter((entry) => entry.method === method)
    .map((entry) => entry.params);
}

it.each(["start", "resume", "fork"])(
  "merges native roots for thread/%s and subsequent turns",
  async (kind) => {
    const codexHome = home(
      "configured",
      '[sandbox_workspace_write]\nwritable_roots = ["/cache/build", "/bb/storage", "/cache/build/", "/cache/lint"]\n',
    );
    const sessionOptions = options(codexHome);
    const response = await request(`thread/${kind}`, {
      threadId: "thr_roots",
      cwd: workspace,
      instructionMode: "append",
      ...(kind === "resume" ? { providerThreadId: "existing" } : {}),
      ...(kind === "fork" ? { sourceProviderThreadId: "existing" } : {}),
      options: sessionOptions,
    });
    expect(response.error).toBeUndefined();
    const providerThreadId = z
      .object({ providerThreadId: z.string() })
      .parse(response.result).providerThreadId;
    expect(requests(`thread/${kind}`)[0]?.sandbox).toBe("workspace-write");
    expect(
      requests(`thread/${kind}`)[0]?.config?.[
        "sandbox_workspace_write.writable_roots"
      ],
    ).toEqual(["/bb/storage", "/cache/build", "/cache/lint"]);
    expect(
      (
        await request("turn/start", {
          threadId: "thr_roots",
          providerThreadId,
          clientRequestId: "creq_abcdefgh23",
          input: [{ type: "text", text: "hello", mentions: [] }],
          options: sessionOptions,
        })
      ).error,
    ).toBeUndefined();
    expect(requests("turn/start")[0]?.sandboxPolicy).toMatchObject({
      type: "workspaceWrite",
      writableRoots: ["/bb/storage", "/cache/build", "/cache/lint"],
    });
  },
  30_000,
);

it.each([
  undefined,
  'model = "example"',
  "[sandbox_workspace_write]\nwritable_roots = []",
])(
  "preserves BB roots when native roots are absent: %s",
  async (config) => {
    expect(
      (
        await request("thread/start", {
          threadId: "thr_roots",
          cwd: workspace,
          instructionMode: "append",
          options: options(home("unconfigured", config)),
        })
      ).error,
    ).toBeUndefined();
    expect(
      requests("thread/start")[0]?.config?.[
        "sandbox_workspace_write.writable_roots"
      ],
    ).toEqual(["/bb/storage"]);
  },
  30_000,
);

it.each(['["relative/cache"]', '"/cache/build"', "[42]"])(
  "reports invalid writable_roots to the caller: %s",
  async (value) => {
    const codexHome = home(
      "invalid",
      `[sandbox_workspace_write]\nwritable_roots = ${value}`,
    );
    const response = await request("thread/start", {
      threadId: "thr_roots",
      cwd: workspace,
      instructionMode: "append",
      options: options(codexHome),
    });
    expect(response.error?.message).toContain(join(codexHome, "config.toml"));
    expect(response.error?.message).toContain("writable_roots");
  },
);

it("reads each session's home without sharing roots", async () => {
  for (const [index, name] of ["personal", "work"].entries()) {
    const codexHome = home(
      name,
      `[sandbox_workspace_write]\nwritable_roots = ["/cache/${name}"]`,
    );
    expect(
      (
        await request("thread/start", {
          threadId: `thr_roots_${index}`,
          cwd: workspace,
          instructionMode: "append",
          options: options(codexHome),
        })
      ).error,
    ).toBeUndefined();
  }
  expect(
    requests("thread/start").map(
      (params) => params.config?.["sandbox_workspace_write.writable_roots"],
    ),
  ).toEqual([
    ["/bb/storage", "/cache/personal"],
    ["/bb/storage", "/cache/work"],
  ]);
}, 30_000);
