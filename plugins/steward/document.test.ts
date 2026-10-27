import { expect, it } from "vitest";
import { z } from "zod";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { documentFixture } from "./document-test-support";

const result = z.object({
  available: z.boolean(),
  content: z.string().optional(),
  kind: z.enum(["file", "directory"]).optional(),
  path: z.string().optional(),
  snapshot: z
    .object({ repo: z.string(), ref: z.string(), sha: z.string() })
    .optional(),
  entries: z
    .array(
      z.object({
        name: z.string(),
        path: z.string(),
        kind: z.enum(["file", "directory"]),
      }),
    )
    .optional(),
  next: z
    .object({ path: z.string(), sha: z.string(), offset: z.number() })
    .nullable()
    .optional(),
});
it("CLI traverses the original README directory link and pages entries and Unicode ledger below the CLI output limit at one SHA", async () => {
  const f = await documentFixture();
  try {
    let maxOutputBytes = 0;
    let requests = 0;
    const cli = async (args: string[]) => {
      const output = await f.harness.behavior.runCli([
        "document",
        "--thread",
        "original",
        "--document",
        "ledger",
        "--json",
        ...args,
      ]);
      expect(output.exitCode, output.stdout + output.stderr).toBe(0);
      expect(
        Buffer.byteLength(output.stdout ?? "") +
          Buffer.byteLength(output.stderr ?? ""),
      ).toBeLessThan(1024 * 1024);
      maxOutputBytes = Math.max(
        maxOutputBytes,
        Buffer.byteLength(output.stdout ?? "") +
          Buffer.byteLength(output.stderr ?? ""),
      );
      requests++;
      const page = result.parse(JSON.parse(output.stdout!));
      expect(page.available).toBe(true);
      expect(page.snapshot).toEqual({
        repo: f.repo,
        ref: "origin/main",
        sha: f.sha,
      });
      return page;
    };
    const index = await cli([]);
    expect(index.content).toContain("[2026-10](2026-10/)");
    const folder = await cli([
      "--from",
      index.path!,
      "--target",
      "2026-10/",
      "--sha",
      f.sha,
    ]);
    expect(folder.kind).toBe("directory");
    expect(folder.content).toBeUndefined();
    expect(folder.entries?.[0]).toMatchObject({
      name: "00-账目😀.md",
      kind: "file",
    });
    const file = await cli([
      "--from",
      `${folder.path}/`,
      "--target",
      folder.entries![0].name,
      "--sha",
      f.sha,
    ]);
    expect(file.content).toBe("原始分片 0");
    let page = await cli([
      "--from",
      index.path!,
      "--target",
      "../join-changes.md",
      "--sha",
      f.sha,
    ]);
    expect(page.next).toBeTruthy();
    expect(page.kind).toBe("file");
    const parts = [page.content!];
    await writeFile(join(f.repo, "docs/steward/join-changes.md"), "远端新正文");
    await writeFile(join(f.repo, f.directory, "00-账目😀.md"), "新分片");
    await writeFile(join(f.repo, f.directory, "24-new.md"), "新目录项");
    const advanced = await f.advance();
    expect(advanced).not.toBe(f.sha);
    while (page.next) {
      page = await cli([
        "--cursor",
        JSON.stringify(page.next),
        "--limit",
        "65536",
      ]);
      parts.push(page.content!);
    }
    expect(parts.join("")).toBe(f.content);
    expect(createHash("sha256").update(parts.join("")).digest("hex")).toBe(
      createHash("sha256").update(f.content).digest("hex"),
    );
    let directories = await cli([
      "--from",
      index.path!,
      "--target",
      "2026-10/",
      "--sha",
      f.sha,
      "--limit",
      "1024",
    ]);
    expect(directories.next).toBeTruthy();
    const names = directories.entries!.map((entry) => entry.name);
    while (directories.next) {
      directories = await cli([
        "--cursor",
        JSON.stringify(directories.next),
        "--limit",
        "1024",
      ]);
      names.push(...directories.entries!.map((entry) => entry.name));
    }
    expect(names).toHaveLength(24);
    expect(new Set(names).size).toBe(24);
    const fresh = result.parse(
      await f.harness.behavior.callRpc("document", {
        threadId: "original",
        document: "ledger",
      }),
    );
    expect(fresh.snapshot?.sha).toBe(advanced);
    console.info("Steward CLI pagination evidence", {
      contentBytes: Buffer.byteLength(f.content),
      maxOutputBytes,
      requests,
      pages: parts.length,
    });
  } finally {
    await f.dispose();
  }
}, 30000);

it("default CLI request for a registered large ledger returns a resumable first page instead of core output-limit failure", async () => {
  const f = await documentFixture();
  try {
    f.registration.ledger = "docs/steward/join-changes.md";
    await writeFile(
      join(f.repo, "docs/steward/workbook.md"),
      "# 目标\n[要求帐（历史流水账）](join-changes.md)\n## 路线\n",
    );
    const sha = await f.advance();
    const output = await f.harness.behavior.runCli([
      "document",
      "--thread",
      "original",
      "--document",
      "ledger",
      "--json",
    ]);
    expect(output.exitCode, output.stdout + output.stderr).toBe(0);
    expect(
      Buffer.byteLength(output.stdout ?? "") +
        Buffer.byteLength(output.stderr ?? ""),
    ).toBeLessThan(1024 * 1024);
    const page = result.parse(JSON.parse(output.stdout!));
    expect(page.next).toBeTruthy();
    expect(page.snapshot?.sha).toBe(sha);
    expect(f.content.startsWith(page.content!)).toBe(true);
  } finally {
    await f.dispose();
  }
});

it("rejects invalid UTF-8 offsets, conflicting navigation and oversized page limits without returning partial success", async () => {
  const f = await documentFixture();
  try {
    const cursor = {
      path: "docs/steward/join-changes.md",
      sha: f.sha,
      offset: 1,
    };
    const invalid = result.parse(
      await f.harness.behavior.callRpc("document", {
        threadId: "original",
        document: "ledger",
        cursor,
      }),
    );
    expect(invalid.available).toBe(false);
    expect(invalid.content).toBeUndefined();
    const conflict = result.parse(
      await f.harness.behavior.callRpc("document", {
        threadId: "original",
        document: "ledger",
        cursor,
        link: {
          from: "docs/steward/workbook.md",
          target: "join-changes.md",
          sha: f.sha,
        },
      }),
    );
    expect(conflict.available).toBe(false);
    expect(
      (
        await f.harness.behavior.runCli([
          "document",
          "--thread",
          "original",
          "--document",
          "ledger",
          "--limit",
          "1048576",
        ])
      ).exitCode,
    ).toBe(1);
  } finally {
    await f.dispose();
  }
});

it("CLI resolves README parent and docs parent as the root tree and enters docs again at the original SHA", async () => {
  const f = await documentFixture();
  try {
    await writeFile(join(f.repo, "docs/README.md"), "[根目录](../)");
    const sha = await f.advance();
    const cli = async (from: string, target: string) => {
      const output = await f.harness.behavior.runCli([
        "document",
        "--thread",
        "original",
        "--document",
        "ledger",
        "--from",
        from,
        "--target",
        target,
        "--sha",
        sha,
        "--json",
      ]);
      expect(output.exitCode, output.stdout + output.stderr).toBe(0);
      const page = result.parse(JSON.parse(output.stdout!));
      expect(page.available).toBe(true);
      expect(page.kind).toBe("directory");
      expect(page.content).toBeUndefined();
      expect(page.snapshot?.sha).toBe(sha);
      return page;
    };
    const root = await cli("docs/README.md", "../");
    expect(root.path).toBe(".");
    expect(root.entries).toContainEqual({
      name: "docs",
      path: "docs",
      kind: "directory",
    });
    await writeFile(join(f.repo, "new-root-file.md"), "远端新文件");
    await f.advance();
    const parent = await cli("docs/", "../");
    expect(parent.entries).toEqual(root.entries);
    const docs = await cli("./", "docs/");
    expect(docs.path).toBe("docs");
    expect(docs.entries).toContainEqual({
      name: "README.md",
      path: "docs/README.md",
      kind: "file",
    });
  } finally {
    await f.dispose();
  }
});
