import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repositoryRoot, "config/local-aggregate-features.json");
const outputJson = process.argv.includes("--json");

function run(command, args) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, {
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

function git(args) {
  return run("git", args);
}

function gh(args) {
  return run("gh", args);
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

function inspectUnpackagedBranch(branch, upstreamRef) {
  const currentCommit = revision(branch);
  if (!currentCommit) {
    return { state: "missing-ref", currentCommit: null, commits: [] };
  }
  const base = git(["merge-base", upstreamRef, branch]);
  return {
    state: "unpackaged",
    currentCommit,
    commits: base.ok ? commitsBetween(base.output, branch) : [],
  };
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

function aggregateMappingValid(lastPackaged) {
  if (!lastPackaged) {
    return null;
  }
  if (!commitExists(lastPackaged.aggregateCommit)) {
    return false;
  }
  const body = git(["show", "-s", "--format=%B", lastPackaged.aggregateCommit]);
  return body.ok && body.output.includes(lastPackaged.sourceCommit);
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

function summarize(value) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
}

function relatedPullRequestReferences(issue, comments) {
  const references = new Map();
  const pattern = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/gu;
  for (const text of [issue.body ?? "", ...comments.map((comment) => comment.body ?? "")]) {
    for (const match of text.matchAll(pattern)) {
      references.set(`${match[1]}#${match[2]}`, {
        repository: match[1],
        number: Number(match[2]),
      });
    }
  }
  return [...references.values()];
}

function inspectPullRequest(reference) {
  const result = gh([
    "pr",
    "view",
    String(reference.number),
    "--repo",
    reference.repository,
    "--json",
    "number,title,state,mergedAt,closedAt,updatedAt,url",
  ]);
  if (!result.ok) {
    return { ...reference, state: "unavailable" };
  }
  try {
    const pullRequest = JSON.parse(result.output);
    return {
      repository: reference.repository,
      number: pullRequest.number,
      title: pullRequest.title,
      state: pullRequest.state,
      mergedAt: pullRequest.mergedAt,
      closedAt: pullRequest.closedAt,
      updatedAt: pullRequest.updatedAt,
      url: pullRequest.url,
    };
  } catch {
    return { ...reference, state: "unavailable" };
  }
}

function inspectUpstreamIssue(reference) {
  const result = gh([
    "issue",
    "view",
    String(reference.number),
    "--repo",
    reference.repository,
    "--json",
    "number,title,state,stateReason,closedAt,updatedAt,url,body,comments",
  ]);
  if (!result.ok) {
    return {
      ...reference,
      state: "unavailable",
      newerReplies: [],
      relatedPullRequests: [],
    };
  }
  try {
    const issue = JSON.parse(result.output);
    const comments = issue.comments ?? [];
    const hasCommentAnchor = reference.feedbackUrl.includes("#issuecomment-");
    const feedbackIndex = comments.findIndex((comment) => comment.url === reference.feedbackUrl);
    const replies = hasCommentAnchor && feedbackIndex >= 0 ? comments.slice(feedbackIndex + 1) : comments;
    const relatedPullRequests = relatedPullRequestReferences(issue, comments).map(inspectPullRequest);
    return {
      repository: reference.repository,
      number: issue.number,
      feedbackUrl: reference.feedbackUrl,
      title: issue.title,
      state: issue.state,
      stateReason: issue.stateReason,
      closedAt: issue.closedAt,
      updatedAt: issue.updatedAt,
      url: issue.url,
      feedbackFound: !hasCommentAnchor || feedbackIndex >= 0,
      newerReplies: replies.map((reply) => ({
        author: reply.author?.login ?? "unknown",
        createdAt: reply.createdAt,
        url: reply.url,
        summary: summarize(reply.body ?? ""),
      })),
      relatedPullRequests,
    };
  } catch {
    return {
      ...reference,
      state: "unavailable",
      newerReplies: [],
      relatedPullRequests: [],
    };
  }
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function assertManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("local aggregate manifest must be an object");
  }
  if (value.version !== 2) {
    throw new Error("local aggregate manifest version must be 2");
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
    const lastPackagedValid =
      feature?.lastPackaged === null ||
      (feature?.lastPackaged &&
        typeof feature.lastPackaged === "object" &&
        nonEmptyString(feature.lastPackaged.sourceCommit) &&
        nonEmptyString(feature.lastPackaged.aggregateCommit));
    const upstreamIssuesValid =
      Array.isArray(feature?.upstreamIssues) &&
      feature.upstreamIssues.length > 0 &&
      feature.upstreamIssues.every(
        (issue) =>
          issue &&
          typeof issue === "object" &&
          nonEmptyString(issue.repository) &&
          Number.isInteger(issue.number) &&
          issue.number > 0 &&
          nonEmptyString(issue.feedbackUrl),
      );
    if (
      !feature ||
      typeof feature !== "object" ||
      !nonEmptyString(feature.branch) ||
      !lastPackagedValid ||
      !upstreamIssuesValid ||
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
  source: feature.lastPackaged
    ? inspectRevision(feature.lastPackaged.sourceCommit, feature.branch)
    : inspectUnpackagedBranch(feature.branch, manifest.aggregate.upstreamRef),
  aggregateCommitPresent: feature.lastPackaged ? commitExists(feature.lastPackaged.aggregateCommit) : null,
  aggregateMappingValid: aggregateMappingValid(feature.lastPackaged),
  upstreamIssues: feature.upstreamIssues.map(inspectUpstreamIssue),
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
  unpackaged: "尚未打包，默认纳入",
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
const issueStateLabel = {
  OPEN: "开放",
  CLOSED: "已关闭，需分析关闭原因",
  unavailable: "无法读取",
};
const pullRequestStateLabel = {
  OPEN: "开放候选",
  CLOSED: "已关闭候选",
  MERGED: "已合并候选",
  unavailable: "无法读取",
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
  const sourceCommit = feature.lastPackaged?.sourceCommit;
  const aggregateCommit = feature.lastPackaged?.aggregateCommit;
  const aggregateStatus = feature.lastPackaged
    ? `\`${short(aggregateCommit)}\`${feature.aggregateCommitPresent && feature.aggregateMappingValid ? "" : "（映射无效）"}`
    : "尚未打包";
  console.log(`- \`${feature.branch}\`：${sourceStateLabel[feature.source.state]}；源 \`${short(sourceCommit)}\` → \`${short(feature.source.currentCommit)}\`；聚合 ${aggregateStatus}`);
  console.log(`  - worktree：${feature.worktree ? `\`${feature.worktree}\`` : "未找到"}`);
  for (const commit of feature.source.commits) {
    console.log(`  - \`${short(commit.commit)}\` ${commit.subject}`);
  }
  for (const issue of feature.upstreamIssues) {
    const feedbackStatus = issue.feedbackFound === false ? "未找到记录的反馈评论" : `${issue.newerReplies.length} 条后续回复`;
    console.log(`  - 上游 \`${issue.repository}#${issue.number}\`：${issueStateLabel[issue.state] ?? issue.state}；${feedbackStatus}；${issue.title ?? ""}`);
    for (const reply of issue.newerReplies) {
      console.log(`    - ${reply.createdAt} @${reply.author}：${reply.summary}`);
    }
    for (const pullRequest of issue.relatedPullRequests) {
      console.log(`    - 关联 PR \`${pullRequest.repository}#${pullRequest.number}\`：${pullRequestStateLabel[pullRequest.state] ?? pullRequest.state}；${pullRequest.title ?? ""}`);
    }
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
