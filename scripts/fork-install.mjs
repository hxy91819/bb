import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const [root, ...extra] = process.argv.slice(2);
if (!root || extra.length)
  throw new Error("Usage: fork-install.mjs <workspace>");
const cwd = resolve(root);
for (const [command, args] of [
  ["pnpm", ["-C", cwd, "install", "--frozen-lockfile", "--prod=false"]],
  [process.execPath, [resolve(cwd, "scripts/ensure-native-modules.mjs")]],
]) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.signal ?? result.status}`);
  }
}
