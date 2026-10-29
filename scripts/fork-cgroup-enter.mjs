import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import { accessSync, constants, readFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { inheritedLocks, lockInvocation } from "./fork-lock.mjs";
import { assertOwner, bindCurrent, managerEnv } from "./fork-cgroup.mjs";

try {
  const [kind, path, separator, ...command] = process.argv.slice(2);
  if (
    !["entry", "resource"].includes(kind) ||
    separator !== "--" ||
    !command.length
  )
    throw new Error("无效的 scope payload");
  const plan = JSON.parse(readFileSync(path, "utf8"));
  bindCurrent(plan, inheritedLocks(), kind === "resource");
  const env = managerEnv({ ...process.env, BB_FORK_CGROUP_PLAN: path });
  let invocation = command;
  if (kind === "entry" && /(?:^|\/)run-resource-isolated$/.test(command[0])) {
    const index = command.indexOf("--");
    if (index < 0) throw new Error("资源入口缺少命令分隔符");
    invocation = [
      ...command.slice(0, index + 1),
      process.execPath,
      new URL(import.meta.url).pathname,
      "resource",
      path,
      "--",
      ...command.slice(index + 1),
    ];
  }
  const executable = invocation[0].includes("/")
    ? resolve(invocation[0])
    : (env.PATH ?? "")
        .split(delimiter)
        .map((dir) => resolve(dir, invocation[0]))
        .find((candidate) => {
          try {
            accessSync(candidate, constants.X_OK);
            return true;
          } catch {
            return false;
          }
        });
  if (!executable) throw new Error(`ENOENT: ${invocation[0]}`);
  for (const owner of plan.owners) assertOwner(owner, plan.launch);
  const descriptors = inheritedLocks();
  const lock = descriptors.find(
    (entry) => entry.path === plan.owners.at(-1).path,
  );
  if (!lock) throw new Error("payload 内核锁描述符丢失");
  const child = spawn(
    executable,
    invocation.slice(1),
    lockInvocation(lock, ["inherit", "inherit", "inherit"], env),
  );
  for (const number of ["SIGTERM", "SIGINT", "SIGHUP"])
    process.on(number, () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill(number);
    });
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (status, signal) =>
    process.exit(signal ? 128 + osConstants.signals[signal] : (status ?? 1)),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
