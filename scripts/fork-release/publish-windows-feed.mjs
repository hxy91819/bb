import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  desktopManifestName,
  desktopVersion,
  compareDesktopVersions,
  verifyDesktopArtifacts,
} from "./windows-desktop.mjs";

const [directoryArg, tag, source] = process.argv.slice(2);
const repo = process.env.GH_REPO;
assert.match(repo ?? "", /^[\w.-]+\/[\w.-]+$/u);
const directory = resolve(directoryArg);
const { assets: expectedAssets } = await verifyDesktopArtifacts(
  directory,
  tag,
  source,
);
const gh = (args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
async function publish() {
  const temp = await mkdtemp(join(tmpdir(), "bb-windows-release-"));
  try {
    const exact = join(temp, "immutable");
    gh([
      "release",
      "download",
      tag,
      "--repo",
      repo,
      "--dir",
      exact,
      ...expectedAssets.flatMap((name) => ["--pattern", name]),
    ]);
    const { manifest, assets } = await verifyDesktopArtifacts(
      exact,
      tag,
      source,
    );
    const watermarkPrefix = "bb-fork-windows-watermark-";
    const watermarkName = `${watermarkPrefix}${manifest.version}.json`;
    const alias = "fork-desktop-latest";
    const response = spawnSync(
      "gh",
      ["api", `repos/${repo}/releases/tags/${alias}`],
      { encoding: "utf8" },
    );
    let existing;
    if (response.status === 0) existing = JSON.parse(response.stdout);
    else {
      let error;
      try {
        error = JSON.parse(response.stdout);
      } catch {}
      if (error?.status !== "404" && error?.status !== 404)
        throw new Error(
          `Cannot inspect Windows feed release: ${response.stderr}`,
        );
      if (error.message !== "Not Found")
        throw new Error("Ambiguous Windows feed release lookup");
    }
    if (existing) {
      assert.ok(Number.isSafeInteger(existing.id) && existing.id > 0);
      const pages = JSON.parse(
        gh([
          "api",
          "--paginate",
          "--slurp",
          `repos/${repo}/releases/${existing.id}/assets?per_page=100`,
        ]),
      );
      assert.ok(Array.isArray(pages) && pages.every(Array.isArray));
      existing.assets = pages.flat();
      const checkpoints = existing.assets
        .map((asset) => asset.name)
        .filter(
          (name) =>
            name === desktopManifestName ||
            (typeof name === "string" &&
              /^bb-fork-windows-watermark-[0-9][a-zA-Z0-9._-]*\.json$/u.test(
                name,
              )),
        );
      if (checkpoints.length === 0 && !existing.draft)
        throw new Error(
          "Published Windows feed has no provenance or version watermark",
        );
      if (checkpoints.length) {
        const currentDir = join(temp, "current");
        gh([
          "release",
          "download",
          alias,
          "--repo",
          repo,
          "--dir",
          currentDir,
          ...checkpoints.flatMap((name) => ["--pattern", name]),
        ]);
        for (const name of checkpoints) {
          const current = JSON.parse(
            await readFile(join(currentDir, name), "utf8"),
          );
          assert.equal(current.version, desktopVersion(current.tag));
          if (name !== desktopManifestName)
            assert.equal(name, `${watermarkPrefix}${current.version}.json`);
          assert.match(current.source, /^[a-f0-9]{40}$/u);
          const comparison = compareDesktopVersions(
            current.version,
            manifest.version,
          );
          if (comparison > 0) {
            console.log(
              "Windows update feed has a newer published or reserved version; keeping it.",
            );
            return;
          }
          if (comparison === 0)
            assert.equal(
              current.source,
              source,
              "Same Windows version has a different source",
            );
        }
      }
    } else {
      gh([
        "release",
        "create",
        alias,
        "--repo",
        repo,
        "--target",
        source,
        "--draft",
        "--title",
        "BB fork Windows desktop updates",
        "--notes",
        `Windows update channel. Immutable release: ${tag}; source ${source}.`,
      ]);
    }
    const watermark = { tag, source, version: manifest.version };
    await writeFile(
      join(exact, watermarkName),
      JSON.stringify(watermark) + "\n",
    );
    const binaries = assets.filter(
      (name) => !metadata(name) && name !== desktopManifestName,
    );
    for (const names of [
      [watermarkName],
      binaries,
      ["latest.yml", "desktop-version-windows.json"],
      [desktopManifestName],
    ]) {
      const isWatermark = names[0] === watermarkName;
      if (
        isWatermark &&
        existing?.assets.some((asset) => asset.name === watermarkName)
      )
        continue;
      gh([
        "release",
        "upload",
        alias,
        "--repo",
        repo,
        ...names.map((name) => join(exact, name)),
        ...(isWatermark ? [] : ["--clobber"]),
      ]);
    }
    gh([
      "release",
      "edit",
      alias,
      "--repo",
      repo,
      "--draft=false",
      "--latest=false",
      "--notes",
      `Windows update channel ${manifest.version}, source ${source}. Immutable release: https://github.com/${repo}/releases/tag/${tag}`,
    ]);
    const readback = join(temp, "readback");
    gh([
      "release",
      "download",
      alias,
      "--repo",
      repo,
      "--dir",
      readback,
      ...[...assets, watermarkName].flatMap((name) => ["--pattern", name]),
    ]);
    await verifyDesktopArtifacts(readback, tag, source);
    assert.deepEqual(
      await readFile(join(readback, desktopManifestName)),
      await readFile(join(exact, desktopManifestName)),
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(readback, watermarkName), "utf8")),
      watermark,
    );
    console.log(
      `Verified Windows update channel: https://github.com/${repo}/releases/tag/${alias}`,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
await publish();
function metadata(name) {
  return name === "latest.yml" || name === "desktop-version-windows.json";
}
