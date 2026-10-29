import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileIdentity(path) {
  if (!existsSync(path)) return { path, missing: true };
  const actual = realpathSync(path);
  return { path, actual, hash: digest(readFileSync(actual)) };
}

function executable(name, cwd) {
  if (name.includes("/")) return resolve(cwd, name);
  return (process.env.PATH ?? "")
    .split(delimiter)
    .map((dir) => join(dir, name))
    .find(existsSync);
}

function payloadDigest(root) {
  const files = receipt(root, false, {}, ["."]);
  return digest(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(files).map(([name, { signature, ...value }]) => [
          name,
          value,
        ]),
      ),
    ),
  );
}

function pnpmPayload(path, version) {
  if (!path || !version) return null;
  const entry = realpathSync(path);
  const source = readFileSync(entry, "utf8");
  if (source.includes("corepack.cjs") && source.includes("runMain")) {
    const home =
      process.env.COREPACK_HOME ??
      join(
        process.env.XDG_CACHE_HOME ??
          process.env.LOCALAPPDATA ??
          join(
            homedir(),
            process.platform === "win32" ? "AppData/Local" : ".cache",
          ),
        "node/corepack",
      );
    const root = join(home, "v1/pnpm", version);
    if (!existsSync(join(root, "package.json"))) return null;
    return {
      dispatcher: fileIdentity(join(dirname(entry), "lib/corepack.cjs")),
      files: payloadDigest(root),
    };
  }
  let root = dirname(entry);
  for (let depth = 0; depth < 3; depth++, root = dirname(root)) {
    const manifest = join(root, "package.json");
    if (
      existsSync(manifest) &&
      JSON.parse(readFileSync(manifest, "utf8")).name === "pnpm"
    )
      return { files: payloadDigest(root) };
  }
  return null;
}

export function executionIdentity(cwd, command) {
  const separator = command.indexOf("--");
  const target = separator >= 0 ? command[separator + 1] : command[0];
  const names = new Set(
    [
      command[0],
      target,
      "node",
      "bash",
      "git",
      ...(command.includes("pnpm") ? ["pnpm"] : []),
    ].filter(Boolean),
  );
  for (const arg of command)
    if (
      arg.startsWith("/") &&
      /\.(?:m?js|cjs|sh)$/.test(arg) &&
      existsSync(arg) &&
      lstatSync(arg).isFile()
    )
      names.add(arg);
  const tools = [...names].map((name) => {
    const path = executable(name, cwd);
    return path ? fileIdentity(path) : { name, missing: true };
  });
  const nodeTargets = [...names]
    .filter(
      (name) =>
        /(?:^|\/)node(?:js)?$/.test(name) ||
        (name === target &&
          /\.mjs$/.test(command[separator >= 0 ? separator + 2 : 1] ?? "")),
    )
    .map((name) => {
      const path = executable(name, cwd);
      if (!path) return { name, missing: true };
      const result = spawnSync(
        path,
        [
          "-p",
          "JSON.stringify({version:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch,libc:process.report?.getReport().header.glibcVersionRuntime??null})",
        ],
        { cwd, encoding: "utf8", timeout: 10000 },
      );
      return {
        path,
        runtime:
          result.status === 0 ? result.stdout.trim() : `${Date.now()}-unknown`,
      };
    });
  const pnpm = command.includes("pnpm") ? executable("pnpm", cwd) : null;
  const version = pnpm
    ? spawnSync(pnpm, ["--version"], { cwd, encoding: "utf8", timeout: 15000 })
    : null;
  const payload =
    version?.status === 0 ? pnpmPayload(pnpm, version.stdout.trim()) : null;
  const libc =
    process.report?.getReport().header.glibcVersionRuntime ??
    (process.platform === "linux" ? "unknown" : process.platform);
  const environment = Object.fromEntries(
    Object.entries(process.env)
      .filter(
        ([name]) =>
          ![
            "BB_FORK_EXECUTION_TOKEN",
            "BB_FORK_EXECUTION_ACTIVE",
            "BB_FORK_INPUT_SNAPSHOT",
            "SHLVL",
            "_",
            "PWD",
            "OLDPWD",
          ].includes(name),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    tools,
    nodeTargets,
    pnpmPayload: payload,
    pnpm:
      version?.status === 0
        ? version.stdout.trim()
        : pnpm
          ? "unknown"
          : "unused",
    nonce:
      (command.includes("pnpm") &&
        (!version || version.status !== 0 || !payload)) ||
      libc === "unknown"
        ? `${Date.now()}-${Math.random()}`
        : null,
    node: fileIdentity(process.execPath),
    version: process.version,
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    libc,
    environment: digest(JSON.stringify(environment)),
    inputs: [
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      ".npmrc",
      "package.json",
      "turbo.json",
      "scripts/run-resource-isolated",
    ].map((name) => fileIdentity(resolve(cwd, name))),
  };
}

function roots(cwd, install) {
  if (install) return ["node_modules"];
  const result = spawnSync(
    "git",
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) {
    if (existsSync(resolve(cwd, ".git")))
      throw new Error(result.stderr?.trim() || "无法列出构建产物");
    return [];
  }
  return result.stdout
    .split("\0")
    .filter((path) => /(?:^|\/)(?:dist|generated|bundled-types)\/$/.test(path));
}

export function receipt(
  cwd,
  install,
  cache = {},
  selectedRoots = roots(cwd, install),
) {
  const files = {};
  const visit = (relative) => {
    const path = resolve(cwd, relative);
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      files[relative] = {
        link: readlinkSync(path),
        external: !realpathSync(path).startsWith(`${resolve(cwd)}/`),
      };
    } else if (stat.isDirectory()) {
      files[`${relative}/`] = {
        directory: true,
        children: readdirSync(path).sort(),
      };
      for (const name of files[`${relative}/`].children)
        visit(join(relative, name));
    } else if (stat.isFile()) {
      const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}`;
      const previous = cache[relative];
      files[relative] = {
        signature,
        mode: stat.mode,
        hash:
          previous?.signature === signature
            ? previous.hash
            : digest(readFileSync(path)),
      };
    }
  };
  for (const root of selectedRoots) visit(root.replace(/\/$/, ""));
  return files;
}

export function validReceipt(cwd, files) {
  if (!files) return false;
  for (const [name, expected] of Object.entries(files)) {
    const path = resolve(cwd, name);
    try {
      const stat = lstatSync(path);
      if (expected.directory) {
        if (
          !stat.isDirectory() ||
          JSON.stringify(readdirSync(path).sort()) !==
            JSON.stringify(expected.children)
        )
          return false;
      } else if (expected.link) {
        if (
          expected.external ||
          !stat.isSymbolicLink() ||
          readlinkSync(path) !== expected.link ||
          !existsSync(path)
        )
          return false;
      } else {
        if (!stat.isFile() || stat.mode !== expected.mode) return false;
        const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}`;
        if (
          signature !== expected.signature &&
          digest(readFileSync(path)) !== expected.hash
        )
          return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}
