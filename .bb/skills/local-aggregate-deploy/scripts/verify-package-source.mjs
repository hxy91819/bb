import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

function git(repoPath, ...args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
}

export function verifyPackageSource({ repoPath }) {
  const root = git(repoPath, "rev-parse", "--show-toplevel");
  if (realpathSync(root) !== realpathSync(repoPath)) {
    throw new Error("--repo must name the checkout root");
  }
  if (git(repoPath, "status", "--porcelain", "--untracked-files=all")) {
    throw new Error("package source is not clean");
  }
  const sourceCommit = git(repoPath, "rev-parse", "HEAD");
  const publishedAggregate = git(
    repoPath,
    "ls-remote",
    "--exit-code",
    "fork",
    "refs/heads/local/aggregate",
  ).split("\t")[0];
  if (sourceCommit !== publishedAggregate) {
    throw new Error(
      `published aggregate mismatch: HEAD=${sourceCommit} fork/local/aggregate=${publishedAggregate}`,
    );
  }
  return { sourceCommit };
}
