import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replacementDropIn } from "./fork-cutover.mjs";

test("installed cutover changes both pointers and retains data, flags and other directives", () => {
  const oldDirectory = "/opt/old";
  const dropIn =
    "[Service]\nWorkingDirectory=/opt/old\nExecStart=\nExecStart=/opt/old/bin/bb-app --data-dir /opt/old/data --server-port 1234\nEnvironment=HOME=/root\nOOMPolicy=continue\n";
  assert.equal(
    replacementDropIn({
      dropIn,
      oldDirectory,
      target: "/opt/new",
      release: true,
    }),
    "[Service]\nWorkingDirectory=/opt/new\nExecStart=\nExecStart=/opt/new/bin/bb-app --data-dir /opt/old/data --server-port 1234\nEnvironment=HOME=/root\nOOMPolicy=continue\n",
  );
});

test("source cutover retains Node and launcher arguments", () => {
  const dropIn =
    "[Service]\nWorkingDirectory=/src/old\nExecStart=\nExecStart=/usr/bin/node --import tsx /src/old/scripts/start-bb.mjs --data-dir /data/bb\n";
  assert.equal(
    replacementDropIn({
      dropIn,
      oldDirectory: "/src/old",
      target: "/src/new",
      release: false,
    }),
    "[Service]\nWorkingDirectory=/src/new\nExecStart=\nExecStart=/usr/bin/node --import tsx /src/new/scripts/start-bb.mjs --data-dir /data/bb\n",
  );
  assert.throws(
    () =>
      replacementDropIn({
        dropIn,
        oldDirectory: "/src/old",
        target: "/opt/pkg",
        release: true,
      }),
    /must not be mixed/,
  );
});

test("cutover rejects a stale working directory and installed-to-source mismatch", () => {
  const dropIn =
    "[Service]\nWorkingDirectory=/opt/old\nExecStart=\nExecStart=/opt/old/bin/bb-app --data-dir /data/bb\n";
  assert.throws(
    () =>
      replacementDropIn({
        dropIn,
        oldDirectory: "/obsolete",
        target: "/opt/new",
        release: true,
      }),
    /actual WorkingDirectory/,
  );
  assert.throws(
    () =>
      replacementDropIn({
        dropIn,
        oldDirectory: "/opt/old",
        target: "/src/new",
        release: false,
      }),
    /must not be mixed/,
  );
});

for (const dataDirectory of ["/data/bb", "/src/old/data"]) {
  test(`documented relative source launcher preserves ${dataDirectory}`, () => {
    const command = `ExecStart=/usr/bin/node --conditions=source --import tsx packages/bb-app/src/bin/bb-app.ts --data-dir ${dataDirectory}\n`;
    const dropIn = `[Service]\nWorkingDirectory=/src/old\nExecStart=\n${command}`;
    assert.equal(
      replacementDropIn({
        dropIn,
        oldDirectory: "/src/old",
        target: "/src/new",
        release: false,
      }),
      `[Service]\nWorkingDirectory=/src/new\nExecStart=\n${command}`,
    );
  });
}

for (const dirty of ["legacy", "tracked", "untracked"]) {
  test(`promote refuses ${dirty} roots without changing files or HEAD`, () => {
    const root = mkdtempSync(join(tmpdir(), "bb-promote-"));
    try {
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      };
      const git = (...args) =>
        execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
      git("init", "-q", "-b", "local/aggregate");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.com");
      mkdirSync(join(root, ".fork"));
      writeFileSync(join(root, ".fork/branches"), "base desktop-v1.0.0\n");
      writeFileSync(
        join(root, "AGENTS.md"),
        dirty === "legacy"
          ? "<!-- open-source-fork-maintenance:start -->\n"
          : "<!-- fork-maintenance:start -->\n",
      );
      git("add", ".");
      git("commit", "-qm", "fixture");
      const before = git("rev-parse", "HEAD");
      if (dirty === "tracked")
        writeFileSync(
          join(root, "AGENTS.md"),
          "<!-- fork-maintenance:start -->\ndirty\n",
        );
      if (dirty === "untracked")
        writeFileSync(join(root, "user-work"), "preserve\n");
      const status = git("status", "--porcelain");
      const result = spawnSync(
        "bash",
        [
          new URL("./fork-aggregate", import.meta.url).pathname,
          "--promote-only",
        ],
        { cwd: root, env, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        dirty === "legacy" ? /旧维护模型/ : /未提交或未跟踪/,
      );
      assert.equal(git("rev-parse", "HEAD"), before);
      assert.equal(git("status", "--porcelain"), status);
      if (dirty === "untracked")
        assert.equal(
          readFileSync(join(root, "user-work"), "utf8"),
          "preserve\n",
        );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("a clean migrated root promotes the verified SHA to a local fork", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-promote-clean-"));
  try {
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const git = (...args) =>
      execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "local/aggregate");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    mkdirSync(join(root, ".fork"));
    writeFileSync(join(root, ".fork/branches"), "base desktop-v1.0.0\n");
    writeFileSync(join(root, "AGENTS.md"), "<!-- fork-maintenance:start -->\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("tag", "desktop-v1.0.0");
    git("branch", "main");
    git("branch", "fork-tooling");
    const remote = join(root, ".git", "remote.git");
    git("init", "--bare", "-q", remote);
    git("remote", "add", "origin", remote);
    git("remote", "add", "fork", remote);
    git(
      "push",
      "-q",
      "fork",
      "main",
      "local/aggregate",
      "fork-tooling",
      "refs/tags/desktop-v1.0.0",
    );
    const next = git(
      "commit-tree",
      "HEAD^{tree}",
      "-p",
      "HEAD",
      "-m",
      "verified candidate",
    );
    git("branch", "aggregate/next", next);
    const result = spawnSync(
      "bash",
      [new URL("./fork-aggregate", import.meta.url).pathname, "--promote-only"],
      { cwd: root, env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git("rev-parse", "HEAD"), next);
    assert.equal(
      git("ls-remote", "fork", "refs/heads/local/aggregate").split("\t")[0],
      next,
    );
    assert.equal(git("status", "--porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
