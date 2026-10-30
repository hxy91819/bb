import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  desktopManifestName,
  compareDesktopVersions,
  verifyDesktopArtifacts,
} from "./windows-desktop.mjs";

const [directoryArg, tag, source] = process.argv.slice(2);
const repo = process.env.GH_REPO;
assert.match(repo ?? "", /^[\w.-]+\/[\w.-]+$/u);
const directory = resolve(directoryArg);
const { manifest, assets } = await verifyDesktopArtifacts(
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
      ...assets.flatMap((name) => ["--pattern", name]),
    ]);
    await verifyDesktopArtifacts(exact, tag, source);
    assert.deepEqual(
      await readFile(join(exact, desktopManifestName)),
      await readFile(join(directory, desktopManifestName)),
      "Published Windows bytes differ from this build; keep published assets unchanged",
    );
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
      const currentAsset = existing.assets.find(
        (asset) => asset.name === desktopManifestName,
      );
      if (!currentAsset && !existing.draft)
        throw new Error("Published Windows feed has no provenance");
      if (currentAsset) {
        const currentDir = join(temp, "current");
        gh([
          "release",
          "download",
          alias,
          "--repo",
          repo,
          "--dir",
          currentDir,
          "--pattern",
          desktopManifestName,
        ]);
        const current = JSON.parse(
          await readFile(join(currentDir, desktopManifestName), "utf8"),
        );
        const comparison = compareDesktopVersions(
          current.version,
          manifest.version,
        );
        if (comparison > 0) {
          console.log("Windows update feed is already newer; keeping it.");
          return;
        }
        if (comparison === 0)
          assert.equal(
            current.source,
            source,
            "Same Windows version has a different source",
          );
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
    const binaries = assets.filter(
      (name) => !metadata(name) && name !== desktopManifestName,
    );
    for (const names of [
      binaries,
      ["latest.yml", "desktop-version-windows.json"],
      [desktopManifestName],
    ]) {
      gh([
        "release",
        "upload",
        alias,
        "--repo",
        repo,
        ...names.map((name) => join(directory, name)),
        "--clobber",
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
      ...assets.flatMap((name) => ["--pattern", name]),
    ]);
    await verifyDesktopArtifacts(readback, tag, source);
    assert.deepEqual(
      await readFile(join(readback, desktopManifestName)),
      await readFile(join(directory, desktopManifestName)),
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
