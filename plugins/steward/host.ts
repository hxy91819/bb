import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, relative, resolve } from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  checkResultSchema,
  hostContract,
  type Registration,
  type DocumentResult,
} from "./contract";
import { git, pin, resolveLink, ledgerEntry } from "./git";

const exec = promisify(execFile);
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "无法读取文档。";
async function documents(
  registration: Pick<
    Registration,
    "source" | "workbook" | "ledger" | "ledgerKind"
  >,
  signal: AbortSignal,
  sha?: string,
) {
  const { source, workbook, ledger } = registration;
  const snapshot =
    source.kind === "git"
      ? sha
        ? { repo: source.repo, ref: source.ref, sha }
        : await pin(source, signal)
      : undefined;
  const read = (path: string) =>
    source.kind === "git" && snapshot
      ? git(source, ["show", `${snapshot.sha}:${path}`], signal)
      : readFile(path, "utf8");
  const text = await read(workbook);
  const entry = ledgerEntry(text);
  const actual =
    source.kind === "git"
      ? resolveLink(workbook, entry.target)
      : resolve(
          dirname(workbook),
          decodeURIComponent(
            entry.target.split(/[?#]/)[0].replace(/^<|>$/g, ""),
          ),
        );
  if (
    source.kind === "local" &&
    (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(entry.target) ||
      entry.target.startsWith("//"))
  )
    throw new Error("要求帐必须是本地文件链接。");
  const canonical = (path: string) => realpath(path).catch(() => resolve(path));
  const matches =
    source.kind === "git"
      ? actual === ledger
      : (await canonical(actual)) === (await canonical(ledger));
  if (!matches || entry.kind !== registration.ledgerKind)
    throw new Error("要求帐来源或格式已改变，请重新登记工作簿标头入口。");
  const ledgerText = await read(ledger);
  return { snapshot, text, ledgerText, read };
}
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async document(
      { registration, document, link, cursor, limit },
      { signal },
    ): Promise<DocumentResult> {
      try {
        const pageLimit = limit ?? 65536;
        if (registration.source.kind === "local") {
          if (cursor || limit !== undefined)
            throw new Error("分页仅适用于 Git 来源。");
          if (link) throw new Error("本地相对链接请使用文件预览打开。");
          const file = await stat(registration[document]);
          return {
            available: file.isFile(),
            message: file.isFile()
              ? ""
              : "此路径不是文件，请重新登记正确路径。",
          };
        }
        if (link && cursor) throw new Error("链接导航与分页游标不能同时提供。");
        const docs = await documents(
          registration,
          signal,
          cursor?.sha ?? link?.sha,
        );
        const path =
          cursor?.path ??
          (link ? resolveLink(link.from, link.target) : registration[document]);
        const sha = docs.snapshot!.sha;
        const object = `${sha}:${path === "." ? "" : path}`;
        const type = (
          await git(registration.source, ["cat-file", "-t", object], signal)
        ).trim();
        const offset = cursor?.offset ?? 0;
        const common = {
          available: true,
          message:
            registration.ledgerKind === "history"
              ? "要求帐为历史流水账；标准五列表统计不适用。"
              : "",
          path,
          snapshot: docs.snapshot,
          offset,
        };
        if (type === "tree") {
          const listing = await git(
            registration.source,
            ["ls-tree", "-z", object],
            signal,
          );
          const entries = listing
            .split("\0")
            .filter(Boolean)
            .map((line) => {
              const match =
                /^[0-7]+ (blob|tree|commit) [a-f0-9]+\t([\s\S]+)$/.exec(line);
              if (!match) throw new Error("Git 目录返回无效条目。");
              const name = match[2];
              return {
                name,
                path: path === "." ? name : `${path}/${name}`,
                kind:
                  match[1] === "tree"
                    ? ("directory" as const)
                    : match[1] === "blob"
                      ? ("file" as const)
                      : ("unsupported" as const),
              };
            });
          if (offset > entries.length) throw new Error("目录游标超出范围。");
          const page: NonNullable<DocumentResult["entries"]> = [];
          let bytes = 2;
          for (const entry of entries.slice(offset)) {
            const size = Buffer.byteLength(JSON.stringify(entry), "utf8") + 1;
            if (page.length && bytes + size > pageLimit) break;
            page.push(entry);
            bytes += size;
          }
          const end = offset + page.length;
          return {
            ...common,
            kind: "directory",
            entries: page,
            total: entries.length,
            next: end < entries.length ? { path, sha, offset: end } : null,
          };
        }
        if (type !== "blob") throw new Error("此 Git 对象不是可读文件或目录。");
        const content =
          path === registration.workbook
            ? docs.text
            : path === registration.ledger
              ? docs.ledgerText
              : await docs.read(path);
        const bytes = Buffer.from(content, "utf8");
        if (
          offset > bytes.length ||
          (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80)
        )
          throw new Error("文件游标必须是有效 UTF-8 字节边界。");
        let end = Math.min(offset + pageLimit, bytes.length);
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
        return {
          ...common,
          kind: "file",
          content: bytes.subarray(offset, end).toString("utf8"),
          total: bytes.length,
          next: end < bytes.length ? { path, sha, offset: end } : null,
        };
      } catch (cause) {
        return { available: false, message: `无法读取文档：${message(cause)}` };
      }
    },
    async identity({ workbook, source }, { signal }) {
      if (source.kind === "git") {
        const common = await git(
          source,
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          signal,
        );
        return {
          repoRoot: dirname(await realpath(common.trim())),
          workbookRelativePath: workbook,
        };
      }
      const file = await realpath(workbook).catch(() => resolve(workbook));
      try {
        const options = { cwd: dirname(file), signal, timeout: 10000 };
        const { stdout: top } = await exec(
          "git",
          ["rev-parse", "--show-toplevel"],
          options,
        );
        const { stdout: common } = await exec(
          "git",
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          options,
        );
        return {
          repoRoot: dirname(common.trim()),
          workbookRelativePath: relative(top.trim(), file),
        };
      } catch {
        return {
          repoRoot: dirname(file),
          workbookRelativePath: relative(dirname(file), file),
        };
      }
    },
    async check(registration, { signal }) {
      const failed = (error: string) => ({
        ok: false,
        applicable: true,
        errors: [error],
      });
      try {
        const docs = await documents(registration, signal);
        const run = async (mode: string, file: string) => {
          try {
            const args = [registration.checker, "--mode", mode, "--file", file];
            if (docs.snapshot)
              args.push(
                "--repo",
                docs.snapshot.repo,
                "--revision",
                docs.snapshot.sha,
              );
            let stdout: string;
            try {
              ({ stdout } = await exec("python3", args, {
                signal,
                timeout: 20000,
                maxBuffer: 128 * 1024,
              }));
            } catch (cause) {
              if (
                !(cause instanceof Error) ||
                !("code" in cause) ||
                cause.code !== 2 ||
                !("stdout" in cause) ||
                typeof cause.stdout !== "string"
              )
                throw cause;
              stdout = cause.stdout;
            }
            return checkResultSchema.parse(JSON.parse(stdout));
          } catch {
            return failed(
              "无法检查文件，请确认文件和管家技能脚本仍在这台主机上且支持此来源。",
            );
          }
        };
        return {
          checkedAt: new Date().toISOString(),
          snapshot: docs.snapshot,
          workbook: await run("check", registration.workbook),
          ledger:
            registration.ledgerKind === "history"
              ? {
                  ok: false,
                  applicable: false,
                  errors: ["历史流水账可打开；标准五列表统计不适用。"],
                }
              : await run("ledger-check", registration.ledger),
        };
      } catch (cause) {
        return {
          checkedAt: new Date().toISOString(),
          workbook: failed(message(cause)),
          ledger: failed(message(cause)),
        };
      }
    },
  },
});
