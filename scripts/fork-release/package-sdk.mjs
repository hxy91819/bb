import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkSource, verifySdkArtifact } from "./sdk-artifact.mjs";

const [repoArg, outputArg, tag, source] = process.argv.slice(2);
if (!repoArg || !outputArg)
  throw new Error(
    "Usage: node package-sdk.mjs <repo> <output> <fork-tag> <source-sha>",
  );
const repo = resolve(repoArg);
const output = resolve(outputArg);
checkSource(repo, tag, source);
const temp = await mkdtemp(join(tmpdir(), "bb-fork-sdk-pack-"));
const run = (args, cwd = repo) =>
  execFileSync("pnpm", args, { cwd, stdio: "inherit" });
try {
  run([
    "exec",
    "turbo",
    "run",
    "build:types",
    "build:runtime",
    "--filter=@get-bb/plugin-sdk",
    "--concurrency=1",
    "--output-logs=errors-only",
  ]);
  run(["pack", "--pack-destination", temp], join(repo, "packages/plugin-sdk"));
  checkSource(repo, tag, source);
  const pkg = JSON.parse(
    await readFile(join(repo, "packages/plugin-sdk/package.json"), "utf8"),
  );
  const stem = `bb-plugin-sdk-${tag}`;
  const filename = `${stem}.tgz`;
  const packed = join(
    temp,
    `${pkg.name.replace(/^@/u, "").replaceAll("/", "-")}-${pkg.version}.tgz`,
  );
  const digest = createHash("sha256")
    .update(await readFile(packed))
    .digest("hex");
  await rename(packed, join(temp, filename));
  await writeFile(join(temp, `${filename}.sha256`), `${digest}  ${filename}\n`);
  await writeFile(
    join(temp, `${stem}.json`),
    JSON.stringify(
      {
        tag,
        source,
        package: pkg.name,
        version: pkg.version,
        filename,
        sha256: digest,
      },
      null,
      2,
    ) + "\n",
  );
  await verifySdkArtifact(temp, tag, source, pkg);
  await mkdir(output, { recursive: true });
  for (const name of [filename, `${filename}.sha256`, `${stem}.json`])
    await copyFile(join(temp, name), join(output, name));
  process.stdout.write(`${join(output, filename)}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
