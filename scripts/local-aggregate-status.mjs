import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repositoryRoot, "config/local-aggregate-features.json");
const outputJson = process.argv.includes("--json");

function git(args) {
  try {
    return {
      ok: true,
      output: execFileSync("git", args, {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: error.stdout?.toString().trim() ?? "",
      error: error.stderr?.toString().trim() ?? error.message,
    };
  }
}

function commitExists(commit) {
  return git(["cat-file", "-e", `${commit}^{commit}`]).ok;
}

function isAncestor(older, newer) {
  return git(["merge-base", "--is-ancestor", older, newer]).ok;
}

function revision(ref) {
  const result = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  return result.ok ? result.output : null;
}

function commitsBetween(start, end) {
  const result = git(["log", "--format=%H%x09%s", `${start}..${end}`]);
  if (!result.ok || !result.output) {
    return [];
  }
  return result.output.split("\n").map((line) => {
    const [commit, subject] = line.split("\t", 2);
    return { commit, subject };
  });
}

function inspectRevision(recordedCommit, currentRef) {
  const currentCommit = revision(currentRef);
  if (!currentCommit) {
    return { state: "missing-ref", currentCommit: null, commits: [] };
  }
  if (!commitExists(recordedCommit)) {
    return { state: "recorded-commit-missing", currentCommit, commits: [] };
  }
  if (recordedCommit === currentCommit) {
    return { state: "packaged", currentCommit, commits: [] };
  }
  if (isAncestor(recordedCommit, currentCommit)) {
    return {
      state: "advanced",
      currentCommit,
      commits: commitsBetween(recordedCommit, currentCommit),
    };
  }
  if (isAncestor(currentCommit, recordedCommit)) {
    return { state: "behind-recorded", currentCommit, commits: [] };
  }
  return { state: "rewritten", currentCommit, commits: [] };
}

function worktreesByBranch() {
  const result = git(["worktree", "list", "--porcelain"]);
  if (!result.ok) {
    return new Map();
  }
  const worktrees = new Map();
  for (const record of result.output.split("\n\n")) {
    const lines = record.split("\n");
    const worktree = lines.find((line) => line.startsWith("worktree "));
    const branch = lines.find((line) => line.startsWith("branch refs/heads/"));
    if (worktree && branch) {
      worktrees.set(branch.slice("branch refs/heads/".length), worktree.slice("worktree ".length));
    }
  }
  return worktrees;
}

function localFeatureBranches() {
  const result = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (!result.ok || !result.output) {
    return [];
  }
  return result.output
    .split("\n")
    .filter((branch) => branch.startsWith("feature/") || branch.startsWith("fix/"))
    .sort();
}

function statusEntries() {
  const result = git(["status", "--porcelain=v1", "--untracked-files=normal"]);
  if (!result.ok || !result.output) {
    return { tracked: [], untracked: [] };
  }
  const tracked = [];
  const untracked = [];
  for (const line of result.output.split("\n")) {
    if (line.startsWith("?? ")) {
      untracked.push(line.slice(3));
    } else {
      tracked.push(line);
    }
  }
  return { tracked, untracked };
}

function short(commit) {
  return commit?.slice(0, 9) ?? "—";
}

function describeCommit(commit) {
  const result = git(["show", "-s", "--format=%s", commit]);
  return result.ok ? result.output : "无法读取提交说明";
}

function aggregateMappingValid(feature) {
  if (!commitExists(feature.lastPackagedAggregateCommit)) {
    return false;
  }
  const body = git(["show", "-s", "--format=%B", feature.lastPackagedAggregateCommit]);
  return body.ok && body.output.includes(feature.lastPackagedSourceCommit);
}

function latestStableRelease(aggregate) {
  const tags = git(["tag", "--merged", aggregate.upstreamRef, "--sort=-version:refname"]);
  if (!tags.ok || !tags.output) {
    return null;
  }
  const pattern = new RegExp(aggregate.stableTagPattern);
  const tag = tags.output.split("\n").find((candidate) => pattern.test(candidate));
  if (!tag) {
    return null;
  }
  const commit = revision(tag);
  if (!commit) {
    return null;
  }
  if (isAncestor(commit, aggregate.lastIntegratedUpstreamCommit)) {
    return { tag, commit, state: "included-in-baseline", commits: [] };
  }
  if (isAncestor(aggregate.lastIntegratedUpstreamCommit, commit)) {
    return {
      tag,
      commit,
      state: "released-after-baseline",
      commits: commitsBetween(aggregate.lastIntegratedUpstreamCommit, tag),
    };
  }
  return { tag, commit, state: "diverged", commits: [] };
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function assertManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("local aggregate manifest must be an object");
  }
  if (value.version !== 1) {
    throw new Error("local aggregate manifest version must be 1");
  }
  if (
    !value.aggregate ||
    typeof value.aggregate !== "object" ||
    !nonEmptyString(value.aggregate.branch) ||
    !nonEmptyString(value.aggregate.upstreamRef) ||
    !nonEmptyString(value.aggregate.stableTagPattern) ||
    !nonEmptyString(value.aggregate.lastIntegratedUpstreamCommit)
  ) {
    throw new Error("local aggregate manifest aggregate is invalid");
  }
  if (!Array.isArray(value.features)) {
    throw new Error("local aggregate manifest features must be an array");
  }
  const branches = new Set();
  for (const feature of value.features) {
    if (
      !feature ||
      typeof feature !== "object" ||
      !nonEmptyString(feature.branch) ||
      !nonEmptyString(feature.lastPackagedSourceCommit) ||
      !nonEmptyString(feature.lastPackagedAggregateCommit) ||
      branches.has(feature.branch)
    ) {
      throw new Error("local aggregate manifest feature is invalid");
    }
    branches.add(feature.branch);
  }
}

assertManifest(manifest);
const currentBranch = git(["branch", "--show-current"]).output;
const worktrees = worktreesByBranch();
const registeredBranches = new Set(manifest.features.map((feature) => feature.branch));
const featureStatuses = manifest.features.map((feature) => ({
  ...feature,
  worktree: worktrees.get(feature.branch) ?? null,
  source: inspectRevision(feature.lastPackagedSourceCommit, feature.branch),
  aggregateCommitPresent: commitExists(feature.lastPackagedAggregateCommit),
  aggregateMappingValid: aggregateMappingValid(feature),
}));
const upstream = inspectRevision(
  manifest.aggregate.lastIntegratedUpstreamCommit,
  manifest.aggregate.upstreamRef,
);
const stableRelease = latestStableRelease(manifest.aggregate);
const status = statusEntries();
const discoveredBranches = localFeatureBranches();
const unregisteredBranches = discoveredBranches.filter((branch) => !registeredBranches.has(branch));
const report = {
  manifestPath: "config/local-aggregate-features.json",
  aggregate: {
    expectedBranch: manifest.aggregate.branch,
    currentBranch,
    upstreamRef: manifest.aggregate.upstreamRef,
    lastIntegratedUpstreamCommit: manifest.aggregate.lastIntegratedUpstreamCommit,
    upstream,
    stableRelease,
  },
  workingTree: status,
  features: featureStatuses,
  unregisteredBranches: unregisteredBranches.map((branch) => ({
    branch,
    worktree: worktrees.get(branch) ?? null,
    head: revision(branch),
    subject: describeCommit(branch),
  })),
};

if (outputJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const sourceStateLabel = {
  packaged: "与上次打包一致",
  advanced: "有待打包提交",
  rewritten: "历史已重写，须重建聚合",
  "behind-recorded": "落后于已打包提交",
  "missing-ref": "分支不存在",
  "recorded-commit-missing": "记录的源提交不存在",
};
const upstreamStateLabel = {
  packaged: "聚合基线已同步",
  advanced: "上游有待评估提交",
  rewritten: "上游历史与记录分叉",
  "behind-recorded": "记录的上游基线领先于当前上游",
  "missing-ref": "无法读取上游引用",
  "recorded-commit-missing": "记录的上游基线不存在",
};
const stableReleaseStateLabel = {
  "included-in-baseline": "已包含在上次聚合基线中",
  "released-after-baseline": "有稳定版待评估提交",
  diverged: "与上次聚合基线分叉",
};

console.log("# 本地聚合状态");
console.log("");
console.log(`- 当前分支：\`${currentBranch || "detached HEAD"}\`（期望：\`${manifest.aggregate.branch}\`）`);
console.log(`- 上游：\`${manifest.aggregate.upstreamRef}\``);
if (stableRelease) {
  console.log(`- 最新稳定版：\`${stableRelease.tag}\`（\`${short(stableRelease.commit)}\`）— ${stableReleaseStateLabel[stableRelease.state]}`);
  for (const commit of stableRelease.commits) {
    console.log(`  - \`${short(commit.commit)}\` ${commit.subject}`);
  }
} else {
  console.log("- 最新稳定版：未找到符合登记表 stableTagPattern 的可达标签");
}
console.log(`- 上游基线：\`${short(manifest.aggregate.lastIntegratedUpstreamCommit)}\` — ${upstreamStateLabel[upstream.state]}`);
if (upstream.commits.length > 0) {
  for (const commit of upstream.commits) {
    console.log(`  - \`${short(commit.commit)}\` ${commit.subject}`);
  }
}
console.log(`- 工作区：${status.tracked.length === 0 ? "无已跟踪修改" : `${status.tracked.length} 个已跟踪修改`}；${status.untracked.length === 0 ? "无未跟踪项目" : `${status.untracked.length} 个未跟踪项目`}`);
if (status.tracked.length > 0) {
  for (const entry of status.tracked) {
    console.log(`  - \`${entry}\``);
  }
}
console.log("");
console.log("## 已登记特性");
console.log("");
for (const feature of featureStatuses) {
  console.log(`- \`${feature.branch}\`：${sourceStateLabel[feature.source.state]}；源 \`${short(feature.lastPackagedSourceCommit)}\` → \`${short(feature.source.currentCommit)}\`；聚合 \`${short(feature.lastPackagedAggregateCommit)}\`${feature.aggregateCommitPresent && feature.aggregateMappingValid ? "" : "（映射无效）"}`);
  console.log(`  - worktree：${feature.worktree ? `\`${feature.worktree}\`` : "未找到"}`);
  for (const commit of feature.source.commits) {
    console.log(`  - \`${short(commit.commit)}\` ${commit.subject}`);
  }
}
console.log("");
console.log("## 待登记并默认纳入的 feature/fix 分支");
console.log("");
if (report.unregisteredBranches.length === 0) {
  console.log("无。");
} else {
  for (const branch of report.unregisteredBranches) {
    console.log(`- \`${branch.branch}\`：\`${short(branch.head)}\` ${branch.subject}${branch.worktree ? `；worktree \`${branch.worktree}\`` : "；未找到 worktree"}`);
  }
}
