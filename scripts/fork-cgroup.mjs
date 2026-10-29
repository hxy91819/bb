import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function managerEnv(env = process.env) {
  const runtime = env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`;
  return {
    ...env,
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS:
      env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtime}/bus`,
  };
}

function boot() {
  return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
}
export function saveRuntime(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function ownerPath(path) {
  return `${path}.owner.json`;
}
export function ownerDirectory(owner) {
  return `${owner.path}.owners/${owner.generation}`;
}
export function readOwner(path) {
  const file = ownerPath(path);
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (
    value.version !== 1 ||
    !/^[a-f0-9-]{36}$/.test(value.generation) ||
    typeof value.boot !== "string"
  )
    throw new Error(`无效的内核归属记录：${file}`);
  return { ...value, path };
}

function records(owner, launch) {
  const directory = ownerDirectory(owner);
  if (!existsSync(directory)) throw new Error(`内核归属目录丢失：${directory}`);
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")))
    .filter((value) => !launch || value.launch === launch)
    .map((value) => {
      if (
        !/^[a-f0-9-]{36}$/.test(value.launch) ||
        (!/^bb-fork-[a-f0-9-]+\.scope$/.test(value.name) &&
          !/(?:^|-)bbfork[a-f0-9]{32}\.slice$/.test(value.name))
      )
        throw new Error("无效的 scope 归属");
      if (
        value.invocation &&
        (!/^[a-f0-9]{32}$/.test(value.invocation) ||
          typeof value.cgroup !== "string" ||
          !value.cgroup.startsWith("/") ||
          !Number.isSafeInteger(value.inode))
      )
        throw new Error("无效的 scope 实例身份");
      return value;
    });
}

export function queryUnits(names) {
  if (!names.length) return new Map();
  const result = spawnSync(
    "systemctl",
    [
      "--user",
      "show",
      "-p",
      "Id",
      "-p",
      "LoadState",
      "-p",
      "ActiveState",
      "-p",
      "ControlGroup",
      "-p",
      "InvocationID",
      "-p",
      "Slice",
      "--",
      ...new Set(names),
    ],
    { env: managerEnv(), encoding: "utf8", timeout: 2000 },
  );
  if (result.status !== 0)
    throw new Error(
      `无法查询内核任务归属，保留记录：${result.error?.message ?? result.stderr.trim()}`,
    );
  const units = new Map(
    result.stdout
      .trim()
      .split(/\n\s*\n/)
      .map((block) => {
        const fields = Object.fromEntries(
          block.split("\n").map((line) => {
            const i = line.indexOf("=");
            return [line.slice(0, i), line.slice(i + 1)];
          }),
        );
        if (
          !fields.Id ||
          !["loaded", "not-found"].includes(fields.LoadState) ||
          !fields.ActiveState ||
          fields.InvocationID === undefined ||
          fields.ControlGroup === undefined
        )
          throw new Error("systemd 归属查询不完整，保留记录");
        return [fields.Id, fields];
      }),
  );
  for (const name of names)
    if (!units.has(name))
      throw new Error(`systemd 缺少 ${name} 的身份，保留记录`);
  return units;
}

function populated(value) {
  const path = `/sys/fs/cgroup${value.cgroup}`;
  const stat = statSync(path);
  if (stat.ino !== value.inode || stat.dev !== value.device)
    throw new Error("同一 InvocationID 的 cgroup 身份改变，保留归属");
  const match = /^populated ([01])$/m.exec(
    readFileSync(join(path, "cgroup.events"), "utf8"),
  );
  if (!match) throw new Error("cgroup populated 状态不可读，保留归属");
  return match[1] === "1";
}

export function inspectOwner(owner, launch = null) {
  const all = records(owner, launch);
  const entries = all.filter(
    (value) =>
      value.invocation ||
      !all.some((bound) => bound.invocation && bound.launch === value.launch),
  );
  const units = queryUnits(entries.map(({ name }) => name));
  const busy = [];
  for (const value of entries) {
    const unit = units.get(value.name);
    if (unit.LoadState === "not-found") continue;
    if (!value.invocation) {
      if (unit.ControlGroup) {
        const stat = statSync(`/sys/fs/cgroup${unit.ControlGroup}`);
        if (
          populated({
            cgroup: unit.ControlGroup,
            inode: stat.ino,
            device: stat.dev,
          })
        )
          busy.push(value);
      } else if (!["inactive", "failed"].includes(unit.ActiveState))
        throw new Error("未绑定 Slice 的内核状态不完整");
      continue;
    }
    if (unit.InvocationID !== value.invocation) {
      if (!unit.InvocationID) {
        if (
          !["inactive", "failed"].includes(unit.ActiveState) ||
          unit.ControlGroup
        )
          throw new Error("已加载 unit 缺少 InvocationID，保留归属");
        try {
          if (populated(value)) busy.push(value);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      continue;
    }
    if (unit.ControlGroup && unit.ControlGroup !== value.cgroup)
      throw new Error("scope 的 cgroup 路径改变，保留归属");
    try {
      if (populated(value)) busy.push(value);
    } catch (error) {
      if (error.code === "ENOENT") {
        const latest = queryUnits([value.name]).get(value.name);
        if (
          latest.LoadState === "not-found" ||
          (latest.InvocationID && latest.InvocationID !== value.invocation) ||
          ["inactive", "failed"].includes(latest.ActiveState)
        )
          continue;
      }
      throw error;
    }
  }
  return { busy, entries };
}

export function prepareOwner(path) {
  const previous = readOwner(path);
  if (
    !previous &&
    existsSync(`${path}.owners`) &&
    readdirSync(`${path}.owners`).length
  )
    throw new Error("归属头丢失但仍有执行记录，保留归属");
  if (previous && previous.ready !== false) {
    if (inspectOwner(previous).busy.length)
      throw new Error(`另一个 fork 执行或阶段执行仍持有 ${path} 的内核 writer`);
    cleanupEmpty(previous);
  }
  if (
    previous?.ready === false &&
    existsSync(ownerDirectory(previous)) &&
    readdirSync(ownerDirectory(previous)).some(
      (name) => name.endsWith(".json") || name.endsWith(".plan"),
    )
  )
    throw new Error("未完成的归属初始化含有任务记录，保留归属");
  const owner = {
    version: 1,
    boot: boot(),
    generation: randomUUID(),
    path,
    ready: false,
  };
  saveRuntime(ownerPath(path), owner);
  mkdirSync(ownerDirectory(owner), { recursive: true });
  owner.ready = true;
  saveRuntime(ownerPath(path), owner);
  if (previous)
    rmSync(ownerDirectory(previous), { recursive: true, force: true });
  return owner;
}

export function assertOwner(owner, launch) {
  const current = readOwner(owner.path);
  if (
    !current ||
    current.generation !== owner.generation ||
    current.boot !== boot()
  )
    throw new Error("执行归属已改变，拒绝启动旧 payload");
  if (
    existsSync(join(ownerDirectory(owner), "cancelled")) ||
    existsSync(join(ownerDirectory(owner), `${launch}.cancelled`))
  )
    throw new Error("执行已取消，拒绝启动 payload");
}

export function reserveLaunch(owners) {
  const launch = randomUUID();
  const name = `bb-fork-${randomUUID()}.scope`;
  const slice = `bbfork${randomUUID().replaceAll("-", "")}.slice`;
  const manager = queryUnits(["-.slice"]).get("-.slice");
  const current = readFileSync("/proc/self/cgroup", "utf8")
    .split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3);
  const inherit =
    manager.ControlGroup && current?.startsWith(`${manager.ControlGroup}/`);
  let parentSlice = "-.slice";
  if (inherit) {
    const unit = current
      .split("/")
      .findLast((part) => part.endsWith(".scope") || part.endsWith(".service"));
    if (!unit) throw new Error("调用者 user unit 身份不可读");
    parentSlice = queryUnits([unit]).get(unit).Slice;
    if (!parentSlice?.endsWith(".slice"))
      throw new Error("调用者 Slice 身份不可读");
  }
  const effectiveSlice =
    parentSlice === "-.slice" ? slice : `${parentSlice.slice(0, -6)}-${slice}`;
  const plan = {
    launch,
    name,
    slice,
    effectiveSlice,
    inherit: Boolean(inherit),
    owners: owners.map(({ path, generation, boot }) => ({
      path,
      generation,
      boot,
    })),
  };
  for (const owner of owners) {
    assertOwner(owner, launch);
    saveRuntime(join(ownerDirectory(owner), `${launch}.intent.json`), {
      launch,
      name: effectiveSlice,
      scope: name,
    });
  }
  const path = join(ownerDirectory(owners.at(-1)), `${launch}.plan`);
  saveRuntime(path, plan);
  return { ...plan, path };
}

export function bindCurrent(plan, descriptors, resource) {
  const cgroup = readFileSync("/proc/self/cgroup", "utf8")
    .split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3);
  const scope = cgroup?.split("/").findLast((part) => part.endsWith(".scope"));
  if (!scope || (!resource && scope !== plan.name))
    throw new Error("payload 不在指定 scope 中");
  const unit = queryUnits([scope]).get(scope);
  if (
    unit.LoadState !== "loaded" ||
    unit.ControlGroup !== cgroup ||
    !unit.Slice
  )
    throw new Error("scope 的真实 Slice 归属不完整");
  const slice = queryUnits([unit.Slice]).get(unit.Slice);
  if (
    slice.LoadState !== "loaded" ||
    !/^[a-f0-9]{32}$/.test(slice.InvocationID) ||
    !slice.ControlGroup ||
    !cgroup.startsWith(`${slice.ControlGroup}/`)
  )
    throw new Error("scope 不在真实的执行 Slice 中");
  if (
    !resource &&
    !(slice.Id === plan.slice || slice.Id.endsWith(`-${plan.slice}`))
  )
    throw new Error("执行 Slice 名称不匹配");
  accessSync(`/sys/fs/cgroup${slice.ControlGroup}/cgroup.kill`, constants.W_OK);
  const stat = statSync(`/sys/fs/cgroup${slice.ControlGroup}`);
  const value = {
    launch: plan.launch,
    name: slice.Id,
    invocation: slice.InvocationID,
    cgroup: slice.ControlGroup,
    inode: stat.ino,
    device: stat.dev,
  };
  for (const owner of plan.owners) {
    const inherited = descriptors.find(
      (entry) =>
        entry.path === owner.path && entry.generation === owner.generation,
    );
    if (!inherited)
      throw new Error("缺少内核锁描述符，不能仅凭环境绑定 payload");
    assertOwner(owner, plan.launch);
    if (resource) {
      const bound = records(owner, plan.launch).find(
        (entry) => entry.invocation,
      );
      if (
        !bound ||
        bound.invocation !== value.invocation ||
        bound.cgroup !== value.cgroup ||
        bound.inode !== value.inode
      )
        throw new Error("资源 scope 迁出了执行 Slice，拒绝 payload");
    } else {
      saveRuntime(
        join(
          ownerDirectory(owner),
          `${plan.launch}.${slice.InvocationID}.json`,
        ),
        value,
      );
    }
  }
  for (const owner of plan.owners) assertOwner(owner, plan.launch);
}

export function cancelOwner(owner, launch) {
  const current = readOwner(owner.path);
  if (!current || current.generation !== owner.generation)
    throw new Error("取消时执行归属已改变");
  writeFileSync(
    join(ownerDirectory(owner), launch ? `${launch}.cancelled` : "cancelled"),
    "cancelled\n",
    { mode: 0o600 },
  );
}

export function killOwned(owner, launch = null) {
  if (owner.boot !== boot()) return;
  const values = records(owner, launch).filter((value) => value.invocation);
  const units = queryUnits(values.map(({ name }) => name));
  for (const value of values) {
    const unit = units.get(value.name);
    if (unit.LoadState !== "loaded" || unit.InvocationID !== value.invocation)
      continue;
    let fd;
    try {
      fd = openSync(`/sys/fs/cgroup${value.cgroup}`, "r");
      const stat = fstatSync(fd);
      if (stat.ino !== value.inode || stat.dev !== value.device) continue;
      writeFileSync(`/proc/self/fd/${fd}/cgroup.kill`, "1\n");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
}

export function cleanupEmpty(owner, launch = null) {
  const state = inspectOwner(owner, launch);
  if (state.busy.length) return;
  const units = queryUnits(state.entries.map(({ name }) => name));
  for (const value of [...state.entries].sort(
    (a, b) =>
      (b.cgroup?.split("/").length ?? 0) - (a.cgroup?.split("/").length ?? 0),
  )) {
    const current = queryUnits([value.name]).get(value.name);
    if (
      current.LoadState !== "loaded" ||
      (value.invocation && current.InvocationID !== value.invocation)
    )
      continue;
    if (!current.ControlGroup) continue;
    const stat = statSync(`/sys/fs/cgroup${current.ControlGroup}`);
    const instance = value.invocation
      ? value
      : { cgroup: current.ControlGroup, inode: stat.ino, device: stat.dev };
    if (populated(instance)) throw new Error("清理前 Slice 仍有 writer");
    const latest = queryUnits([value.name]).get(value.name);
    if (
      latest.InvocationID !== current.InvocationID ||
      latest.ControlGroup !== current.ControlGroup
    )
      continue;
    const result = spawnSync("systemctl", ["--user", "stop", value.name], {
      env: managerEnv(),
      encoding: "utf8",
      timeout: 3000,
    });
    if (result.status !== 0)
      throw new Error(
        `不能清理本次空 Slice，保留归属：${result.stderr.trim()}`,
      );
  }
}
