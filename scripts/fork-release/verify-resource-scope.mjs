import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const group = readFileSync("/proc/self/cgroup", "utf8")
  .split("\n")
  .find((line) => line.startsWith("0::"))
  ?.slice(3);
assert.ok(group?.endsWith("/bb-local-verification.scope"));
const selected = JSON.parse(process.env.BB_RESOURCE_BUDGET).selected;
const kernel = Object.fromEntries(
  ["cpu.max", "memory.high", "memory.max", "memory.swap.max", "pids.max"].map(
    (name) => [
      name,
      readFileSync(`/sys/fs/cgroup${group}/${name}`, "utf8").trim(),
    ],
  ),
);
const [quota, period] = kernel["cpu.max"].split(/\s+/).map(Number);
assert.ok(
  quota > 0 &&
    period > 0 &&
    Math.abs((quota / period) * 100 - selected.cpuQuotaPercent) < 0.01,
);
assert.equal(Number(kernel["memory.high"]), selected.memoryHighBytes);
assert.equal(Number(kernel["memory.max"]), selected.memoryMaxBytes);
assert.equal(Number(kernel["memory.swap.max"]), 0);
assert.equal(Number(kernel["pids.max"]), selected.tasksMax);
console.log(JSON.stringify({ group, selected, kernel }, null, 2));
