import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function replaceEntry(path, populate) {
  const dir = mkdtempSync(join(dirname(path), ".bb-cutover-"));
  try {
    const tmp = join(dir, "bb");
    populate(tmp);
    renameSync(tmp, path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function copyEntry(from, to) {
  if (lstatSync(from).isSymbolicLink()) {
    symlinkSync(readlinkSync(from), to);
  } else {
    cpSync(from, to);
  }
}

async function main() {
  const [action, configPath, target, backup] = process.argv.slice(2);
  if (
    !["check", "install", "verify", "restore"].includes(action) ||
    !isAbsolute(configPath ?? "") ||
    !isAbsolute(target ?? "") ||
    (["install", "restore"].includes(action) && !isAbsolute(backup ?? ""))
  ) {
    throw new Error(
      "Usage: node scripts/fork-machine-cli.mjs <check|install|verify|restore> <absolute-config.json> <absolute-target> [absolute-backup-directory]",
    );
  }
  const { machineCli, service } = readJson(configPath);
  const { home, dataDir } = machineCli ?? {};
  if (
    ![home, dataDir].every(
      (path) =>
        typeof path === "string" && isAbsolute(path) && !/[:\r\n]/.test(path),
    )
  ) {
    throw new Error(
      "Configure machineCli.home and machineCli.dataDir with absolute paths",
    );
  }
  if (statSync(home).uid !== process.getuid()) {
    throw new Error(`Run as the owner of ${home}`);
  }

  const shimDir = join(home, ".local/bin");
  const shim = join(shimDir, "bb");
  const machine = join(dataDir, "npm/bin/bb");
  const env = { HOME: home, PATH: `${shimDir}:/usr/bin:/bin` };
  const runVersion = (command, args = []) =>
    execFileSync(command, [...args, "--version"], {
      env,
      cwd: home,
      encoding: "utf8",
      timeout: 15_000,
    }).trim();
  const restore = () => {
    if (!lstatSync(backup, { throwIfNoEntry: false })) return;
    for (const [name, path] of [
      ["machine", machine],
      ["shim", shim],
    ]) {
      replaceEntry(path, (tmp) => copyEntry(join(backup, name), tmp));
    }
  };
  if (action === "restore") {
    restore();
    return;
  }

  let release;
  try {
    release = readJson(join(target, "release.json"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const version = release
    ? release.version
    : readJson(join(target, "packages/bb-app/package.json")).version;
  const node = release ? join(target, "bin/node") : service.nodeExecutable;
  if (typeof version !== "string" || !version || !isAbsolute(node ?? "")) {
    throw new Error(
      "Target must provide a version and an absolute Node executable",
    );
  }

  const assertInstalled = () => {
    const actual = runVersion("bb");
    const direct = runVersion(machine);
    if (actual !== version || direct !== version) {
      throw new Error(
        `CLI version mismatch: clean PATH=${actual}, machine=${direct}, target=${version}`,
      );
    }
    return actual;
  };
  if (action === "verify") {
    const port = service.serverPort;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid service.serverPort");
    }
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/system/version`,
      {
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Server version endpoint returned HTTP ${response.status}`,
      );
    const { currentVersion } = await response.json();
    if (currentVersion !== version) {
      throw new Error(
        `Server version mismatch: running=${currentVersion}, target=${version}`,
      );
    }
    process.stdout.write(
      `Clean PATH bb --version: ${assertInstalled()}; machine CLI and server: ${currentVersion}\n`,
    );
    return;
  }

  const launcher = release
    ? [join(target, "bin/bb")]
    : [node, join(target, "apps/host-daemon/dist/bb")];
  const cliVersion = runVersion(launcher[0], launcher.slice(1));
  if (cliVersion !== version) {
    throw new Error(`Target CLI reports ${cliVersion}, expected ${version}`);
  }

  if (!lstatSync(shim).isFile()) {
    throw new Error(`Expected a machine installer shim at ${shim}`);
  }
  const oldShim = readFileSync(shim, "utf8");
  const header = /^#!\/bin\/sh\nPATH=.*:"\$PATH"\nexport PATH\n/;
  if (
    !header.test(oldShim) ||
    !oldShim.includes(
      `if [ -x ${quote(machine)} ]; then exec ${quote(machine)} "$@"; fi\n`,
    ) ||
    !oldShim.includes("No installed bb machine CLI is available.")
  ) {
    throw new Error(
      `Expected the machine installer shim for ${machine} at ${shim}`,
    );
  }
  const machineEntry = lstatSync(machine);
  if (!machineEntry.isSymbolicLink() && !machineEntry.isFile()) {
    throw new Error(`Invalid machine CLI entry: ${machine}`);
  }
  if (action === "check") {
    process.stdout.write(`Target machine CLI: ${version}\n`);
    return;
  }

  if (lstatSync(backup, { throwIfNoEntry: false })) {
    throw new Error(`Backup path already exists: ${backup}`);
  }
  const snapshot = mkdtempSync(join(dirname(backup), ".bb-cli-backup-"));
  try {
    copyEntry(machine, join(snapshot, "machine"));
    copyEntry(shim, join(snapshot, "shim"));
    renameSync(snapshot, backup);
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
  try {
    const publish = (path, body) =>
      replaceEntry(path, (tmp) => writeFileSync(tmp, body, { mode: 0o755 }));
    publish(machine, `#!/bin/sh\nexec ${launcher.map(quote).join(" ")} "$@"\n`);
    publish(
      shim,
      oldShim.replace(
        header,
        () => `#!/bin/sh\nPATH=${quote(dirname(node))}:"$PATH"\nexport PATH\n`,
      ),
    );
    assertInstalled();
  } catch (error) {
    restore();
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
