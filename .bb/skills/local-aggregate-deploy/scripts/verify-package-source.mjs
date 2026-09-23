import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

const CANDIDATE_REF = /^refs\/tags\/fork-candidate\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const RELEASE_REF = /^refs\/tags\/fork-release\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

function git(repoPath, ...args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
}

export function verifyPackageSource({ repoPath, aggregateRef, candidateRef }) {
  if (aggregateRef !== "refs/heads/local/aggregate" && !RELEASE_REF.test(aggregateRef)) {
    throw new Error("--aggregate-ref must name local/aggregate or an immutable fork-release tag");
  }
  if (!CANDIDATE_REF.test(candidateRef)) {
    throw new Error("--candidate-ref must name an immutable fork-candidate tag");
  }

  const root = git(repoPath, "rev-parse", "--show-toplevel");
  if (realpathSync(root) !== realpathSync(repoPath)) {
    throw new Error("--repo must name the checkout root");
  }
  if (git(repoPath, "status", "--porcelain", "--untracked-files=all")) {
    throw new Error("package source is not clean");
  }
  if (
    aggregateRef === "refs/heads/local/aggregate"
    && git(repoPath, "branch", "--show-current") !== "local/aggregate"
  ) {
    throw new Error("local package source must be checked out on local/aggregate");
  }

  const sourceCommit = git(repoPath, "rev-parse", "HEAD");
  const aggregateCommit = git(repoPath, "rev-parse", "--verify", `${aggregateRef}^{commit}`);
  const candidateCommit = git(repoPath, "rev-parse", "--verify", `${candidateRef}^{commit}`);
  if (sourceCommit !== aggregateCommit || sourceCommit !== candidateCommit) {
    throw new Error(
      `package source mismatch: HEAD=${sourceCommit} aggregate=${aggregateCommit} candidate=${candidateCommit}`,
    );
  }
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

  return { sourceCommit, aggregateRef, candidateRef, publishedAggregate };
}
