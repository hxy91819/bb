import {
  cp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repairs = [
  {
    name: "undici",
    alias: "npm-bundled-undici",
    version: "6.28.1",
    integrity:
      "sha512-zWpdTVD54H48CIybL0rWQ3ukpb9d23wM7eH5RtfdmeP70cWHNjtfo7P4vZX+5CoDcO53J4Pu5uXp7lNfjc6DRA==",
  },
  {
    name: "brace-expansion",
    alias: "npm-bundled-brace-expansion",
    version: "5.0.12",
    integrity:
      "sha512-YovQ3rzhaLMIrDjNDMkNS01tea93qhEhG5xy8f6+R0l+dw3Ki+5sCoIoI942iuLZTHWogWktgwVDhU09iNEimQ==",
  },
];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function updateLock(path, prefix, repaired) {
  const lock = await readJson(path);
  if (!lock.packages || typeof lock.packages !== "object") {
    throw new Error(`Expected packages in ${path}`);
  }
  let changed = false;
  for (const repair of repaired) {
    const key = `${prefix}${repair.name}`;
    const entry = lock.packages[key];
    if (!entry || typeof entry !== "object") {
      throw new Error(`Missing bundled dependency ${key} in ${path}`);
    }
    if (
      entry.version === repair.version &&
      entry.integrity === repair.integrity
    )
      continue;
    changed = true;
    entry.version = repair.version;
    entry.resolved = `https://registry.npmjs.org/${repair.name}/-/${repair.name}-${repair.version}.tgz`;
    entry.integrity = repair.integrity;
  }
  if (!changed) return;
  const temporary = `${path}.bb-repair`;
  await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`);
  await rename(temporary, path);
}

export async function repairNpmBundledDependencies(
  repo,
  npmDirectory,
  runtimeLock,
) {
  const require = createRequire(join(repo, "packages/bb-app/package.json"));
  const { satisfies } = require("semver");
  const repaired = [];
  for (const repair of repairs) {
    const target = join(npmDirectory, "node_modules", repair.name);
    const installed = await readJson(join(target, "package.json"));
    const major = repair.version.split(".")[0];
    if (installed.version === repair.version) {
      repaired.push(repair);
      continue;
    }
    if (!satisfies(installed.version, `>=${major} <${repair.version}`))
      continue;
    const source = await realpath(join(repo, "node_modules", repair.alias));
    const replacement = await readJson(join(source, "package.json"));
    if (
      replacement.name !== repair.name ||
      replacement.version !== repair.version
    ) {
      throw new Error(`Unexpected repair source for ${repair.name}`);
    }
    await rm(target, { recursive: true, force: true });
    await cp(source, target, { recursive: true, dereference: true });
    repaired.push(repair);
    console.log(
      `npm bundle: ${repair.name} ${installed.version} -> ${repair.version}`,
    );
  }
  if (repaired.length === 0) return;
  if (runtimeLock) {
    const prefix = `${relative(dirname(runtimeLock), npmDirectory)}/node_modules/`;
    await updateLock(runtimeLock, prefix, repaired);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repo = resolve(
    process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const directories = new Set();
  for (const consumer of [
    "apps/server",
    "packages/plugin-build",
    "packages/bb-app",
  ]) {
    const require = createRequire(join(repo, consumer, "package.json"));
    directories.add(
      await realpath(dirname(require.resolve("npm/package.json"))),
    );
  }
  for (const directory of directories) {
    await repairNpmBundledDependencies(repo, directory);
  }
}
