import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPackageSource } from "./verify-package-source.mjs";

const candidateRef = "refs/tags/fork-candidate/example";
const releaseRef = "refs/tags/fork-release/example";

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
    git(repoPath, "tag", "fork-candidate/example");
    git(repoPath, "remote", "add", "fork", forkPath);
    git(repoPath, "push", "-q", "fork", "HEAD:refs/heads/local/aggregate");
    run(repoPath, forkPath);
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(forkPath, { recursive: true, force: true });
  }
}

test("accepts a candidate promoted to the checked-out aggregate branch", () => {
  withRepository((repoPath) => {
    const source = verifyPackageSource({
      repoPath,
      aggregateRef: "refs/heads/local/aggregate",
      candidateRef,
    });
    assert.equal(source.sourceCommit, git(repoPath, "rev-parse", "HEAD"));
  });
});

test("rejects packaging directly from a detached candidate checkout", () => {
  withRepository((repoPath) => {
    const candidateCommit = git(repoPath, "rev-parse", "HEAD");
    writeFileSync(join(repoPath, "source.txt"), "second\n");
    git(repoPath, "commit", "-q", "-am", "new aggregate state");
    git(repoPath, "switch", "-q", "--detach", candidateCommit);
    assert.throws(
      () => verifyPackageSource({
        repoPath,
        aggregateRef: "refs/heads/local/aggregate",
        candidateRef,
      }),
      /local package source must be checked out on local\/aggregate/u,
    );
  });
});

test("rejects an aggregate branch whose HEAD differs from the frozen candidate", () => {
  withRepository((repoPath) => {
    writeFileSync(join(repoPath, "source.txt"), "second\n");
    git(repoPath, "commit", "-q", "-am", "new aggregate state");
    assert.throws(
      () => verifyPackageSource({
        repoPath,
        aggregateRef: "refs/heads/local/aggregate",
        candidateRef,
      }),
      /package source mismatch/u,
    );
  });
});

test("accepts a detached checkout of the promoted immutable release", () => {
  withRepository((repoPath) => {
    git(repoPath, "tag", "fork-release/example");
    git(repoPath, "switch", "-q", "--detach", "HEAD");
    const source = verifyPackageSource({ repoPath, aggregateRef: releaseRef, candidateRef });
    assert.equal(source.sourceCommit, git(repoPath, "rev-parse", "HEAD"));
  });
});

test("rejects a release tag when the published aggregate points elsewhere", () => {
  withRepository((repoPath) => {
    const candidateCommit = git(repoPath, "rev-parse", "HEAD");
    git(repoPath, "tag", "fork-release/example");
    writeFileSync(join(repoPath, "source.txt"), "new aggregate\n");
    git(repoPath, "commit", "-q", "-am", "advance aggregate");
    git(repoPath, "push", "-q", "fork", "HEAD:refs/heads/local/aggregate");
    git(repoPath, "switch", "-q", "--detach", candidateCommit);
    assert.throws(
      () => verifyPackageSource({ repoPath, aggregateRef: releaseRef, candidateRef }),
      /published aggregate mismatch/u,
    );
  });
});

test("rejects a candidate tag as aggregate evidence", () => {
  withRepository((repoPath) => {
    assert.throws(
      () => verifyPackageSource({ repoPath, aggregateRef: candidateRef, candidateRef }),
      /immutable fork-release tag/u,
    );
  });
});

test("rejects tracked changes after source verification", () => {
  withRepository((repoPath) => {
    writeFileSync(join(repoPath, "source.txt"), "changed\n");
    assert.throws(
      () => verifyPackageSource({
        repoPath,
        aggregateRef: "refs/heads/local/aggregate",
        candidateRef,
      }),
      /not clean/u,
    );
  });
});

test("rejects untracked files that could enter the package", () => {
  withRepository((repoPath) => {
    writeFileSync(join(repoPath, "untracked.ts"), "export const changed = true;\n");
    assert.throws(
      () => verifyPackageSource({
        repoPath,
        aggregateRef: "refs/heads/local/aggregate",
        candidateRef,
      }),
      /not clean/u,
    );
  });
});
