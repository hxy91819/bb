import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { serverTestWorkers } from "./server-test-workers.mjs";

const G = 1024 ** 3;
test("worker selection keeps legacy default, validates explicit values and caps effective capacity", () => {
  const detect = () => ({ effectiveCpus: 32, availableBytes: 40 * G });
  assert.equal(serverTestWorkers({ env: {}, detect }), 1);
  assert.equal(
    serverTestWorkers({ env: { VITEST_MAX_WORKERS: "4" }, detect }),
    4,
  );
  assert.equal(
    serverTestWorkers({
      env: { VITEST_MAX_WORKERS: "4" },
      detect: () => ({ effectiveCpus: 1.5, availableBytes: 40 * G }),
    }),
    1,
  );
  assert.equal(
    serverTestWorkers({
      env: { VITEST_MAX_WORKERS: "4" },
      detect: () => ({
        effectiveCpus: 32,
        availableBytes: 40 * G,
        cgroupHeadroomBytes: 3 * G,
      }),
    }),
    1,
  );
  for (const text of ["0", "-1", "1.5", "4oops", ""])
    assert.throws(() =>
      serverTestWorkers({ env: { VITEST_MAX_WORKERS: text }, detect }),
    );
});

test("real createVitest resolves all projects with environment, CI shard, and restricted affinity", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cwd = path.resolve(root, "../..");
  const code = `import {createVitest} from 'vitest/node';const c=await createVitest('test',{root:${JSON.stringify(root)},watch:false});try{console.log('CONFIG_RESULT='+JSON.stringify({root:c.config.maxWorkers,shard:c.config.shard,projects:c.projects.map(p=>({name:p.name,maxWorkers:p.config.maxWorkers,isolate:p.config.isolate})),files:(await c.globTestSpecifications()).map(s=>[s.project.name,s.moduleId,s.project.config.isolate]).sort()}))}finally{await c.close()}`;
  const cases = [
    { name: "host4", workers: "4", expected: 4 },
    { name: "explicit2", workers: "2", expected: 2 },
    { name: "default", expected: 1 },
    { name: "CI-shard", workers: "4", shard: "1/3", expected: 4 },
  ];
  if (process.platform === "linux")
    cases.push({
      name: "one-CPU-affinity",
      workers: "4",
      expected: 1,
      affinity: fs
        .readFileSync("/proc/self/status", "utf8")
        .match(/^Cpus_allowed_list:\s+(\d+)/m)[1],
    });
  const results = [];
  for (const item of cases) {
    const env = { ...process.env, CI: "1" };
    delete env.VITEST_MAX_WORKERS;
    delete env.BB_CI_TEST_SHARD;
    if (item.workers) env.VITEST_MAX_WORKERS = item.workers;
    if (item.shard) env.BB_CI_TEST_SHARD = item.shard;
    const args = ["--input-type=module", "-e", code];
    const child = item.affinity
      ? spawnSync("taskset", ["-c", item.affinity, process.execPath, ...args], {
          cwd,
          env,
          encoding: "utf8",
        })
      : spawnSync(process.execPath, args, { cwd, env, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    const line = child.stdout
      .split("\n")
      .find((x) => x.startsWith("CONFIG_RESULT="));
    const result = JSON.parse(line.slice("CONFIG_RESULT=".length));
    assert.ok(result.projects.length >= 2);
    for (const project of result.projects)
      assert.equal(project.maxWorkers, item.expected, item.name);
    if (item.shard) assert.deepEqual(result.shard, { index: 1, count: 3 });
    if (results.length) assert.deepEqual(result.files, results[0].result.files);
    results.push({ case: item.name, result });
  }
  if (process.env.BB_WORKER_CONFIG_EVIDENCE)
    fs.writeFileSync(
      process.env.BB_WORKER_CONFIG_EVIDENCE,
      JSON.stringify(results, null, 2),
    );
});
