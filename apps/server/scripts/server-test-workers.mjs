import { availableParallelism, freemem } from "node:os";
import { detectResources } from "../../../scripts/resource-profile.mjs";

export function serverTestWorkers({
  env = process.env,
  detect = process.platform === "linux"
    ? detectResources
    : () => ({
        effectiveCpus: availableParallelism(),
        availableBytes: freemem(),
      }),
} = {}) {
  const text = env.VITEST_MAX_WORKERS;
  if (text === undefined) return 1;
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new Error("VITEST_MAX_WORKERS must be a positive integer");
  const capacity = detect();
  const memory = Math.min(
    capacity.availableBytes,
    capacity.cgroupHeadroomBytes ?? Infinity,
  );
  if (!(capacity.effectiveCpus > 0) || !(memory > 0))
    throw new Error("No effective capacity for Vitest workers");
  const selected = Math.min(
    Number(text),
    Math.max(1, Math.floor(capacity.effectiveCpus)),
    Math.max(1, Math.floor(memory / (2 * 1024 ** 3))),
  );
  env.VITEST_MAX_WORKERS = String(selected);
  return selected;
}
