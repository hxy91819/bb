import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const runner = join(repoRoot, "scripts/run-resource-isolated");
const unit = "bb-local-verification.scope";
const oomProbeUnit = "bb-resource-oom-probe.scope";
const uid = process.getuid();
const runtimeDir = `/run/user/${uid}`;
const env = {
  ...process.env,
  XDG_RUNTIME_DIR: runtimeDir,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir}/bus`,
};

function run(args, options = {}) {
  return spawnSync(runner, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    timeout: 10_000,
    ...options,
  });
}

function unitStatus(unitName = unit) {
  return spawnSync(
    "systemctl",
    ["--user", "show", unitName, "-p", "LoadState", "-p", "ActiveState"],
    { encoding: "utf8", env },
  );
}

function unitIsActive(unitName = unit) {
  return /^ActiveState=active$/m.test(unitStatus(unitName).stdout);
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("Timed out waiting for resource-isolation state");
}

async function waitForExit(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
}

await waitFor(() => !unitIsActive());

const probeSource = `
  const fs = require("node:fs");
  const cgroup = fs.readFileSync("/proc/self/cgroup", "utf8").trim().split(":").at(-1);
  const root = "/sys/fs/cgroup" + cgroup;
  process.stdout.write(JSON.stringify({
    cgroup,
    cwd: process.cwd(),
    memoryHigh: fs.readFileSync(root + "/memory.high", "utf8").trim(),
    memoryMax: fs.readFileSync(root + "/memory.max", "utf8").trim(),
    memorySwapMax: fs.readFileSync(root + "/memory.swap.max", "utf8").trim(),
  }));
`;
const probe = run(["--", process.execPath, "-e", probeSource]);
assert.equal(probe.status, 0, probe.stderr);
const observed = JSON.parse(probe.stdout);
assert.match(
  observed.cgroup,
  /\/user\.slice\/.*\/bb-local-verification\.scope$/,
);
assert.equal(observed.cwd, repoRoot);
assert.equal(observed.memoryHigh, String(3 * 1024 ** 3));
assert.equal(observed.memoryMax, String(4 * 1024 ** 3));
assert.equal(observed.memorySwapMax, "0");

await waitFor(() => !unitIsActive());

const nested = run(["--", runner, "--", process.execPath, "-e", probeSource]);
assert.equal(nested.status, 0, nested.stderr);
assert.equal(JSON.parse(nested.stdout).memoryMax, String(4 * 1024 ** 3));

const nestedPackage = run(["--", runner, "--profile", "package", "--", "true"]);
assert.notEqual(nestedPackage.status, 0);
assert.match(
  nestedPackage.stderr,
  /smaller than the requested package profile/,
);

await waitFor(() => !unitIsActive());

const packageProbe = run([
  "--profile",
  "package",
  "--",
  process.execPath,
  "-e",
  probeSource,
]);
assert.equal(packageProbe.status, 0, packageProbe.stderr);
const packageObserved = JSON.parse(packageProbe.stdout);
assert.equal(packageObserved.memoryHigh, String(5 * 1024 ** 3));
assert.equal(packageObserved.memoryMax, String(7 * 1024 ** 3));

await waitFor(() => !unitIsActive());

const fixtureDir = mkdtempSync(join(tmpdir(), "bb-resource-isolation-"));
const readyFile = join(fixtureDir, "ready");
const holder = spawn(
  runner,
  ["--", "sh", "-c", 'printf ready > "$1"; sleep 2', "sh", readyFile],
  { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] },
);
try {
  await waitFor(() => existsSync(readyFile));
  assert.equal(readFileSync(readyFile, "utf8"), "ready");
  const status = run(["--status"]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /ActiveState=active/);
  assert.match(status.stdout, /MemoryMax=4294967296/);
  const concurrent = run(["--", "true"]);
  assert.notEqual(concurrent.status, 0);
  assert.match(
    `${concurrent.stdout}\n${concurrent.stderr}`,
    /already exists|already loaded/i,
  );
  assert.deepEqual(await waitForExit(holder), { code: 0, signal: null });
} finally {
  holder.kill("SIGTERM");
  rmSync(fixtureDir, { recursive: true, force: true });
}

await waitFor(() => !unitIsActive());

const failed = run(["--", "sh", "-c", "exit 23"]);
assert.equal(failed.status, 23);

await waitFor(() => !unitIsActive());

assert.equal(run(["--profile"]).status, 2);
assert.equal(run(["--profile", "unknown", "--", "true"]).status, 2);

await waitFor(() => !unitIsActive(oomProbeUnit));

const boundedOomSource = `
  const blocks = [];
  for (let index = 0; index < 24; index += 1) {
    blocks.push(Buffer.alloc(8 * 1024 * 1024, 1));
  }
  process.exit(42);
`;
const oomProbe = spawnSync(
  "systemd-run",
  [
    "--user",
    "--scope",
    "--collect",
    "--quiet",
    "--unit=bb-resource-oom-probe",
    "--nice=5",
    "-p",
    "MemoryMax=96M",
    "-p",
    "MemorySwapMax=0",
    "-p",
    "OOMPolicy=continue",
    "sh",
    "-c",
    'node --max-old-space-size=256 -e "$1"; child_status=$?; cgroup=$(awk -F: \'$1 == "0" {print $3}\' /proc/self/cgroup); cat "/sys/fs/cgroup${cgroup}/memory.events"; exit "$child_status"',
    "sh",
    boundedOomSource,
  ],
  { cwd: repoRoot, encoding: "utf8", env, timeout: 10_000 },
);
assert.equal(oomProbe.status, 137, `${oomProbe.stdout}\n${oomProbe.stderr}`);
assert.match(oomProbe.stdout, /^oom 1$/m);
assert.match(oomProbe.stdout, /^oom_kill 1$/m);

await waitFor(() => !unitIsActive(oomProbeUnit));

const detachedDir = mkdtempSync(join(tmpdir(), "bb-resource-detached-"));
const detachedDone = join(detachedDir, "done");
try {
  const detached = run([
    "--",
    "sh",
    "-c",
    '(sleep 1; printf done > "$1") >/dev/null 2>&1 &',
    "sh",
    detachedDone,
  ]);
  assert.equal(detached.status, 0, detached.stderr);
  assert.equal(unitIsActive(), true);
  await waitFor(() => existsSync(detachedDone));
  assert.equal(readFileSync(detachedDone, "utf8"), "done");
  await waitFor(() => !unitIsActive());
} finally {
  rmSync(detachedDir, { recursive: true, force: true });
}

console.log("resource isolation checks passed");
