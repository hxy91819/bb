import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [script, ...args] = process.argv.slice(2);
const common = spawnSync(
  "git",
  ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  { encoding: "utf8" },
);
if (common.status !== 0) throw new Error(common.stderr);
const lock = join(common.stdout.trim(), "fork-execution.lock");
let inherited = false;
try {
  const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
  process.kill(owner.pid, 0);
  inherited = owner.token === process.env.BB_FORK_EXECUTION_TOKEN;
} catch {}
if (!inherited) {
  try {
    mkdirSync(lock);
  } catch {
    throw new Error(
      `另一个 fork 执行持有 ${lock}；若进程已退出，请检查遗留子进程后删除该锁目录`,
    );
  }
  process.env.BB_FORK_EXECUTION_TOKEN = randomUUID();
  writeFileSync(
    join(lock, "owner.json"),
    JSON.stringify({
      pid: process.pid,
      token: process.env.BB_FORK_EXECUTION_TOKEN,
    }),
    { mode: 0o600 },
  );
}
process.env.BB_FORK_EXECUTION_ACTIVE = script;
const child = spawn("bash", [script, ...args], {
  stdio: "inherit",
  env: process.env,
  detached: process.platform !== "win32",
});
let interrupted;
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
  process.on(signal, () => {
    interrupted = Date.now();
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {}
  });
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("close", async (code, signal) => {
  if (interrupted)
    await new Promise((accept) =>
      setTimeout(accept, Math.max(0, 4000 - (Date.now() - interrupted))),
    );
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  if (!inherited) rmSync(lock, { recursive: true, force: true });
  process.exitCode = signal ? 1 : (code ?? 1);
});
