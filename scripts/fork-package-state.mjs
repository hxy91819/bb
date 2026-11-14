import { resourceBudget } from "./resource-runtime.mjs";
import { spawnManaged } from "./fork-process.mjs";
import { acquireLock } from "./fork-lock.mjs";
import { randomUUID } from "node:crypto";
import {
  digest,
  executionIdentity,
  receipt,
  validReceipt,
} from "./fork-stage-receipts.mjs";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function save(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, path);
}

const order = [
  "install",
  "maintenance",
  "protocol",
  "plugin-contract",
  "typecheck",
  "tests",
  "runtime",
  "native",
];

export async function runStage(path, name, cwd, command) {
  const lock = acquireLock(`${path}.lock`, false);
  try {
    return await executeStage(path, name, cwd, command, lock);
  } finally {
    lock.release();
  }
}

async function executeStage(path, name, cwd, command, lock) {
  const started = Date.now();
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.completed ??= {};
  state.events ??= [];
  if (state.running) {
    state.events.push({
      ...state.running,
      ended: new Date().toISOString(),
      status: "interrupted",
      cacheHit: false,
      seconds: (Date.now() - Date.parse(state.running.started)) / 1000,
      reason:
        "previous runner exited without a result; kernel lock is now available",
    });
    delete state.running;
  }
  const index = order.indexOf(name);
  const dependencies = Object.fromEntries(
    order
      .slice(0, Math.max(index, 0))
      .map((stage) => [stage, state.completed[stage]?.generation ?? null]),
  );
  const resourceIndex = command.findIndex((part) =>
    part.endsWith("/run-resource-isolated"),
  );
  const profileIndex = command.indexOf("--profile");
  let resources;
  try {
    resources =
      resourceIndex >= 0
        ? resourceBudget(
            profileIndex >= 0 ? command[profileIndex + 1] : "verification",
          )
        : null;
  } catch (error) {
    for (const stage of index < 0 ? [name] : order.slice(index))
      delete state.completed[stage];
    state.events.push({
      name,
      started: new Date(started).toISOString(),
      ended: new Date().toISOString(),
      seconds: (Date.now() - started) / 1000,
      status: "failed",
      cacheHit: false,
      reason: error.message,
    });
    state.delivery ??= {};
    state.delivery.verification = "failed";
    save(path, state);
    throw error;
  }
  const hash = digest(
    JSON.stringify({
      command,
      resources,
      cwd,
      source: state.source,
      base: state.base,
      previous: state.previous,
      filters: state.filters,
      dependencies,
      runner: readFileSync(new URL(import.meta.url), "utf8"),
      supervision: [
        "fork-process.mjs",
        "fork-cgroup.mjs",
        "fork-cgroup-enter.mjs",
      ].map((name) =>
        readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
      ),
      locking: readFileSync(
        new URL("./fork-lock.mjs", import.meta.url),
        "utf8",
      ),
      receipts: readFileSync(
        new URL("./fork-stage-receipts.mjs", import.meta.url),
        "utf8",
      ),
      pipeline: readFileSync(
        new URL("./fork-package", import.meta.url),
        "utf8",
      ),
      identity: executionIdentity(cwd, command),
    }),
  );
  const previous = state.completed[name];
  const event = {
    name,
    started: new Date(started).toISOString(),
    hash,
    resources,
  };
  const installed =
    name !== "install" ||
    !existsSync(resolve(cwd, "pnpm-lock.yaml")) ||
    existsSync(resolve(cwd, "node_modules/.modules.yaml"));
  if (
    previous?.hash === hash &&
    installed &&
    validReceipt(cwd, previous.outputs)
  ) {
    state.events.push({
      ...event,
      ended: new Date().toISOString(),
      seconds: (Date.now() - started) / 1000,
      status: "reused",
      cacheHit: true,
    });
    save(path, state);
    console.log(`复用 ${name}：${state.source}（${previous.seconds}s）`);
    return;
  }
  for (const stage of index < 0 ? [name] : order.slice(index))
    delete state.completed[stage];
  const log = `${path}.${name}.log`;
  state.running = event;
  save(path, state);
  console.log(`开始 ${name}；日志：${log}`);
  const environment = { ...process.env, PWD: cwd };
  delete environment.OLDPWD;
  if (resources) environment.BB_RESOURCE_BUDGET = JSON.stringify(resources);
  for (const key of [
    "BB_FORK_EXECUTION_TOKEN",
    "BB_FORK_EXECUTION_ACTIVE",
    "BB_FORK_INPUT_SNAPSHOT",
  ])
    delete environment[key];
  let interrupted;
  let handlers = new Map();
  try {
    const child = spawnManaged(lock, command, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stop = (signal) => {
      interrupted = signal;
      if (child.exitCode === null && child.signalCode === null)
        child.kill(signal);
    };
    handlers = new Map(
      ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [
        signal,
        () => stop(signal),
      ]),
    );
    for (const [signal, handler] of handlers) process.on(signal, handler);
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        appendFileSync(log, data);
        (stream === child.stdout ? process.stdout : process.stderr).write(data);
      });
    const code = await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) =>
        signal
          ? reject(new Error(`${name} stopped by ${signal}`))
          : accept(status),
      );
    });
    if (code !== 0 || interrupted)
      throw new Error(
        `${name} failed (exit ${code}${interrupted ? `, ${interrupted}` : ""})`,
      );
    if (!installed && !existsSync(resolve(cwd, "node_modules/.modules.yaml")))
      throw new Error("install 未生成 node_modules/.modules.yaml");
    state.completed[name] = {
      hash,
      generation: randomUUID(),
      outputs: receipt(cwd, name === "install", previous?.outputs),
      seconds: Number(((Date.now() - started) / 1000).toFixed(3)),
    };
    state.events.push({
      ...event,
      ended: new Date().toISOString(),
      seconds: state.completed[name].seconds,
      status: "completed",
      cacheHit: false,
    });
    console.log(`完成 ${name}：${state.completed[name].seconds}s`);
  } catch (error) {
    state.delivery ??= {};
    if (index >= 0 && index <= order.indexOf("tests"))
      state.delivery.verification = interrupted ? "interrupted" : "failed";
    else if (["runtime", "native"].includes(name))
      state.delivery.runtime = interrupted ? "interrupted" : "failed";
    state.events.push({
      ...event,
      ended: new Date().toISOString(),
      seconds: (Date.now() - started) / 1000,
      status: interrupted ? "interrupted" : "failed",
      cacheHit: false,
      reason: error.message,
    });
    throw new Error(
      `${error.message}；使用 --resume ${state.source} 接续，日志：${log}`,
    );
  } finally {
    delete state.running;
    save(path, state);
    for (const [signal, handler] of handlers)
      process.removeListener(signal, handler);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [command, path, ...args] = process.argv.slice(2);
    if (command === "init") {
      const [source, base, previous, worktree, ...filters] = args;
      if (!existsSync(path))
        save(path, {
          source,
          base,
          previous,
          worktree,
          filters,
          completed: {},
          snapshot: process.env.BB_FORK_INPUT_SNAPSHOT ?? null,
          delivery: {
            verification: "pending",
            promotion: "pending",
            runtime: "pending",
            tag: "pending",
            release: "not-observed",
            installation: "not-observed",
          },
        });
      else {
        const state = JSON.parse(readFileSync(path, "utf8"));
        if (
          state.source !== source ||
          state.base !== base ||
          state.worktree !== worktree
        )
          throw new Error("接续记录与聚合输入不一致");
        state.previous = previous;
        state.filters = filters;
        state.snapshot = process.env.BB_FORK_INPUT_SNAPSHOT ?? null;
        state.delivery = {
          verification: "pending",
          promotion: "pending",
          runtime: "pending",
          tag: "pending",
          release: "not-observed",
          installation: "not-observed",
        };
        save(path, state);
      }
    } else if (command === "begin") {
      const state = JSON.parse(readFileSync(path, "utf8"));
      const verifyingOnly = args[0] === "1";
      state.delivery = {
        verification: "pending",
        promotion: verifyingOnly ? "skipped" : "pending",
        runtime: verifyingOnly || args[1] !== "1" ? "skipped" : "pending",
        tag: verifyingOnly || args[2] !== "1" ? "skipped" : "pending",
        release: "not-observed",
        installation: "not-observed",
      };
      save(path, state);
    } else if (command === "journal") {
      const state = existsSync(path)
        ? JSON.parse(readFileSync(path, "utf8"))
        : { started: new Date().toISOString(), phases: [] };
      const now = Date.now();
      if (state.running)
        state.phases.push({
          ...state.running,
          ended: new Date(now).toISOString(),
          seconds: (now - Date.parse(state.running.started)) / 1000,
          status: args[0] === "failed" ? "failed-or-interrupted" : "completed",
        });
      delete state.running;
      if (["success", "failed"].includes(args[0])) {
        state.status = args[0];
        state.ended = new Date(now).toISOString();
        state.seconds = (now - Date.parse(state.started)) / 1000;
        state.verificationState = args[1] ?? null;
        if (args[1] && existsSync(args[1])) {
          const { source, base, previous, filters, snapshot, delivery } =
            JSON.parse(readFileSync(args[1], "utf8"));
          state.result = {
            source,
            base,
            previous,
            filters,
            snapshot,
            delivery,
          };
        }
        state.exitCode = Number(args[2] ?? 0);
        state.reason =
          args[0] === "failed"
            ? `process exited with status ${state.exitCode}`
            : null;
      } else
        state.running = {
          name: args[0],
          started: new Date(now).toISOString(),
          cacheHit: false,
        };
      save(path, state);
    } else if (command === "result") {
      const state = JSON.parse(readFileSync(path, "utf8"));
      state.delivery ??= {};
      state.delivery[args[0]] = args[1];
      save(path, state);
    } else if (command === "field") {
      const value = JSON.parse(readFileSync(path, "utf8"))[args[0]];
      console.log(Array.isArray(value) ? value.join("\n") : value);
    } else if (command === "run") {
      const [name, cwd, ...invocation] = args;
      await runStage(path, name, cwd, invocation);
    } else
      throw new Error(
        "Usage: fork-package-state.mjs init|begin|journal|result|field|run <state> ...",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
