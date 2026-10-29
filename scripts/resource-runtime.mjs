import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { detectResources, selectResources } from "./resource-profile.mjs";

const policy = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .update(readFileSync(new URL("./resource-profile.mjs", import.meta.url)))
  .digest("hex");

export function resourceBudget(
  profile,
  inherited = process.env.BB_RESOURCE_BUDGET,
) {
  if (!["verification", "package"].includes(profile))
    throw new Error("Unknown resource profile");
  if (!inherited)
    return {
      policy,
      profile,
      selected: selectResources(detectResources(), process.env),
    };
  const value = JSON.parse(inherited);
  if (
    value.policy !== policy ||
    !["verification", "package"].includes(value.profile)
  )
    throw new Error("Invalid or stale resource budget");
  if (profile === "package" && value.profile !== "package")
    throw new Error(
      "Cannot upgrade an inherited verification budget to package",
    );
  const s = value.selected;
  for (const key of [
    "cpuQuotaPercent",
    "memoryHighBytes",
    "memoryMaxBytes",
    "workers",
    "tasksMax",
    "reserveBytes",
  ]) {
    if (!Number.isSafeInteger(s?.[key]) || s[key] <= 0)
      throw new Error("Invalid inherited resource budget");
  }
  if (
    s.memoryHighBytes > s.memoryMaxBytes ||
    s.memorySwapMaxBytes !== 0 ||
    s.tasksMax !== 1024
  )
    throw new Error("Invalid inherited resource limits");
  return value;
}

function verify(group, selected) {
  const read = (name) =>
    readFileSync(`/sys/fs/cgroup${group}/${name}`, "utf8").trim();
  const page = Number(
    execFileSync("getconf", ["PAGESIZE"], { encoding: "utf8" }).trim(),
  );
  if (!Number.isSafeInteger(page) || page <= 0)
    throw new Error("Unknown kernel page size");
  for (const [name, expected] of [
    ["memory.max", selected.memoryMaxBytes],
    ["memory.high", selected.memoryHighBytes],
    ["memory.swap.max", 0],
    ["pids.max", selected.tasksMax],
  ]) {
    const actual = Number(read(name));
    if (
      !Number.isFinite(actual) ||
      actual > expected ||
      actual < expected - (name.startsWith("memory.") ? page : 1) + 1
    )
      throw new Error(`Resource scope ${name} differs from frozen budget`);
  }
  const [quota, period] = read("cpu.max").split(/\s+/).map(Number);
  if (
    !Number.isFinite(quota) ||
    !Number.isFinite(period) ||
    quota <= 0 ||
    period <= 0 ||
    Math.abs((quota / period) * 100 - selected.cpuQuotaPercent) > 0.01
  )
    throw new Error("Resource scope CPU quota differs from frozen budget");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [command, profile, group] = process.argv.slice(2);
    const budget = resourceBudget(profile);
    if (command === "select") console.log(JSON.stringify(budget));
    else if (command === "fields")
      console.log(
        [
          budget.selected.memoryHighBytes,
          budget.selected.memoryMaxBytes,
          budget.selected.cpuQuotaPercent,
          budget.selected.workers,
          budget.selected.tasksMax,
        ].join(" "),
      );
    else if (command === "verify") verify(group, budget.selected);
    else
      throw new Error(
        "Usage: resource-runtime.mjs select|fields|verify <profile> [cgroup]",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
