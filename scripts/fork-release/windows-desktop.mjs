import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkSource } from "./sdk-artifact.mjs";

export const desktopManifestName = "bb-fork-windows.json";
const metadataNames = ["latest.yml", "desktop-version-windows.json"];
const digest = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);

export function desktopVersion(tag) {
  const match = /^fork-v(\d+\.\d+\.\d+)-(\d{8})\.(\d+)$/u.exec(tag);
  if (!match)
    throw new Error(
      "Windows desktop requires a dated fork-vX.Y.Z-YYYYMMDD.N tag",
    );
  return `${match[1]}-fork.${match[2]}.${match[3]}`;
}

export function compareDesktopVersions(left, right) {
  const parts = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)-fork\.(\d{8})\.(\d+)$/u.exec(value);
    if (!match) throw new Error(`Invalid fork desktop version: ${value}`);
    return match.slice(1).map(BigInt);
  };
  const a = parts(left),
    b = parts(right);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function assetName(name) {
  assert.equal(typeof name, "string");
  assert.ok(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(name),
    "Invalid Windows asset name",
  );
  assert.equal(basename(name), name);
  return name;
}

export async function verifyDesktopArtifacts(directory, tag, source) {
  assert.match(source, /^[a-f0-9]{40}$/u);
  const manifest = JSON.parse(
    await readFile(join(directory, desktopManifestName), "utf8"),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.tag, tag);
  assert.equal(manifest.source, source);
  assert.equal(manifest.version, desktopVersion(tag));
  assert.equal(manifest.platform, "windows");
  assert.equal(manifest.arch, "x64");
  assert.ok(Array.isArray(manifest.files));
  const names = manifest.files.map((file) => assetName(file.name));
  assert.equal(new Set(names).size, names.length, "Duplicate Windows assets");
  const executables = names.filter((name) => name.endsWith(".exe"));
  assert.equal(executables.length, 1, "Expected one Windows installer");
  const executable = executables[0];
  assert.ok(
    executable.includes(manifest.version),
    "Installer version mismatch",
  );
  assert.deepEqual(
    [...names].sort(),
    [
      ...metadataNames,
      executable,
      `${executable}.sha256`,
      `${executable}.blockmap`,
    ].sort(),
  );
  for (const file of manifest.files) {
    const bytes = await readFile(join(directory, file.name));
    assert.ok(bytes.length > 0);
    assert.equal(file.size, bytes.length, `Size mismatch: ${file.name}`);
    assert.equal(file.sha256, digest(bytes), `Checksum mismatch: ${file.name}`);
  }
  const bytes = await readFile(join(directory, executable));
  assert.equal(
    (await readFile(join(directory, `${executable}.sha256`), "utf8")).trim(),
    `${digest(bytes)}  ${executable}`,
  );
  const feed = JSON.parse(
    await readFile(join(directory, "desktop-version-windows.json"), "utf8"),
  );
  assert.equal(feed.version, manifest.version);
  assert.equal(feed.platform, "windows");
  assert.equal(feed.channel, "latest");
  assert.equal(feed.path, executable);
  assert.equal(feed.sha512, digest(bytes, "sha512", "base64"));
  assert.equal(feed.files.length, 1);
  assert.equal(feed.files[0].url, executable);
  assert.equal(feed.files[0].size, bytes.length);
  assert.equal(feed.files[0].sha512, feed.sha512);
  return { manifest, assets: [...names, desktopManifestName] };
}

async function configure(repo, tag, source) {
  checkSource(repo, tag, source);
  const file = join(repo, "apps/desktop/package.json");
  const pkg = JSON.parse(await readFile(file, "utf8"));
  const version = desktopVersion(tag);
  assert.ok(
    version.startsWith(`${pkg.version}-fork.`),
    "Tag does not match desktop base version",
  );
  pkg.version = version;
  await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
  process.stdout.write(`${version}\n`);
}

async function stage(repo, output, tag, source) {
  const directory = join(repo, "apps/desktop/release");
  const require = createRequire(join(repo, "apps/desktop/package.json"));
  const { parse } = require("yaml");
  const yaml = parse(await readFile(join(directory, "latest.yml"), "utf8"));
  assert.equal(yaml.version, desktopVersion(tag));
  assert.equal(yaml.files.length, 1);
  const executable = assetName(yaml.path);
  const bytes = await readFile(join(directory, executable));
  assert.equal(yaml.sha512, digest(bytes, "sha512", "base64"));
  assert.equal(yaml.files[0].url, executable);
  assert.equal(yaml.files[0].size, bytes.length);
  assert.equal(yaml.files[0].sha512, yaml.sha512);
  await mkdir(output, { recursive: true });
  for (const name of [...metadataNames, executable, `${executable}.blockmap`])
    await copyFile(join(directory, name), join(output, name));
  await writeFile(
    join(output, `${executable}.sha256`),
    `${digest(bytes)}  ${executable}\n`,
  );
  const names = [
    ...metadataNames,
    executable,
    `${executable}.blockmap`,
    `${executable}.sha256`,
  ];
  const files = [];
  for (const name of names) {
    const data = await readFile(join(output, name));
    files.push({ name, size: data.length, sha256: digest(data) });
  }
  await writeFile(
    join(output, desktopManifestName),
    JSON.stringify(
      {
        schemaVersion: 1,
        tag,
        source,
        version: desktopVersion(tag),
        platform: "windows",
        arch: "x64",
        files,
      },
      null,
      2,
    ) + "\n",
  );
  await verifyDesktopArtifacts(output, tag, source);
  assert.deepEqual(
    (await readdir(output)).sort(),
    [...names, desktopManifestName].sort(),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [command, directory, tag, source, output] = process.argv.slice(2);
  if (!directory || !tag || !source)
    throw new Error(
      "Usage: windows-desktop.mjs configure|stage|verify <directory> <tag> <source> [output]",
    );
  if (command === "configure") await configure(resolve(directory), tag, source);
  else if (command === "stage" && output)
    await stage(resolve(directory), resolve(output), tag, source);
  else if (command === "verify") {
    const { assets } = await verifyDesktopArtifacts(
      resolve(directory),
      tag,
      source,
    );
    process.stdout.write(assets.join("\n") + "\n");
  } else throw new Error("Unknown Windows desktop command");
}
