import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GiB = 1024 ** 3;

export function selectResources(input, env = {}) {
  for (const key of ['effectiveCpus', 'totalBytes', 'availableBytes']) {
    if (!Number.isFinite(input[key]) || input[key] <= 0) throw new Error(`Invalid ${key}`);
  }
  const headroom = input.cgroupHeadroomBytes ?? Infinity;
  if (!(headroom > 0)) throw new Error('No cgroup memory headroom');
  const reserveBytes = Math.min(8 * GiB, Math.max(GiB, input.totalBytes / 4));
  const safeMax = Math.min(input.totalBytes - reserveBytes, input.availableBytes - reserveBytes, headroom * 0.8);
  const quantum = 64 * 1024 ** 2;
  const fallbackMax = Math.floor(Math.min(input.totalBytes / 2, safeMax) / quantum) * quantum;
  const override = (name, fallback) => {
    if (env[name] === undefined) return fallback;
    if (!/^\d+$/.test(env[name])) throw new Error(`Invalid override ${name}`);
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid override ${name}`);
    return value;
  };
  const memoryMaxBytes = override('BB_RESOURCE_MEMORY_MAX_BYTES', fallbackMax);
  const memoryHighBytes = override('BB_RESOURCE_MEMORY_HIGH_BYTES', Math.floor(memoryMaxBytes * 0.75 / quantum) * quantum);
  const cpuQuotaPercent = override('BB_RESOURCE_CPU_QUOTA_PERCENT', Math.max(1, Math.floor(input.effectiveCpus * 50)));
  const workers = override('BB_RESOURCE_VITEST_WORKERS', Math.max(1, Math.floor(Math.min(cpuQuotaPercent / 400, memoryHighBytes / (2 * GiB)))));
  if (memoryMaxBytes < 512 * 1024 ** 2 || memoryMaxBytes > safeMax || memoryHighBytes <= 0 || memoryHighBytes > memoryMaxBytes) throw new Error('Insufficient safe memory or unsafe memory override');
  if (cpuQuotaPercent > input.effectiveCpus * 100 || workers > Math.max(1, Math.floor(cpuQuotaPercent / 100))) throw new Error('CPU or worker override exceeds effective capacity');
  return { cpuQuotaPercent, memoryHighBytes, memoryMaxBytes, workers, memorySwapMaxBytes: 0, tasksMax: 1024, reserveBytes };
}

export function detectResources({ read = p => fs.readFileSync(p, 'utf8'), effectiveCpus = os.availableParallelism(), totalBytes = os.totalmem() } = {}) {
  const availableBytes = Number(read('/proc/meminfo').match(/^MemAvailable:\s+(\d+) kB$/m)?.[1]) * 1024;
  const relative = read('/proc/self/cgroup').split('\n').find(line => line.startsWith('0::'))?.slice(3);
  if (relative === undefined) throw new Error('cgroup v2 is required');
  let dir = path.join('/sys/fs/cgroup', relative);
  let cpus = effectiveCpus;
  let cgroupHeadroomBytes = Infinity;
  const ancestors = [];
  while (dir !== "/sys/fs/cgroup") {
    const cpu = read(path.join(dir, 'cpu.max')).trim().split(/\s+/);
    const current = Number(read(path.join(dir, 'memory.current')).trim());
    if (!Number.isFinite(current) || current < 0) throw new Error('Invalid cgroup memory.current');
    if (cpu[0] !== 'max') {
      const quota = Number(cpu[0]) / Number(cpu[1]);
      if (!(quota > 0) || !Number.isFinite(quota)) throw new Error('Invalid cgroup cpu.max');
      cpus = Math.min(cpus, quota);
    }
    const entry = { path: dir, cpuMax: cpu.join(' '), memoryCurrentBytes: current };
    for (const file of ['memory.max', 'memory.high']) {
      const text = read(path.join(dir, file)).trim();
      if (text !== 'max') {
        const limit = Number(text);
        if (!Number.isFinite(limit) || limit < 0) throw new Error(`Invalid ${file}`);
        cgroupHeadroomBytes = Math.min(cgroupHeadroomBytes, Math.max(0, limit - current));
      }
      entry[file] = text;
    }
    ancestors.push(entry);
    if (dir === '/sys/fs/cgroup') break;
    dir = path.dirname(dir);
  }
  return { effectiveCpus: cpus, totalBytes, availableBytes, cgroupHeadroomBytes: Number.isFinite(cgroupHeadroomBytes) ? cgroupHeadroomBytes : undefined, ancestors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const detected = detectResources();
  process.stdout.write(`${JSON.stringify({ detected, selected: selectResources(detected, process.env) }, null, 2)}\n`);
}
