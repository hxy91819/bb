import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [flag, input] = process.argv.slice(2);
if (flag !== "--server-repo" || !input)
  throw new Error(
    "Usage: node scripts/resource-worker-check.mjs --server-repo <checkout-with-server-worker-config-and-dependencies>",
  );
const repo = resolve(input);
readFileSync(join(repo, "apps/server/scripts/server-test-workers.mjs"));
const temporary = mkdtempSync(join(tmpdir(), "bb-worker-bridge-"));
const units = [];
const results = [];
const env = {
  ...process.env,
  CI: "1",
  XDG_RUNTIME_DIR:
    process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`,
};
for (const key of [
  "BB_RESOURCE_BUDGET",
  "BB_RESOURCE_CPU_QUOTA_PERCENT",
  "BB_RESOURCE_MEMORY_HIGH_BYTES",
  "BB_RESOURCE_MEMORY_MAX_BYTES",
  "BB_RESOURCE_VITEST_WORKERS",
  "VITEST_MAX_WORKERS",
  "BB_CI_TEST_SHARD",
  "BB_FORK_CGROUP_PLAN",
])
  delete env[key];
const binary = spawnSync("bash", ["-c", "command -v systemd-run"], {
  encoding: "utf8",
});
assert.equal(binary.status, 0, binary.stderr);
mkdirSync(join(temporary, "bin"));
writeFileSync(
  join(temporary, "bin/systemd-run"),
  `#!/bin/sh\nexec '${binary.stdout.trim()}' --property=RuntimeMaxSec=20s --property=TimeoutStopSec=3s "$@"\n`,
);
chmodSync(join(temporary, "bin/systemd-run"), 0o755);
env.PATH = `${temporary}/bin:${env.PATH}`;
const root = join(repo, "apps/server");
const code = `import { createVitest } from 'vitest/node';const input=process.env.VITEST_MAX_WORKERS;const budget=JSON.parse(process.env.BB_RESOURCE_BUDGET);const c=await createVitest('test',{root:${JSON.stringify(root)},watch:false});try{console.log('WORKER_RESULT='+JSON.stringify({input,budget,after:process.env.VITEST_MAX_WORKERS,projects:c.projects.map(p=>({name:p.name,workers:p.config.maxWorkers}))}))}finally{await c.close()}`;
try {
  for (const item of [
    { name: "host-default", expected: 4, env: {} },
    { name: "explicit-two", expected: 2, env: { VITEST_MAX_WORKERS: "2" } },
    { name: "explicit-eight", expected: 8, env: { VITEST_MAX_WORKERS: "8" } },
    { name: "nested-retains-four", expected: 4, nested: "99", env: {} },
    { name: "nested-explicit-two", expected: 2, nested: "2", env: {} },
    {
      name: "explicit-budget-cap",
      expected: 2,
      env: { BB_RESOURCE_VITEST_WORKERS: "2", VITEST_MAX_WORKERS: "4" },
    },
    {
      name: "low-capacity",
      expected: 1,
      env: {
        VITEST_MAX_WORKERS: "4",
        BB_RESOURCE_CPU_QUOTA_PERCENT: "100",
        BB_RESOURCE_MEMORY_MAX_BYTES: String(1024 ** 3),
        BB_RESOURCE_MEMORY_HIGH_BYTES: String(768 * 1024 ** 2),
      },
    },
  ]) {
    const directory = join(temporary, item.name);
    mkdirSync(directory);
    const unit = `bb-worker-bridge-${randomUUID()}`;
    units.push(`${unit}.scope`);
    const wrapper = join(directory, "run-resource-isolated");
    const actualWrapper = readFileSync(
      new URL("./run-resource-isolated", import.meta.url),
      "utf8",
    );
    const marker = "unit_name='bb-local-verification'";
    assert.ok(
      actualWrapper.includes(marker),
      "micro fixture requires a replaceable resource unit name",
    );
    writeFileSync(
      wrapper,
      actualWrapper.replace(marker, `unit_name='${unit}'`),
    );
    chmodSync(wrapper, 0o755);
    for (const name of ["resource-runtime.mjs", "resource-profile.mjs"])
      writeFileSync(
        join(directory, name),
        readFileSync(new URL(`./${name}`, import.meta.url)),
      );
    const command = item.nested
      ? [
          process.execPath,
          "--input-type=module",
          "-e",
          `import {spawnSync} from 'node:child_process';const r=spawnSync(${JSON.stringify(wrapper)},['--profile','package','--',process.execPath,'--input-type=module','-e',${JSON.stringify(code)}],{env:{...process.env,VITEST_MAX_WORKERS:${JSON.stringify(item.nested)},BB_RESOURCE_VITEST_WORKERS:'99'},stdio:'inherit'});process.exit(r.status??1)`,
        ]
      : [process.execPath, "--input-type=module", "-e", code];
    const child = spawnSync(
      wrapper,
      ["--profile", "package", "--", ...command],
      {
        cwd: repo,
        env: { ...env, ...item.env },
        encoding: "utf8",
        timeout: 18000,
      },
    );
    assert.equal(child.status, 0, `${item.name}: ${child.stderr}`);
    const line = child.stdout
      .split("\n")
      .find((value) => value.startsWith("WORKER_RESULT="));
    assert.ok(line, child.stdout);
    const observed = JSON.parse(line.slice("WORKER_RESULT=".length));
    assert.equal(observed.projects.length, 2, item.name);
    for (const project of observed.projects)
      assert.equal(
        project.workers,
        item.expected,
        `${item.name}: ${project.name}`,
      );
    assert.equal(Number(observed.input), item.expected, item.name);
    assert.equal(observed.budget.vitestWorkers, item.expected, item.name);
    results.push({ name: item.name, ...observed });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  for (const unit of units)
    spawnSync("systemctl", ["--user", "stop", unit], {
      env,
      stdio: "ignore",
      timeout: 5000,
    });
  rmSync(temporary, { recursive: true, force: true });
}
