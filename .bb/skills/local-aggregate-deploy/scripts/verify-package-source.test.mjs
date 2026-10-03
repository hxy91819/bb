import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPackageSource } from "./verify-package-source.mjs";

function git(repoPath, ...args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function withRepository(run) {
  const repoPath = mkdtempSync(join(tmpdir(), "bb-package-source-"));
  const forkPath = mkdtempSync(join(tmpdir(), "bb-package-fork-"));
  try {
    git(forkPath, "init", "-q", "--bare");
    git(repoPath, "init", "-q", "-b", "local/aggregate");
    git(repoPath, "config", "user.email", "test@example.com");
    git(repoPath, "config", "user.name", "Test");
    writeFileSync(join(repoPath, "source.txt"), "first\n");
    git(repoPath, "add", "source.txt");
    git(repoPath, "commit", "-q", "-m", "aggregate");
    git(repoPath, "remote", "add", "fork", forkPath);
    git(repoPath, "push", "-q", "fork", "HEAD:refs/heads/local/aggregate");
    run(repoPath);
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(forkPath, { recursive: true, force: true });
  }
}

test("accepts a clean checkout of the published aggregate", () => {
  withRepository((repoPath) => {
    const source = verifyPackageSource({ repoPath });
    assert.equal(source.sourceCommit, git(repoPath, "rev-parse", "HEAD"));
  });
});

test("accepts a detached checkout of the published aggregate", () => {
  withRepository((repoPath) => {
    git(repoPath, "switch", "-q", "--detach", "HEAD");
    assert.doesNotThrow(() => verifyPackageSource({ repoPath }));
  });
});

test("rejects an aggregate that has not been pushed to the fork", () => {
  withRepository((repoPath) => {
    writeFileSync(join(repoPath, "source.txt"), "second\n");
    git(repoPath, "commit", "-q", "-am", "unpublished aggregate");
    assert.throws(() => verifyPackageSource({ repoPath }), /published aggregate mismatch/u);
  });
});

test("rejects tracked changes", () => {
  withRepository((repoPath) => {
    writeFileSync(join(repoPath, "source.txt"), "changed\n");
    assert.throws(() => verifyPackageSource({ repoPath }), /not clean/u);
  });
});

test("rejects untracked files that could enter the package", () => {
  withRepository((repoPath) => {
    writeFileSync(join(repoPath, "untracked.ts"), "export const changed = true;\n");
    assert.throws(() => verifyPackageSource({ repoPath }), /not clean/u);
  });
});
