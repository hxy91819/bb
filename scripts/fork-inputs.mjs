import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function git(root, ...args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export function latestStable(tags) {
  const versions = tags
    .split("\n")
    .filter((tag) => /^desktop-v\d+\.\d+\.\d+$/.test(tag));
  versions.sort((a, b) => {
    const left = a.slice(9).split(".").map(Number);
    const right = b.slice(9).split(".").map(Number);
    for (let i = 0; i < 3; i++)
      if (left[i] !== right[i]) return right[i] - left[i];
    return 0;
  });
  if (!versions.length) throw new Error("没有上游稳定 desktop tag");
  return versions[0];
}

function refExists(root, ref) {
  return (
    spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: root })
      .status === 0
  );
}

export function resolveBaseRef(root, base) {
  for (const ref of [
    `refs/heads/fork-base/${base}`,
    `refs/remotes/fork/fork-base/${base}`,
    `refs/tags/${base}`,
  ])
    if (refExists(root, ref)) return ref;
  throw new Error(`找不到基线 ${base} 或 fork-base/${base}`);
}

export function readInputs(root, baseOverride) {
  const exists = (ref) => refExists(root, ref);
  const listRef = exists("refs/heads/fork-tooling")
    ? "refs/heads/fork-tooling"
    : "refs/remotes/fork/fork-tooling";
  const rows = git(root, "show", `${listRef}:.fork/branches`)
    .split("\n")
    .map((line) => line.split("#")[0].trim().split(/\s+/))
    .filter(([name]) => name);
  const base = baseOverride ?? rows.find(([name]) => name === "base")?.[1];
  if (!/^desktop-v\d+\.\d+\.\d+$/.test(base ?? ""))
    throw new Error("无效的稳定基线 tag");
  const baseRef = resolveBaseRef(root, base);
  const baseSha = git(root, "rev-parse", `${baseRef}^{commit}`);
  const branches = rows
    .filter(([name]) => name !== "base")
    .map(([name, status]) => {
      const local = `refs/heads/${name}`;
      const remote = `refs/remotes/fork/${name}`;
      const ref = exists(local) ? local : remote;
      return {
        name,
        status,
        sha: git(root, "rev-parse", "--verify", `${ref}^{commit}`),
      };
    });
  if (new Set(branches.map(({ name }) => name)).size !== branches.length)
    throw new Error("清单含重复分支");
  return { base, baseRef, baseSha, branches };
}

export function preflight(root, inputs) {
  const conflicts = [];
  const included = [];
  const tips = new Map();
  for (const branch of inputs.branches) {
    const previous = tips.get(branch.sha);
    if (previous)
      console.log(`相同 tip：${branch.name} = ${previous}（核对历史后再收敛）`);
    else tips.set(branch.sha, branch.name);
    const ancestor = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", branch.sha, inputs.baseSha],
      { cwd: root },
    );
    if (ancestor.status === 0) {
      included.push(branch.name);
      console.log(`基线内 tip：${branch.name}（不代表原功能已被吸收）`);
      continue;
    }
    if (ancestor.status !== 1)
      throw new Error(`无法比较 ${branch.name} 与基线`);
    const merge = spawnSync(
      "git",
      ["merge-tree", "--write-tree", inputs.baseSha, branch.sha],
      { cwd: root, encoding: "utf8" },
    );
    if (merge.status === 1)
      conflicts.push({ name: branch.name, detail: merge.stdout.trim() });
    else if (merge.status !== 0)
      throw new Error(merge.stderr.trim() || `无法预检 ${branch.name}`);
  }
  console.log(
    `预检：${inputs.base}，${inputs.branches.length} 条输入，${included.length} 条 tip 已在基线内，${conflicts.length} 条与上游冲突`,
  );
  for (const conflict of conflicts)
    console.log(`\nCONFLICT ${conflict.name}\n${conflict.detail}`);
  return conflicts;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [command, root = process.cwd(), base] = process.argv.slice(2);
    if (command === "latest") {
      const refs = git(
        root,
        "ls-remote",
        "--tags",
        "origin",
        "refs/tags/desktop-v*",
      );
      console.log(
        latestStable(
          refs
            .split("\n")
            .map(
              (line) => line.split("\t")[1]?.replace(/^refs\/tags\//, "") ?? "",
            )
            .join("\n"),
        ),
      );
    } else if (command === "preflight") {
      if (preflight(root, readInputs(root, base)).length) process.exitCode = 1;
    } else
      throw new Error("Usage: fork-inputs.mjs latest|preflight [repo] [base]");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
