import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "./host";
import plugin from "./server";
import { registrationSchema, hostContract } from "./contract";

export async function documentFixture() {
  const root = await mkdtemp(join(tmpdir(), "steward-documents-"));
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
  const directory = "docs/steward/join-changes/2026-10";
  await mkdir(join(repo, directory), { recursive: true });
  const content = '中文账目😀🧭"\\\t\u0001\n'.repeat(190000);
  await writeFile(
    join(repo, "docs/steward/workbook.md"),
    "# 目标\n[要求帐（历史流水账）](join-changes/README.md)\n## 路线\n",
  );
  await writeFile(
    join(repo, "docs/steward/join-changes/README.md"),
    "# 历史索引\n[2026-10](2026-10/)\n[旧账](../join-changes.md)",
  );
  await writeFile(join(repo, "docs/steward/join-changes.md"), content);
  for (let i = 0; i < 24; i++)
    await writeFile(
      join(repo, directory, `${String(i).padStart(2, "0")}-账目😀.md`),
      `原始分片 ${i}`,
    );
  const advance = async () => {
    run("add", ".");
    run("commit", "-qm", "documents");
    run("push", "-q", "origin", "HEAD:refs/heads/main");
    return run("rev-parse", "HEAD");
  };
  const sha = await advance();
  const host = experimental_createHostEntryHarness(hostEntry);
  const registration = registrationSchema.parse({
    threadId: "original",
    topic: "历史",
    workbook: "docs/steward/workbook.md",
    ledger: "docs/steward/join-changes/README.md",
    checker: "/checker.py",
    source: { kind: "git", repo, ref: "origin/main" },
    ledgerKind: "history",
    schemaVersion: 1,
    projectId: "project",
    hostId: "original-host",
    repoRoot: repo,
    workbookRelativePath: "docs/steward/workbook.md",
    registeredAt: "2026-10-27",
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "steward",
    sdk: { threads: { getPluginMetadata: () => ({ registration }) } },
    experimental_callHostRpc: ({ method, input }) =>
      method === "document"
        ? host.experimental_call(
            "document",
            hostContract.document.input.parse(input),
          )
        : Promise.reject(new Error(`Unexpected host method: ${method}`)),
  });
  plugin(bb);
  return {
    repo,
    sha,
    content,
    directory,
    registration,
    advance,
    harness,
    async dispose() {
      await harness.lifecycle.dispose();
      await host.experimental_dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}
