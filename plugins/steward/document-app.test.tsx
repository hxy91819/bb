// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { expect, it } from "vitest";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import appEntry from "./app";
import { documentFixture } from "./document-test-support";

it("UI opens README → month directory → original shard at the displayed SHA until refresh", async () => {
  const f = await documentFixture();
  const app = await loadPluginApp(appEntry);
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "original", projectId: "project", isCompactViewport: false },
    {
      rpc: {
        show: () => f.registration,
        document: (input) => f.harness.behavior.callRpc("document", input),
      },
    },
  );
  try {
    (await slot.findByRole("button", { name: "打开要求帐" })).click();
    (await slot.findByRole("button", { name: "2026-10" })).click();
    await slot.findByRole("region", { name: "Git 目录" });
    await writeFile(join(f.repo, f.directory, "00-账目😀.md"), "新分片");
    const advanced = await f.advance();
    (await slot.findByRole("button", { name: "00-账目😀.md" })).click();
    await slot.findByText("原始分片 0");
    await slot.findByText(`SHA：${f.sha}`, { exact: false });
    expect(slot.inspection.navigateCalls).toHaveLength(0);
    (await slot.findByRole("button", { name: "刷新远端文档" })).click();
    await slot.findByText(`SHA：${advanced}`, { exact: false });
    expect(slot.queryByText("原始分片 0")).toBeNull();
  } finally {
    slot.unmount();
    await f.dispose();
  }
});

it("UI continues a partial Unicode file at its original SHA and marks completion after the last page", async () => {
  const f = await documentFixture();
  const content = "a".repeat(65534) + "😀中文尾页";
  await writeFile(join(f.repo, "docs/steward/join-changes.md"), content);
  const sha = await f.advance();
  const app = await loadPluginApp(appEntry);
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "original", projectId: "project", isCompactViewport: false },
    {
      rpc: {
        show: () => f.registration,
        document: (input) => f.harness.behavior.callRpc("document", input),
      },
    },
  );
  try {
    (await slot.findByRole("button", { name: "打开要求帐" })).click();
    (await slot.findByRole("button", { name: "旧账" })).click();
    await slot.findByText(/正文尚未完整读取/);
    await writeFile(join(f.repo, "docs/steward/join-changes.md"), "另一版本");
    await f.advance();
    (await slot.findByRole("button", { name: "继续读取正文" })).click();
    await slot.findByText(/正文已完整读取/);
    expect(
      (await slot.findByRole("region", { name: "Git 只读文档" })).querySelector(
        "pre",
      )?.textContent,
    ).toBe(content);
    await slot.findByText(`SHA：${sha}`, { exact: false });
    expect(slot.queryByRole("button", { name: "继续读取正文" })).toBeNull();
  } finally {
    slot.unmount();
    await f.dispose();
  }
});

it("UI follows docs README to root, reenters docs and returns to the same root without changing SHA", async () => {
  const f = await documentFixture();
  await writeFile(join(f.repo, "docs/README.md"), "[根目录](../)");
  await writeFile(
    join(f.repo, "docs/steward/join-changes/README.md"),
    "[文档说明](../../README.md)",
  );
  const sha = await f.advance();
  const app = await loadPluginApp(appEntry);
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "original", projectId: "project", isCompactViewport: false },
    {
      rpc: {
        show: () => f.registration,
        document: (input) => f.harness.behavior.callRpc("document", input),
      },
    },
  );
  try {
    (await slot.findByRole("button", { name: "打开要求帐" })).click();
    (await slot.findByRole("button", { name: "文档说明" })).click();
    (await slot.findByRole("button", { name: "根目录" })).click();
    await slot.findByRole("region", { name: "Git 目录" });
    await writeFile(join(f.repo, "new-root-file.md"), "远端新文件");
    await f.advance();
    (await slot.findByRole("button", { name: "docs" })).click();
    await slot.findByRole("button", { name: "README.md" });
    (await slot.findByRole("button", { name: "上级目录" })).click();
    await slot.findByRole("button", { name: "docs" });
    await slot.findByText(`SHA：${sha}`, { exact: false });
    expect(slot.queryByRole("button", { name: "new-root-file.md" })).toBeNull();
  } finally {
    slot.unmount();
    await f.dispose();
  }
});
