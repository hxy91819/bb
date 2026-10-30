import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
    `refs/remotes/origin/fork-base/${base}`,
    `refs/tags/${base}`,
  ])
    if (refExists(root, ref)) return ref;
  throw new Error(`找不到基线 ${base} 或 fork-base/${base}`);
}

function captureRefs(root) {
  return new Map(
    git(
      root,
      "for-each-ref",
      "--format=%(refname) %(objectname)",
      "refs/heads",
      "refs/remotes/origin",
      "refs/tags",
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(" ")),
  );
}

export function readInputs(root, baseOverride, refs = captureRefs(root)) {
  const listSha =
    refs.get("refs/heads/fork-tooling") ??
    refs.get("refs/remotes/origin/fork-tooling");
  if (!listSha) throw new Error("找不到 fork-tooling");
  const rows = git(root, "show", `${listSha}:.fork/branches`)
    .split("\n")
    .map((line) => line.split("#")[0].trim().split(/\s+/))
    .filter(([name]) => name);
  const base = baseOverride ?? rows.find(([name]) => name === "base")?.[1];
  if (!/^desktop-v\d+\.\d+\.\d+$/.test(base ?? ""))
    throw new Error("无效的稳定基线 tag");
  const baseRef = [
    `refs/heads/fork-base/${base}`,
    `refs/remotes/origin/fork-base/${base}`,
    `refs/tags/${base}`,
  ].find((ref) => refs.has(ref));
  if (!baseRef) throw new Error(`找不到基线 ${base}`);
  const baseSha = git(root, "rev-parse", `${refs.get(baseRef)}^{commit}`);
  const branches = rows
    .filter(([name]) => name !== "base")
    .map(([name, status]) => {
      const local = refs.get(`refs/heads/${name}`);
      const remote = refs.get(`refs/remotes/origin/${name}`);
      if (local && remote && local !== remote)
        console.error(
          `警告：${name} 本地与 origin 不一致，使用本地（记得推送）`,
        );
      if (!local && !remote)
        throw new Error(`找不到分支 ${name}（本地或 origin）`);
      return {
        name,
        status,
        sha: git(root, "rev-parse", `${local ?? remote}^{commit}`),
      };
    });
  if (new Set(branches.map(({ name }) => name)).size !== branches.length)
    throw new Error("清单含重复分支");
  return { base, baseRef, baseSha, branches };
}

export function snapshot(root, baseOverride) {
  const refs = captureRefs(root);
  const inputs = readInputs(root, baseOverride, refs);
  const sha = (ref) =>
    refs.has(ref) ? git(root, "rev-parse", `${refs.get(ref)}^{commit}`) : "";
  const local = sha("refs/heads/security/baseline");
  const remote = sha("refs/remotes/origin/security/baseline");
  let security = local || remote;
  if (local && remote && local !== remote) {
    const ancestor = (a, b) =>
      spawnSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: root })
        .status === 0;
    if (ancestor(local, remote)) security = remote;
    else if (!ancestor(remote, local))
      throw new Error("security/baseline 与 origin 分叉");
  }
  const tooling =
    sha("refs/heads/fork-tooling") || sha("refs/remotes/origin/fork-tooling");
  return {
    ...inputs,
    id: randomUUID(),
    created: new Date().toISOString(),
    root,
    tagObject: refs.get(`refs/tags/${inputs.base}`),
    tagSha: sha(`refs/tags/${inputs.base}`),
    security,
    tooling,
    manifest: git(root, "rev-parse", `${tooling}:.fork/branches`),
    baseLocal: sha(`refs/heads/fork-base/${inputs.base}`),
    baseRemote: sha(`refs/remotes/origin/fork-base/${inputs.base}`),
    mainRemote: sha("refs/remotes/origin/main"),
    mainLocal: sha("refs/heads/main"),
    previous: sha("refs/remotes/origin/aggregate"),
  };
}

function writeSnapshot(path, inputs) {
  writeFileSync(path, `${JSON.stringify(inputs, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function loadSnapshot(path) {
  const inputs = JSON.parse(readFileSync(path, "utf8"));
  const isSha = (value) =>
    typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
  if (
    inputs.root !== process.cwd() ||
    !/^desktop-v\d+\.\d+\.\d+$/.test(inputs.base) ||
    !["baseSha", "tagObject", "tagSha", "tooling", "manifest"].every((key) =>
      isSha(inputs[key]),
    ) ||
    ![
      "security",
      "baseLocal",
      "baseRemote",
      "mainLocal",
      "mainRemote",
      "previous",
    ].every((key) => inputs[key] === "" || isSha(inputs[key])) ||
    !Array.isArray(inputs.branches) ||
    !inputs.branches.every(
      (branch) => typeof branch.name === "string" && isSha(branch.sha),
    )
  )
    throw new Error("无效或不属于当前仓库的 fork 输入快照");
  return inputs;
}

function shellSnapshot(inputs) {
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const values = {
    base: inputs.base,
    base_ref: inputs.baseSha,
    snapshot_base_ref: inputs.baseRef,
    security_ref: inputs.security,
    tag_ref: inputs.tagSha,
    previous_aggregate: inputs.previous,
    main_before: inputs.mainRemote,
    snapshot_main_local: inputs.mainLocal,
    snapshot_base_local: inputs.baseLocal,
    snapshot_base_remote: inputs.baseRemote,
  };
  for (const [key, value] of Object.entries(values))
    console.log(`${key}=${quote(value)}`);
  console.log(
    `branches=(${inputs.branches.map(({ name }) => quote(name)).join(" ")})`,
  );
  console.log(
    `refs=(${inputs.branches.map(({ sha }) => quote(sha)).join(" ")})`,
  );
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
    if (command === "snapshot") {
      writeSnapshot(process.argv[5], snapshot(root, base || undefined));
    } else if (command === "shell") {
      shellSnapshot(loadSnapshot(root));
    } else if (command === "set-base") {
      const inputs = loadSnapshot(root);
      if (!/^[a-f0-9]{40}$/.test(base ?? "")) throw new Error("无效的基线 SHA");
      git(inputs.root, "merge-base", "--is-ancestor", inputs.tagSha, base);
      git(inputs.root, "merge-base", "--is-ancestor", inputs.security, base);
      inputs.baseSha = base;
      inputs.baseRef = `refs/heads/fork-base/${inputs.base}`;
      writeSnapshot(root, inputs);
    } else if (command === "latest") {
      const refs = git(
        root,
        "ls-remote",
        "--tags",
        "upstream",
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
      if (
        preflight(
          root,
          process.env.BB_FORK_INPUT_SNAPSHOT
            ? loadSnapshot(process.env.BB_FORK_INPUT_SNAPSHOT)
            : readInputs(root, base),
        ).length
      )
        process.exitCode = 1;
    } else
      throw new Error(
        "Usage: fork-inputs.mjs latest|preflight|snapshot|shell|set-base ...",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
