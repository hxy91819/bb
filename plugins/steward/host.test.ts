import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "./host";
import { registerInput } from "./contract";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "steward-git-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const run = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  execFileSync("git", ["init", "--bare", "-q", remote]);
  execFileSync("git", ["init", "-q", repo]);
  run("config", "user.name", "Test");
  run("config", "user.email", "test@example.invalid");
  run("remote", "add", "origin", remote);
  await mkdir(join(repo, "docs", "history"), { recursive: true });
  const advance = async (version: string) => {
    await mkdir(join(repo, "docs", "history"), { recursive: true });
    await writeFile(
      join(repo, "docs", "workbook.md"),
      `# ${version}\n[要求帐（历史流水账）](history/README.md)\n## 路线\n`,
    );
    await writeFile(
      join(repo, "docs", "history", "README.md"),
      `[旧账](old.md)\n${version}`,
    );
    await writeFile(join(repo, "docs", "history", "old.md"), `旧账 ${version}`);
    run("add", ".");
    run("commit", "-qm", version);
    run("push", "-q", "origin", "HEAD:refs/heads/main");
    return run("rev-parse", "HEAD");
  };
  const sha = await advance("first");
  const checker = join(root, "checker.py");
  await writeFile(
    checker,
    'import json\nprint(json.dumps({"ok": True, "errors": []}))\n',
  );
  const registration = registerInput.parse({
    threadId: "owner",
    topic: "目标",
    workbook: "docs/workbook.md",
    ledger: "docs/history/README.md",
    ledgerKind: "history",
    checker,
    source: { kind: "git", repo, ref: "origin/main" },
  });
  const harness = experimental_createHostEntryHarness(entry);
  cleanups.push(() => harness.experimental_dispose());
  return {
    repo,
    remote,
    run,
    advance,
    sha,
    registration,
    call: harness.experimental_call.bind(harness),
  };
}
it("opens verified remote content without disk files, follows history at the same SHA, and refreshes advanced refs", async () => {
  const f = await fixture();
  await rm(join(f.repo, "docs"), { recursive: true });
  const opened = await f.call("document", {
    registration: f.registration,
    document: "ledger",
  });
  expect(opened).toMatchObject({
    available: true,
    snapshot: { sha: f.sha },
    content: "[旧账](old.md)\nfirst",
  });
  await f.advance("large-base");
  const largeHistory = "旧账正文\n".repeat(380000);
  await writeFile(join(f.repo, "docs/history/old.md"), largeHistory);
  f.run("add", ".");
  f.run("commit", "-qm", "large history");
  f.run("push", "-q", "origin", "HEAD:refs/heads/main");
  const largeSha = f.run("rev-parse", "HEAD");
  const large = await f.call("document", {
    registration: f.registration,
    document: "ledger",
    link: { from: "docs/history/README.md", target: "old.md", sha: largeSha },
  });
  expect(large.available).toBe(true);
  expect(largeHistory.startsWith(large.content ?? "")).toBe(true);
  expect(large.next).toBeTruthy();
  expect(large.snapshot?.sha).toBe(largeSha);
  const next = await f.advance("second");
  const linked = await f.call("document", {
    registration: f.registration,
    document: "ledger",
    link: { from: "docs/history/README.md", target: "old.md#记录", sha: f.sha },
  });
  expect(linked).toMatchObject({
    available: true,
    snapshot: { sha: f.sha },
    content: "旧账 first",
  });
  await writeFile(join(f.repo, "docs/workbook.md"), "磁盘不同版本");
  expect(
    await f.call("document", {
      registration: f.registration,
      document: "workbook",
    }),
  ).toMatchObject({
    available: true,
    snapshot: { sha: next },
    content: expect.stringContaining("# second"),
  });
  const checks = await f.call("check", f.registration);
  expect(checks.snapshot?.sha).toBe(next);
  expect(checks.ledger).toMatchObject({ ok: false, applicable: false });
  expect(checks.ledger.summary).toBeUndefined();
});
it("fails closed after remote deletion or loss and rejects links outside the source", async () => {
  const f = await fixture();
  const invalid = await f.call("document", {
    registration: f.registration,
    document: "ledger",
    link: { from: "docs/workbook.md", target: "../../outside.md", sha: f.sha },
  });
  expect(invalid.available).toBe(false);
  f.run("push", "-q", "origin", ":refs/heads/main");
  const deleted = await f.call("document", {
    registration: f.registration,
    document: "workbook",
  });
  expect(deleted).toMatchObject({
    available: false,
    message: expect.stringContaining("无法核实 Git 远端"),
  });
  expect(deleted.content).toBeUndefined();
  await f.advance("restored");
  await rm(f.remote, { recursive: true });
  const checks = await f.call("check", f.registration);
  expect(checks.workbook.ok).toBe(false);
  expect(checks.ledger.ok).toBe(false);
  expect(checks.snapshot).toBeUndefined();
});
it("keeps standard local files and reports missing header entries explicitly", async () => {
  const f = await fixture();
  const local = registerInput.parse({
    ...f.registration,
    source: { kind: "local" },
    workbook: join(f.repo, "docs/workbook.md"),
    ledger: join(f.repo, "docs/history/README.md"),
    ledgerKind: "standard",
  });
  await writeFile(
    local.workbook,
    "# 目标\n[要求帐](history/README.md)\n## 路线\n",
  );
  expect(
    await f.call("document", { registration: local, document: "workbook" }),
  ).toEqual({ available: true, message: "" });
  expect((await f.call("check", local)).ledger).toMatchObject({
    ok: true,
    applicable: true,
  });
  await symlink(local.ledger, join(f.repo, "docs/linked-ledger.md"));
  await writeFile(
    local.workbook,
    "# 目标\n[要求帐](linked-ledger.md)\n## 路线\n",
  );
  expect((await f.call("check", local)).ledger.ok).toBe(true);
  await writeFile(local.workbook, "# 无入口\n## 路线\n");
  expect((await f.call("check", local)).workbook.errors).toContain(
    "工作簿标头缺少要求帐入口；check 通过不代表入口齐全。",
  );
});
