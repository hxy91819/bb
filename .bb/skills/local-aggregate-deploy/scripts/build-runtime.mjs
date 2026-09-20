import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { delimiter, dirname, resolve } from "node:path";

function parseArgs(args) {
  let repoPath = process.cwd();
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--repo requires a path");
      }
      repoPath = resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, repoPath };
}

function resolveNodeOptions(env) {
  const current = env.NODE_OPTIONS?.trim() ?? "";
  if (/--max-old-space-size(?:=|\s)/u.test(current)) {
    return current;
  }
  return [current, "--max-old-space-size=6144"].filter(Boolean).join(" ");
}

function createBuildEnv(env) {
  const nodeBin = dirname(process.execPath);
  const path = env.PATH ?? "";
  const pathEntries = path.split(delimiter);
  return {
    ...env,
    NODE_OPTIONS: resolveNodeOptions(env),
    PATH: pathEntries.includes(nodeBin)
      ? path
      : [nodeBin, path].filter(Boolean).join(delimiter),
  };
}

function run(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          signal
            ? `${options.label} stopped by ${signal}`
            : `${options.label} failed with exit code ${code ?? 1}`,
        ),
      );
    });
  });
}

async function main() {
  const { dryRun, repoPath } = parseArgs(process.argv.slice(2));
  const requireFromRepo = createRequire(resolve(repoPath, "package.json"));
  const turboEntrypoint = requireFromRepo.resolve("turbo/bin/turbo");
  const env = createBuildEnv(process.env);
  const runtimeBuildArgs = [
    turboEntrypoint,
    "run",
    "build",
    "--filter=@bb/bundled-plugins",
    "--filter=@get-bb/plugin-sdk",
    "--filter=@bb/app",
    "--filter=@bb/server",
    "--filter=@bb/host-daemon",
    "--concurrency=1",
    "--output-logs=errors-only",
    "--summarize=false",
    "--no-update-notifier",
  ];
  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify({
        nodeOptions: env.NODE_OPTIONS,
        runtimeBuild: [process.execPath, ...runtimeBuildArgs],
      })}\n`,
    );
    return;
  }

  await run(process.execPath, runtimeBuildArgs, {
    cwd: repoPath,
    env,
    label: "serialized runtime build",
  });
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
