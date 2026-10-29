import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { acquireLock, lockInvocation } from "./fork-lock.mjs";

const [script, ...args] = process.argv.slice(2);
const common = spawnSync(
  "git",
  ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  { encoding: "utf8" },
);
if (common.status !== 0) throw new Error(common.stderr);
const lock = acquireLock(
  join(common.stdout.trim(), "fork-execution.lock"),
  true,
);
if (!lock.inherited) {
  const runs = join(common.stdout.trim(), "fork-package/runs");
  if (existsSync(runs))
    for (const name of readdirSync(runs)) {
      if (!/^run\.[^.]+$/.test(name)) continue;
      const path = join(runs, name);
      let record;
      try {
        record = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (!record || typeof record !== "object" || Array.isArray(record))
        record = {};
      if (record.status) continue;
      if (!Array.isArray(record.phases)) record.phases = [];
      const ended = new Date().toISOString();
      if (record.running)
        record.phases.push({
          ...record.running,
          ended,
          seconds:
            (Date.parse(ended) - Date.parse(record.running.started)) / 1000,
          status: "interrupted",
        });
      delete record.running;
      record.status = "interrupted";
      record.ended = ended;
      record.seconds = (Date.parse(ended) - Date.parse(record.started)) / 1000;
      record.reason =
        "previous execution ended without a final result; kernel lock is now available";
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
        mode: 0o600,
      });
      renameSync(temporary, path);
    }
}
const child = spawn("bash", [script, ...args], {
  ...lockInvocation(lock, ["inherit", "inherit", "inherit"], {
    ...process.env,
    BB_FORK_EXECUTION_ACTIVE: script,
  }),
  detached: process.platform !== "win32",
});
let interrupted = false;
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
  process.on(signal, () => {
    interrupted = true;
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {}
  });
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  lock.release();
  process.exitCode = signal || interrupted ? 1 : (code ?? 1);
});
