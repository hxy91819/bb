import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server";
import { registrationSchema } from "./contract";

function setup(
  metadata = new Map<string, Record<string, unknown>>(),
  hostId = "host",
) {
  let fail = false;
  const deleted = new Set<string>();
  const host = createFakePluginHost({
    pluginId: "steward",
    sdk: {
      threads: {
        get: ({ threadId }) => ({
          id: threadId,
          projectId: "project",
          environmentId: "environment",
        }),
        list: (args) =>
          (args?.offset ?? 0) === 0
            ? [...metadata.keys()].map((id) => ({ id }))
            : [],
        getPluginMetadata: ({ threadId }) => {
          if (deleted.has(threadId))
            throw Object.assign(new Error("thread not found"), { status: 404 });
          return metadata.get(threadId) ?? {};
        },
        experimental_listPluginMetadata: ({ threadIds }) => ({
          threads: threadIds.map((threadId) => ({
            threadId,
            metadata: metadata.get(threadId) ?? {},
          })),
        }),
        updatePluginMetadata: ({ threadId, set, remove }) => {
          if (deleted.has(threadId))
            throw Object.assign(new Error("thread not found"), { status: 404 });
          if (fail) {
            fail = false;
            throw new Error("write failed");
          }
          const next = { ...metadata.get(threadId), ...set };
          for (const key of remove ?? []) delete next[key];
          metadata.set(threadId, next);
          return next;
        },
      },
      environments: { get: () => ({ hostId }) },
    },
    experimental_callHostRpc: ({ method }) => {
      if (method === "identity")
        return { repoRoot: "/repo", workbookRelativePath: "docs/workbook.md" };
      throw new Error("host offline");
    },
  });
  return {
    host,
    metadata,
    deleted,
    failNext: () => {
      fail = true;
    },
  };
}
const input = (threadId: string) => ({
  threadId,
  topic: "目标",
  workbook: "/repo/docs/workbook.md",
  ledger: "/repo/docs/ledger.md",
  checker: "/skills/steward_workbook.py",
});

describe("管家登记", () => {
  it("acknowledges deleted threads so pending unregister operations can finish", async () => {
    const { host, deleted } = setup();
    plugin(host.bb);
    await host.harness.callRpc("register", input("deleted"));
    deleted.add("deleted");
    expect(
      await host.harness.callRpc("unregister", { threadId: "deleted" }),
    ).toEqual({ removed: false });
    expect(
      (
        await host.harness.runCli([
          "unregister",
          "--thread",
          "deleted",
          "--json",
        ])
      ).exitCode,
    ).toBe(0);
  });
  it("concurrent takeover leaves one owner and reload preserves metadata; CLI and RPC share state", async () => {
    const { host, metadata } = setup();
    plugin(host.bb);
    await Promise.all([
      host.harness.callRpc("register", input("old")),
      host.harness.callRpc("register", input("new")),
    ]);
    expect(await host.harness.callRpc("show", { threadId: "old" })).toBeNull();
    expect(
      registrationSchema.parse(
        await host.harness.callRpc("show", { threadId: "new" }),
      ).threadId,
    ).toBe("new");
    const reloaded = setup(metadata).host;
    plugin(reloaded.bb);
    expect(
      registrationSchema.parse(
        await reloaded.harness.callRpc("show", { threadId: "new" }),
      ).topic,
    ).toBe("目标");
    expect(
      (await host.harness.runCli(["unregister", "--thread", "new", "--json"]))
        .exitCode,
    ).toBe(0);
    expect(await host.harness.callRpc("show", { threadId: "new" })).toBeNull();
    expect(metadata.get("new")?.registration).toBeUndefined();
  });
  it("failed write can be retried and does not poison the registration queue", async () => {
    const { host, failNext } = setup();
    plugin(host.bb);
    await host.harness.callRpc("register", input("old"));
    failNext();
    await expect(
      host.harness.callRpc("register", input("new")),
    ).rejects.toThrow();
    await host.harness.callRpc("register", input("new"));
    expect(await host.harness.callRpc("show", { threadId: "old" })).toBeNull();
    expect(
      registrationSchema.parse(
        await host.harness.callRpc("show", { threadId: "new" }),
      ).threadId,
    ).toBe("new");
  });
  it("unmarked threads stay empty and offline document checks return a readable status", async () => {
    const { host } = setup();
    plugin(host.bb);
    expect(
      await host.harness.callRpc("show", { threadId: "plain" }),
    ).toBeNull();
    await host.harness.callRpc("register", input("owner"));
    expect(
      await host.harness.callRpc("document", {
        threadId: "owner",
        document: "ledger",
      }),
    ).toMatchObject({
      available: false,
      message: "文件所在主机暂时离线，请连接后重试。",
    });
    await expect(
      host.harness.callRpc("refresh", { threadId: "owner" }),
    ).rejects.toThrow("文件所在主机暂时无法连接");
  });
});

it("preserves Git sources on CLI re-registration and reload, and distinguishes refs, local files and hosts", async () => {
  const { host, metadata } = setup();
  plugin(host.bb);
  const git = {
    ...input("git"),
    workbook: "docs/workbook.md",
    ledger: "docs/ledger.md",
    source: { kind: "git", repo: "/repo", ref: "origin/main" },
    ledgerKind: "history",
  };
  await host.harness.callRpc("register", git);
  const result = await host.harness.runCli([
    "register",
    "--thread",
    "git",
    "--topic",
    "目标",
    "--workbook",
    "docs/workbook.md",
    "--ledger",
    "docs/ledger.md",
    "--checker",
    git.checker,
    "--repo",
    "/repo",
    "--ref",
    "origin/main",
    "--ledger-kind",
    "history",
  ]);
  expect(result.exitCode).toBe(0);
  await host.harness.callRpc("register", {
    ...git,
    threadId: "other-ref",
    source: { ...git.source, ref: "origin/other" },
  });
  await host.harness.callRpc("register", input("local"));
  const remoteHost = setup(metadata, "other-host").host;
  plugin(remoteHost.bb);
  await remoteHost.harness.callRpc("register", {
    ...git,
    threadId: "other-host",
  });
  const reloaded = setup(metadata, "moved-environment-host").host;
  plugin(reloaded.bb);
  await reloaded.harness.callRpc("register", git);
  expect(
    await reloaded.harness.callRpc("show", { threadId: "git" }),
  ).toMatchObject({
    source: git.source,
    ledgerKind: "history",
    hostId: "host",
  });
  for (const threadId of ["other-ref", "local", "other-host"])
    expect(await reloaded.harness.callRpc("show", { threadId })).not.toBeNull();
  expect(
    (
      await host.harness.runCli([
        "register",
        "--thread",
        "bad",
        "--topic",
        "x",
        "--workbook",
        "../outside",
        "--ledger",
        "docs/ledger.md",
        "--checker",
        git.checker,
        "--repo",
        "/repo",
        "--ref",
        "origin/main",
      ])
    ).exitCode,
  ).toBe(1);
  expect(
    (
      await host.harness.runCli([
        "document",
        "--thread",
        "git",
        "--document",
        "workbook",
        "--repo",
        "/ignored",
      ])
    ).exitCode,
  ).toBe(1);
});
it("reads legacy metadata without source fields as local registration", async () => {
  const { host, metadata } = setup();
  plugin(host.bb);
  const saved = await host.harness.callRpc("register", input("legacy"));
  const legacy: Record<string, unknown> = {
    ...registrationSchema.parse(saved),
  };
  delete legacy.source;
  delete legacy.ledgerKind;
  metadata.set("legacy", { registration: legacy });
  expect(
    await host.harness.callRpc("show", { threadId: "legacy" }),
  ).toMatchObject({ source: { kind: "local" }, ledgerKind: "standard" });
});
