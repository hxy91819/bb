import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [repoArg, outputArg, tag] = process.argv.slice(2);
if (
  !repoArg ||
  !outputArg ||
  !/^fork-v[0-9][A-Za-z0-9._-]*$/u.test(tag ?? "")
) {
  throw new Error(
    "Usage: node package-runtime.mjs <repo> <output> <fork-v...>",
  );
}
if (
  !["linux", "darwin"].includes(process.platform) ||
  !["x64", "arm64"].includes(process.arch)
) {
  throw new Error("Supported platforms: linux/darwin x64/arm64");
}
const repo = resolve(repoArg);
const output = resolve(outputArg);
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
const name = `bb-${tag}-${process.platform}-${process.arch}`;
const temp = await mkdtemp(join(tmpdir(), "bb-fork-package-"));
const runtime = join(temp, name);
const nodeRoot = resolve(dirname(process.execPath), "..");
function run(command, args, cwd = temp) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

try {
  await mkdir(output, { recursive: true });
  await mkdir(join(runtime, "bin"), { recursive: true });
  await writeFile(
    join(runtime, "package.json"),
    JSON.stringify({ private: true }, null, 2),
  );
  const packed = JSON.parse(
    run("npm", [
      "pack",
      join(repo, "packages/bb-app"),
      "--pack-destination",
      temp,
      "--json",
    ]),
  );
  if (packed.length !== 1 || typeof packed[0].filename !== "string")
    throw new Error("Invalid npm pack result");
  run(
    "npm",
    [
      "install",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      join(temp, packed[0].filename),
    ],
    runtime,
  );
  const repairPath = join(repo, "scripts/repair-npm-bundled-dependencies.mjs");
  if (existsSync(repairPath)) {
    const { repairNpmBundledDependencies } = await import(
      pathToFileURL(repairPath).href
    );
    const require = createRequire(
      join(runtime, "node_modules/bb-app/package.json"),
    );
    await repairNpmBundledDependencies(
      repo,
      dirname(require.resolve("npm/package.json")),
      join(runtime, "package-lock.json"),
    );
  }
  await copyFile(process.execPath, join(runtime, "bin/node"));
  await chmod(join(runtime, "bin/node"), 0o755);
  await copyFile(join(nodeRoot, "LICENSE"), join(runtime, "NODE-LICENSE"));
  await copyFile(join(repo, "LICENSE"), join(runtime, "LICENSE"));
  for (const bin of ["bb", "bb-app", "bb-server", "bb-host-daemon"]) {
    const wrapper = `#!/bin/sh\nset -eu\nruntime_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexport PATH="$runtime_dir/bin:$PATH"\nexec "$runtime_dir/bin/node" "$runtime_dir/node_modules/bb-app/dist/${bin}.js" "$@"\n`;
    await writeFile(join(runtime, "bin", bin), wrapper, { mode: 0o755 });
  }
  const pkg = JSON.parse(
    await readFile(join(runtime, "node_modules/bb-app/package.json"), "utf8"),
  );
  await writeFile(
    join(runtime, "release.json"),
    JSON.stringify(
      {
        tag,
        source,
        version: pkg.version,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(runtime, "README.txt"),
    `BB fork release ${tag}\nSource: ${source}\nPlatform: ${process.platform} ${process.arch}\n\nRun bin/bb-app to start BB, or bin/bb --help for the CLI.\nNode and production dependencies are included. No npm install is needed.\nKeep this directory intact; invoke the launchers directly instead of symlinking them.\nUser data stays in the normal BB data directory and is not included in this archive.\n\nDocumentation: https://github.com/hxy91819/bb/blob/${tag}/docs/fork-maintenance.md\n`,
  );
  const archive = join(output, `${name}.tar.gz`);
  run("tar", ["-czf", archive, "-C", temp, name]);
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(`${archive}.sha256`, `${digest}  ${name}.tar.gz\n`);
  process.stdout.write(`${archive}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
