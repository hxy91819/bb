import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifySdkArtifact } from "./sdk-artifact.mjs";

const [directory, tag, source, repo = "."] = process.argv.slice(2);
const expected = JSON.parse(
  await readFile(
    join(resolve(repo), "packages/plugin-sdk/package.json"),
    "utf8",
  ),
);
const { archive, pkg } = await verifySdkArtifact(
  resolve(directory),
  tag,
  source,
  expected,
);
const temp = await realpath(
  await mkdtemp(join(tmpdir(), "bb-fork-sdk-consumer-")),
);
const env = { ...process.env };
for (const key of [
  "NODE_PATH",
  "NODE_OPTIONS",
  "npm_config_prefix",
  "npm_config_workspace",
])
  delete env[key];
const run = (command, args) =>
  execFileSync(command, args, { cwd: temp, env, stdio: "inherit" });
try {
  await writeFile(
    join(temp, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { [pkg.name]: `file:${archive}`, ...pkg.peerDependencies },
      devDependencies: {
        typescript: expected.devDependencies.typescript,
        "@types/node": expected.devDependencies["@types/node"],
        "@types/react-dom": "^19.0.0",
      },
    }),
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  const installed = join(temp, "node_modules", pkg.name);
  if (!(await realpath(installed)).startsWith(`${temp}/`))
    throw new Error("SDK must be installed independently of checkout");
  const entries = Object.entries(pkg.exports);
  const specifiers = entries.map(
    ([subpath]) => pkg.name + (subpath === "." ? "" : subpath.slice(1)),
  );
  await writeFile(
    join(temp, "runtime.mjs"),
    specifiers
      .map((specifier) => `await import(${JSON.stringify(specifier)});`)
      .join("\n"),
  );
  run(process.execPath, ["runtime.mjs"]);
  await writeFile(
    join(temp, "consumer.ts"),
    specifiers
      .map(
        (specifier, i) =>
          `import * as Entry${i} from ${JSON.stringify(specifier)};\nexport type Surface${i} = typeof Entry${i};`,
      )
      .join("\n"),
  );
  const ts = await import(
    pathToFileURL(join(temp, "node_modules/typescript/lib/typescript.js")).href
  );
  const program = ts.createProgram([join(temp, "consumer.ts")], {
    noEmit: true,
    strict: true,
    skipLibCheck: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    types: ["node"],
    typeRoots: [join(temp, "node_modules/@types")],
  });
  for (const file of program.getSourceFiles()) {
    if (!(await realpath(file.fileName)).startsWith(`${temp}/`))
      throw new Error(
        `Consumer types escaped isolated installation: ${file.fileName}`,
      );
  }
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => temp,
        getNewLine: () => "\n",
      }),
    );
  process.stdout.write(
    `Cold SDK consumer passed: ${specifiers.length} runtime/type entrypoints\n`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
