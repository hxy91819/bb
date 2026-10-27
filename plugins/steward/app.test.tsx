// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { expect, it, vi } from "vitest";
import entry from "./app";
import { registrationSchema } from "./contract";

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
        document: () => ({ available: true, message: "" }),
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
  } finally {
    slot.unmount();
    if (previous === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, previous);
  }
});
