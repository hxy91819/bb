import { spawn } from "node:child_process";
import { basename } from "node:path";
import { lockInvocation } from "./fork-lock.mjs";

export function spawnManaged(lock, command, options) {
  if (process.platform !== "linux")
    throw new Error(
      "fork stage supervision requires Linux subreaper/pidfd support",
    );
  const supervisor = [
    "python3",
    new URL("./fork-supervise.py", import.meta.url).pathname,
  ];
  const separator = command.indexOf("--");
  const invocation =
    basename(command[0]) === "run-resource-isolated" && separator >= 0
      ? [
          ...command.slice(0, separator + 1),
          ...supervisor,
          ...command.slice(separator + 1),
        ]
      : [...supervisor, ...command];
  return spawn(invocation[0], invocation.slice(1), {
    cwd: options.cwd,
    ...lockInvocation(lock, options.stdio, options.env),
    detached: true,
  });
}
