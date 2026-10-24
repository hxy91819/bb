import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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

export async function runStage(path, name, cwd, command) {
  const state = JSON.parse(readFileSync(path, "utf8"));
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        command,
        cwd,
        source: state.source,
        base: state.base,
        previous: state.previous,
        runner: readFileSync(new URL(import.meta.url), "utf8"),
        pipeline: readFileSync(
          new URL("./fork-package", import.meta.url),
          "utf8",
        ),
        node: process.version,
        executable: process.execPath,
        env: Object.fromEntries(
          Object.entries(process.env).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      }),
    )
    .digest("hex");
  if (
    name === "install" &&
    !existsSync(resolve(cwd, "node_modules/.modules.yaml"))
  ) {
    state.completed = {};
    save(path, state);
  }
  if (state.completed?.[name]?.hash === hash) {
    console.log(
      `复用 ${name}：${state.source}（${state.completed[name].seconds}s）`,
    );
    return;
  }
  state.completed ??= {};
  delete state.completed[name];
  save(path, state);
  const log = `${path}.${name}.log`;
  const started = Date.now();
  console.log(`开始 ${name}；日志：${log}`);
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      appendFileSync(log, data);
      (stream === child.stdout ? process.stdout : process.stderr).write(data);
    });
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (status, signal) =>
      signal
        ? reject(new Error(`${name} stopped by ${signal}`))
        : accept(status),
    );
  });
  if (code !== 0)
    throw new Error(
      `${name} failed (exit ${code})；使用 --resume ${state.source} 接续，日志：${log}`,
    );
  state.completed[name] = {
    hash,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  };
  save(path, state);
  console.log(`完成 ${name}：${state.completed[name].seconds}s`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [command, path, ...args] = process.argv.slice(2);
    if (command === "init") {
      const [source, base, previous, worktree, filtersExplicit, ...filters] =
        args;
      if (!existsSync(path))
        save(path, {
          source,
          base,
          previous,
          worktree,
          filters,
          completed: {},
        });
      else {
        const state = JSON.parse(readFileSync(path, "utf8"));
        if (
          state.source !== source ||
          state.base !== base ||
          state.worktree !== worktree
        )
          throw new Error("接续记录与聚合输入不一致");
        if (filtersExplicit === "1") {
          state.filters = filters;
          save(path, state);
        }
      }
    } else if (command === "field") {
      const value = JSON.parse(readFileSync(path, "utf8"))[args[0]];
      console.log(Array.isArray(value) ? value.join("\n") : value);
    } else if (command === "run") {
      const [name, cwd, ...invocation] = args;
      await runStage(path, name, cwd, invocation);
    } else
      throw new Error(
        "Usage: fork-package-state.mjs init|field|run <state> ...",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
