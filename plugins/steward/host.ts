import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, relative, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { checkResultSchema, hostContract } from "./contract";

const exec = promisify(execFile);
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async document({ path }) {
      try {
        const file = await stat(path);
        return {
          available: file.isFile(),
          message: file.isFile() ? "" : "此路径不是文件，请重新登记正确路径。",
        };
      } catch {
        return {
          available: false,
          message: "找不到文件或没有读取权限，请确认文件位置后重新登记。",
        };
      }
    },
    async identity({ workbook }, { signal }) {
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
    async check({ workbook, ledger, checker }, { signal }) {
      const run = async (mode: string, file: string) => {
        try {
          let stdout: string;
          try {
            ({ stdout } = await exec(
              "python3",
              [checker, "--mode", mode, "--file", file],
              { signal, timeout: 20000, maxBuffer: 128 * 1024 },
            ));
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
          return {
            ok: false,
            errors: ["无法检查文件，请确认文件和管家技能脚本仍在这台主机上。"],
          };
        }
      };
      const workbookResult = await run("check", workbook);
      const ledgerResult = await run("ledger-check", ledger);
      return {
        checkedAt: new Date().toISOString(),
        workbook: workbookResult,
        ledger: ledgerResult,
      };
    },
  },
});
