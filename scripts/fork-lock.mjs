import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, openSync, statSync } from "node:fs";
import { prepareOwner, readOwner } from "./fork-cgroup.mjs";
import { dirname, resolve } from "node:path";

export function inheritedLocks() {
  let entries;
  try {
    entries = JSON.parse(process.env.BB_FORK_LOCKS ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => {
    if (
      typeof entry?.path !== "string" ||
      !Number.isInteger(entry.fd) ||
      entry.fd < 3
    )
      return false;
    try {
      const opened = fstatSync(entry.fd);
      const named = statSync(entry.path);
      return (
        opened.isFile() && opened.dev === named.dev && opened.ino === named.ino
      );
    } catch {
      return false;
    }
  });
}

function lockDescriptor(fd) {
  const options = { stdio: [fd, "pipe", "pipe"], encoding: "utf8" };
  const flock = spawnSync("flock", ["-n", "-E", "75", "0"], options);
  if (flock.error?.code !== "ENOENT") return flock;
  return spawnSync(
    "perl",
    ["-MFcntl=:flock", "-e", "flock(STDIN, LOCK_EX|LOCK_NB) or exit 75"],
    options,
  );
}

export function acquireLock(path, allowInherited) {
  path = resolve(path);
  const inherited = allowInherited
    ? inheritedLocks().find((entry) => entry.path === path)
    : undefined;
  mkdirSync(dirname(path), { recursive: true });
  const fd = inherited?.fd ?? openSync(path, "a+", 0o600);
  const result = lockDescriptor(fd);
  if (result.status !== 0) {
    if (!inherited) closeSync(fd);
    if (result.status === 75)
      throw new Error(
        `另一个 fork 执行或阶段执行仍持有 ${path}；等待现有 writer 退出后重试`,
      );
    throw new Error(
      result.error?.message ??
        result.stderr?.trim() ??
        "需要 flock 或 Perl Fcntl 提供内核文件锁",
    );
  }
  let owner;
  try {
    owner = inherited ? readOwner(path) : prepareOwner(path);
    if (!owner || (inherited && inherited.generation !== owner.generation))
      throw new Error("继承内核归属已改变");
  } catch (error) {
    if (!inherited) closeSync(fd);
    throw error;
  }
  return {
    ...owner,
    path,
    fd,
    inherited: Boolean(inherited),
    release: () => {
      if (!inherited) closeSync(fd);
    },
  };
}

export function lockInvocation(lock, stdio, env) {
  const locks = new Map(inheritedLocks().map((entry) => [entry.path, entry]));
  locks.set(lock.path, lock);
  const descriptors = [...locks.values()];
  return {
    stdio: [...stdio, ...descriptors.map(({ fd }) => fd)],
    env: {
      ...env,
      BB_FORK_LOCKS: JSON.stringify(
        descriptors.map(({ path, generation, boot }, index) => ({
          path,
          generation,
          boot,
          fd: index + stdio.length,
        })),
      ),
    },
  };
}
