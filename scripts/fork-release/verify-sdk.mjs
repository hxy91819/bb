import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { verifySdkArtifact } from "./sdk-artifact.mjs";

const [directory, tag, source, repo = "."] = process.argv.slice(2);
const pkg = JSON.parse(
  await readFile(
    join(resolve(repo), "packages/plugin-sdk/package.json"),
    "utf8",
  ),
);
await verifySdkArtifact(resolve(directory), tag, source, pkg);
process.stdout.write(`SDK artifact verified: ${tag} ${source}\n`);
