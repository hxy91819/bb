import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { posix } from "node:path";
import { documentPath, type Registration } from "./contract";

const exec = promisify(execFile);
export type GitSource = Extract<Registration["source"], { kind: "git" }>;
export async function git(
  source: GitSource,
  args: string[],
  signal: AbortSignal,
) {
  const { stdout } = await exec("git", ["-C", source.repo, ...args], {
    signal,
    timeout: 15000,
    maxBuffer: 6 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}
export async function pin(source: GitSource, signal: AbortSignal) {
  try {
    const slash = source.ref.indexOf("/");
    const remote = source.ref.slice(0, slash);
    const branch = `refs/heads/${source.ref.slice(slash + 1)}`;
    await git(source, ["check-ref-format", branch], signal);
    const advertised = await git(
      source,
      ["ls-remote", "--exit-code", "--refs", remote, branch],
      signal,
    );
    const sha = advertised.trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("invalid SHA");
    await git(
      source,
      ["fetch", "--no-tags", "--no-write-fetch-head", remote, sha],
      signal,
    );
    return { repo: source.repo, ref: source.ref, sha };
  } catch {
    throw new Error(
      "无法核实 Git 远端（离线、ref 已删除或超时）；未使用旧 ref 或磁盘副本。",
    );
  }
}
export function resolveLink(from: string, target: string) {
  target = target.trim().replace(/^<|>$/g, "");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith("//"))
    throw new Error("只支持仓库内相对文档链接。");
  const path = decodeURIComponent(
    target.replace(/^<|>$/g, "").split(/[?#]/)[0],
  );
  if (path.startsWith("/") || path.includes("\\"))
    throw new Error("链接必须位于仓库内。");
  return documentPath.parse(
    posix
      .normalize(
        path
          ? posix.join(from.endsWith("/") ? from : posix.dirname(from), path)
          : from,
      )
      .replace(/\/$/, ""),
  );
}
export function ledgerEntry(text: string) {
  const header = text.split(/^## /m)[0];
  for (const match of header.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    if (
      /要求[帳帐]/.test(match[1]) ||
      /-要求[帳帐]\.md(?:[#?]|$)/.test(match[2])
    )
      return {
        target: match[2],
        kind: match[1] === "要求帐（历史流水账）" ? "history" : "standard",
      };
  }
  throw new Error("工作簿标头缺少要求帐入口；check 通过不代表入口齐全。");
}
