import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server";
import { registrationSchema } from "./contract";

function setup(metadata = new Map<string, Record<string, unknown>>()) {
  let fail = false;
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
        getPluginMetadata: ({ threadId }) => metadata.get(threadId) ?? {},
        updatePluginMetadata: ({ threadId, set, remove }) => {
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
      environments: { get: () => ({ hostId: "host" }) },
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
