import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { inheritedLocks, lockInvocation } from "./fork-lock.mjs";
import {
  cancelOwner,
  cleanupEmpty,
  inspectOwner,
  killOwned,
  managerEnv,
  readOwner,
  reserveLaunch,
} from "./fork-cgroup.mjs";

export function spawnManaged(lock, command, options) {
  if (process.platform !== "linux")
    throw new Error("fork execution requires Linux systemd/cgroup v2");
  const descriptors = new Map(
    inheritedLocks().map((entry) => [entry.path, entry]),
  );
  descriptors.set(lock.path, lock);
  const owners = [...descriptors.values()].map(({ path }) => readOwner(path));
  const plan = reserveLaunch(owners);
  const child = spawn(
    "systemd-run",
    [
      "--user",
      "--scope",
      "--collect",
      "--quiet",
      `--unit=${plan.name}`,
      `--slice=${plan.slice}`,
      ...(plan.inherit ? ["--slice-inherit"] : []),
      "-p",
      "TimeoutStopSec=3s",
      "--",
      process.execPath,
      new URL("./fork-cgroup-enter.mjs", import.meta.url).pathname,
      "entry",
      plan.path,
      "--",
      ...command,
    ],
    {
      cwd: options.cwd,
      ...lockInvocation(lock, options.stdio, managerEnv(options.env)),
      detached: true,
    },
  );
  const managed = new EventEmitter();
  managed.stdout = child.stdout;
  managed.stderr = child.stderr;
  managed.pid = child.pid;
  managed.exitCode = null;
  managed.signalCode = null;
  managed.ownership = { launch: plan.launch, unit: plan.name, path: plan.path };
  let exited = false,
    rawClosed = false,
    finished = false,
    code,
    signal,
    failure,
    cancelled = null,
    cancelStarted = 0;
  const filter = lock.inherited ? plan.launch : null;
  child.once("error", (error) => {
    failure = error;
    exited = true;
  });
  child.once("exit", (status, stopped) => {
    exited = true;
    code = status;
    signal = stopped;
  });
  child.once("close", () => {
    rawClosed = true;
  });
  managed.kill = (number = "SIGTERM") => {
    cancelled ??= number;
    if (!cancelStarted) cancelStarted = performance.now();
    try {
      cancelOwner(lock, filter);
    } catch (error) {
      failure ??= error;
    }
    if (child.exitCode === null && child.signalCode === null)
      child.kill(number);
    return true;
  };
  const finish = (status, stopped) => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    managed.exitCode = status;
    managed.signalCode = stopped;
    if (!rawClosed) {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    if (failure) managed.emit("error", failure);
    managed.emit("close", status, stopped);
  };
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    try {
      if (cancelled && performance.now() - cancelStarted >= 3000)
        killOwned(lock, filter);
      if (exited) {
        const status = inspectOwner(lock, filter);
        if (!status.busy.length && rawClosed) {
          cleanupEmpty(lock, filter);
          finish(cancelled || failure ? 1 : (code ?? 1), signal);
        }
      }
    } catch (error) {
      failure ??= error;
      if (!cancelStarted) managed.kill("SIGTERM");
    } finally {
      if (cancelStarted && performance.now() - cancelStarted >= 7000)
        finish(1, null);
      checking = false;
    }
  }, 50);
  return managed;
}
