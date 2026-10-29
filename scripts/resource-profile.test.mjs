import { test } from "node:test";
import assert from "node:assert/strict";
import { selectResources, detectResources } from "./resource-profile.mjs";
const G = 1024 ** 3;
const host = { effectiveCpus: 32, totalBytes: 62 * G, availableBytes: 42 * G };
test("large and small hosts retain reserve and use effective capacity", () => {
  const large = selectResources(host);
  assert.equal(large.cpuQuotaPercent, 1600);
  assert.equal(large.workers, 4);
  assert.equal(large.memoryMaxBytes, 31 * G);
  const small = selectResources({
    effectiveCpus: 2,
    totalBytes: 4 * G,
    availableBytes: 2 * G,
  });
  assert.equal(small.cpuQuotaPercent, 100);
  assert.equal(small.workers, 1);
  assert.equal(small.memoryMaxBytes, G);
  assert.throws(
    () => selectResources({ ...host, availableBytes: G }),
    /memory/,
  );
});
test("overrides cannot bypass effective limits or reserve", () => {
  assert.equal(
    selectResources(host, { BB_RESOURCE_VITEST_WORKERS: "2" }).workers,
    2,
  );
  for (const env of [
    { BB_RESOURCE_MEMORY_MAX_BYTES: String(60 * G) },
    { BB_RESOURCE_CPU_QUOTA_PERCENT: "3300" },
    { BB_RESOURCE_VITEST_WORKERS: "20" },
    { BB_RESOURCE_CPU_QUOTA_PERCENT: "NaN" },
  ])
    assert.throws(() => selectResources(host, env));
});
test("ancestor quotas and memory usage constrain selection even if child is unlimited", () => {
  const read = (p) => {
    if (p === "/proc/meminfo") return "MemAvailable: 44040192 kB\n";
    if (p === "/proc/self/cgroup") return "0::/parent/child\n";
    if (p === "/sys/fs/cgroup/cpu.max") throw new Error("Root has no cpu.max");
    if (p.endsWith("cpu.max"))
      return p.includes("/parent/cpu.max") ? "150000 100000" : "max 100000";
    if (p.endsWith("memory.current")) return String(G);
    if (p.endsWith("memory.max"))
      return p.includes("/parent/memory.max") ? String(5 * G) : "max";
    if (p.endsWith("memory.high")) return "max";
    throw new Error(p);
  };
  const detected = detectResources({
    read,
    effectiveCpus: 32,
    totalBytes: 62 * G,
  });
  assert.equal(detected.effectiveCpus, 1.5);
  assert.equal(detected.cgroupHeadroomBytes, 4 * G);
  const chosen = selectResources(detected);
  assert.equal(chosen.cpuQuotaPercent, 75);
  assert.ok(chosen.memoryMaxBytes <= 3.2 * G);
});

test("ancestor memory high and unavailable headroom are enforced", () => {
  const selected = selectResources({ ...host, cgroupHeadroomBytes: 2 * G });
  assert.ok(selected.memoryMaxBytes <= 1.6 * G);
  assert.throws(
    () => selectResources({ ...host, cgroupHeadroomBytes: 0 }),
    /headroom/,
  );
});

test("disabled child controllers inherit verifiable ancestor limits while unreadable metadata refuses detection", () => {
  const read = (p) => {
    if (p === "/proc/meminfo") return "MemAvailable: 44040192 kB\n";
    if (p === "/proc/self/cgroup") return "0::/parent/child\n";
    if (p.endsWith("/child/cgroup.events")) return "populated 1\n";
    if (p.endsWith("/parent/cgroup.subtree_control")) return "";
    if (p.includes("/child/")) {
      const error = new Error("controller disabled");
      error.code = "ENOENT";
      throw error;
    }
    if (p.endsWith("cpu.max")) return "200000 100000";
    if (p.endsWith("memory.current")) return String(G);
    if (p.endsWith("memory.max")) return String(5 * G);
    if (p.endsWith("memory.high")) return "max";
    throw new Error(p);
  };
  const detected = detectResources({
    read,
    effectiveCpus: 32,
    totalBytes: 62 * G,
  });
  assert.equal(detected.effectiveCpus, 2);
  assert.equal(detected.cgroupHeadroomBytes, 4 * G);
  assert.throws(
    () =>
      detectResources({
        read: (p) =>
          p.endsWith("cgroup.subtree_control")
            ? (() => {
                throw Error("metadata unavailable");
              })()
            : read(p),
        effectiveCpus: 32,
        totalBytes: 62 * G,
      }),
    /metadata unavailable/,
  );
});
