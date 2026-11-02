// @vitest-environment jsdom
import type { ExperimentalTabRegistration } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { expect, it, vi } from "vitest";
import entry from "./app";
import { registrationSchema, documentRequest } from "./contract";

it("opens Git documents in the thread side panel instead of the header", async () => {
  const app = await loadPluginApp(entry);
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "git", projectId: "project", isCompactViewport: false },
    {
      rpc: {
        show: () =>
          registrationSchema.parse({
            threadId: "git",
            topic: "目标",
            workbook: "workbook.md",
            ledger: "ledger.md",
            checker: "/checker.py",
            source: { kind: "git", repo: "/repo", ref: "origin/main" },
            schemaVersion: 1,
            projectId: "project",
            hostId: "host",
            repoRoot: "/repo",
            workbookRelativePath: "workbook.md",
            registeredAt: "2026-10-27",
          }),
        document: () => ({
          available: true,
          message: "",
          path: "workbook.md",
          content: "# 目标",
          snapshot: { repo: "/repo", ref: "origin/main", sha: "a".repeat(40) },
        }),
      },
      openThreadPanel: () => true,
    },
  );
  try {
    for (const [name, document] of [
      ["打开工作簿", "workbook"],
      ["打开要求帐", "ledger"],
    ]) {
      (await slot.findByRole("button", { name })).click();
      await vi.waitFor(() =>
        expect(slot.inspection.navigateCalls.at(-1)).toMatchObject({
          method: "openThreadPanel",
          options: { actionId: "document", params: { document } },
        }),
      );
    }
    expect(slot.queryByRole("region", { name: "Git 只读文档" })).toBeNull();
  } finally {
    slot.unmount();
  }
});

it("recovers a failed first read and refreshes missed registration changes after reconnect", async () => {
  const app = await loadPluginApp(entry);
  let offline = true;
  let registration: ReturnType<typeof registrationSchema.parse> | null =
    registrationSchema.parse({
      threadId: "thread",
      topic: "目标",
      workbook: "/repo/workbook.md",
      ledger: "/repo/ledger.md",
      checker: "/skills/steward_workbook.py",
      schemaVersion: 1,
      projectId: "project",
      hostId: "host",
      repoRoot: "/repo",
      workbookRelativePath: "workbook.md",
      registeredAt: "2026-10-27T00:00:00.000Z",
    });
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "thread", projectId: "project", isCompactViewport: false },
    {
      rpc: {
        show: () => {
          if (offline) throw new Error("offline");
          return registration;
        },
      },
    },
  );
  expect(slot.queryByRole("button", { name: "打开工作簿" })).toBeNull();
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  offline = false;
  await slot.behavior.setRealtimeConnectionState("connected");
  await slot.findByRole("button", { name: "打开工作簿" });
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  registration = null;
  await slot.behavior.setRealtimeConnectionState("connected");
  expect(slot.queryByRole("button", { name: "打开工作簿" })).toBeNull();
  slot.unmount();
});

it("shows a visible message when file preview navigation is rejected", async () => {
  const app = await loadPluginApp(entry);
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "thread", projectId: "project", isCompactViewport: false },
    {
      rpc: {
        show: () =>
          registrationSchema.parse({
            threadId: "thread",
            topic: "目标",
            workbook: "/repo/workbook.md",
            ledger: "/repo/ledger.md",
            checker: "/skills/steward_workbook.py",
            schemaVersion: 1,
            projectId: "project",
            hostId: "host",
            repoRoot: "/repo",
            workbookRelativePath: "workbook.md",
            registeredAt: "2026-10-27T00:00:00.000Z",
          }),
        document: () => ({ available: true, message: "" }),
      },
      openFilePreview: () => false,
    },
  );
  const button = await slot.findByRole("button", { name: "打开工作簿" });
  button.click();
  await slot.findByText("当前页面无法打开文件预览，请返回管家会话后重试。");
  slot.unmount();
});

it("floating document buttons retain the focused thread's navigation through the portal", async () => {
  const app = await loadPluginApp(entry);
  const storageKey = "steward.collapsed.thread";
  const previous = localStorage.getItem(storageKey);
  localStorage.setItem(storageKey, "false");
  const opened: string[] = [];
  const pending: Array<
    (result: { available: boolean; message: string }) => void
  > = [];
  let delayed = false;
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "thread", projectId: "project", isCompactViewport: false },
    {
      context: { threadId: "thread", projectId: "project" },
      rpc: {
        show: () =>
          registrationSchema.parse({
            threadId: "thread",
            topic: "目标",
            workbook: "/repo/workbook.md",
            ledger: "/repo/ledger.md",
            checker: "/skills/steward_workbook.py",
            schemaVersion: 1,
            projectId: "project",
            hostId: "host",
            repoRoot: "/repo",
            workbookRelativePath: "workbook.md",
            registeredAt: "2026-10-27T00:00:00.000Z",
          }),
        document: () =>
          delayed
            ? new Promise((resolve) => pending.push(resolve))
            : { available: true, message: "" },
      },
      openFilePreview: (options) => {
        opened.push(options.target.path);
        return true;
      },
    },
  );
  try {
    const floating = await slot.findByRole("complementary", {
      name: "管家工作簿",
    });
    expect(slot.container.contains(floating)).toBe(false);
    for (const name of ["打开工作簿", "打开要求帐"]) {
      const button = floating.querySelector<HTMLButtonElement>(
        `button[aria-label="${name}"]`,
      )!;
      button.click();
      await slot.findByRole("button", { name: "收合管家浮窗" });
    }
    await vi.waitFor(() =>
      expect(opened).toEqual(["/repo/workbook.md", "/repo/ledger.md"]),
    );
    delayed = true;
    floating
      .querySelector<HTMLButtonElement>('button[aria-label="打开工作簿"]')!
      .click();
    floating
      .querySelector<HTMLButtonElement>('button[aria-label="打开要求帐"]')!
      .click();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!({ available: true, message: "" });
    await vi.waitFor(() => expect(opened).toHaveLength(3));
    pending[0]!({ available: true, message: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened).toEqual([
      "/repo/workbook.md",
      "/repo/ledger.md",
      "/repo/ledger.md",
    ]);
  } finally {
    slot.unmount();
    if (previous === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, previous);
  }
});

it("reads Git history in the plugin at the pinned SHA and clears old content when a remote refresh fails", async () => {
  const app = await loadPluginApp(entry);
  const sha = "a".repeat(40);
  let failed = false;
  const slot = renderSlot(
    app.tabs.find(
      (
        tab,
      ): tab is Extract<
        ExperimentalTabRegistration,
        {
          context: { kind: "thread" };
          availability: "action";
        }
      > =>
        tab.context.kind === "thread" &&
        tab.availability === "action" &&
        tab.id === "document",
    )!,
    { threadId: "git", params: { document: "ledger" } },
    {
      rpc: {
        show: () =>
          registrationSchema.parse({
            threadId: "git",
            topic: "历史目标",
            workbook: "docs/workbook.md",
            ledger: "docs/history/README.md",
            checker: "/checker.py",
            source: { kind: "git", repo: "/repo", ref: "origin/main" },
            ledgerKind: "history",
            schemaVersion: 1,
            projectId: "project",
            hostId: "original-host",
            repoRoot: "/repo",
            workbookRelativePath: "docs/workbook.md",
            registeredAt: "2026-10-27",
          }),
        document: (input) =>
          failed
            ? { available: false, message: "远端无法核实" }
            : {
                available: true,
                message: "历史流水账；统计不适用",
                snapshot: { repo: "/repo", ref: "origin/main", sha },
                path: documentRequest.parse(input).link
                  ? "docs/history/old.md"
                  : "docs/history/README.md",
                content: documentRequest.parse(input).link
                  ? "原始旧账正文"
                  : "[旧账](old.md)",
              },
      },
    },
  );
  try {
    await slot.findByText(`SHA：${sha}`, { exact: false });
    (await slot.findByRole("link", { name: "旧账" })).click();
    await slot.findByText("原始旧账正文");
    expect(slot.inspection.rpcCalls.at(-1)).toMatchObject({
      method: "document",
      input: {
        threadId: "git",
        document: "ledger",
        link: { from: "docs/history/README.md", target: "old.md", sha },
      },
    });
    expect(slot.inspection.navigateCalls).toHaveLength(0);
    failed = true;
    (await slot.findByRole("button", { name: "刷新远端文档" })).click();
    await slot.findByText("远端无法核实");
    expect(slot.queryByText("原始旧账正文")).toBeNull();
    failed = false;
    (await slot.findByRole("button", { name: "刷新远端文档" })).click();
    await slot.findByRole("link", { name: "旧账" });
  } finally {
    slot.unmount();
  }
});

it("labels historical ledger statistics as inapplicable without zero counts or a passing ledger check", async () => {
  const app = await loadPluginApp(entry);
  const key = "steward.collapsed.history";
  const previous = localStorage.getItem(key);
  localStorage.setItem(key, "false");
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "history", projectId: "project", isCompactViewport: false },
    {
      context: { threadId: "history", projectId: "project" },
      rpc: {
        show: () =>
          registrationSchema.parse({
            threadId: "history",
            topic: "历史",
            workbook: "/repo/workbook.md",
            ledger: "/repo/history.md",
            checker: "/checker.py",
            ledgerKind: "history",
            schemaVersion: 1,
            projectId: "project",
            hostId: "host",
            repoRoot: "/repo",
            workbookRelativePath: "workbook.md",
            registeredAt: "2026-10-27",
          }),
        refresh: () => ({
          checkedAt: "2026-10-27",
          workbook: { ok: true, applicable: true, errors: [] },
          ledger: {
            ok: false,
            applicable: false,
            errors: ["历史流水账；标准五列表统计不适用"],
          },
        }),
      },
    },
  );
  try {
    (await slot.findByRole("button", { name: "摘要" })).click();
    (await slot.findByRole("button", { name: "刷新检查" })).click();
    await slot.findByText("要求帐 ledger-check：不适用");
    await slot.findByText(/進行中：不适用\s*待使用者：不适用/);
    expect(slot.queryByText("要求帐 ledger-check：通过")).toBeNull();
  } finally {
    slot.unmount();
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  }
});
