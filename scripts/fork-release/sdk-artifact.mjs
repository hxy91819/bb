import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function validateTarget(tag, source) {
  if (
    !/^fork-v[0-9][A-Za-z0-9._-]*$/u.test(tag ?? "") ||
    !/^[a-f0-9]{40}$/u.test(source ?? "")
  )
    throw new Error("Expected fork tag and full 40-character source SHA");
}

export function checkSource(repo, tag, source) {
  validateTarget(tag, source);
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  if (git("rev-parse", "HEAD") !== source)
    throw new Error("Source SHA does not match checkout HEAD");
  const tags = git("tag", "--list", tag);
  if (tags && git("rev-parse", `refs/tags/${tag}^{commit}`) !== source)
    throw new Error("Tag does not match source SHA");
  if (git("status", "--porcelain", "--untracked-files=all"))
    throw new Error(
      "Source checkout must be clean (including untracked files)",
    );
}

export async function verifySdkArtifact(
  directory,
  tag,
  source,
  expectedPackage,
) {
  validateTarget(tag, source);
  const stem = `bb-plugin-sdk-${tag}`;
  const filename = `${stem}.tgz`;
  const archive = join(directory, filename);
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (
    (await readFile(`${archive}.sha256`, "utf8")) !== `${digest}  ${filename}\n`
  )
    throw new Error("SDK checksum mismatch");
  const provenance = JSON.parse(
    await readFile(join(directory, `${stem}.json`), "utf8"),
  );
  const pkg = JSON.parse(
    execFileSync("tar", ["-xOf", archive, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  if (
    provenance.tag !== tag ||
    provenance.source !== source ||
    provenance.filename !== filename ||
    provenance.sha256 !== digest ||
    provenance.package !== pkg.name ||
    provenance.version !== pkg.version ||
    pkg.name !== expectedPackage.name ||
    pkg.version !== expectedPackage.version
  )
    throw new Error(
      "SDK provenance does not match tag/source/package/version/hash",
    );
  return { archive, pkg };
}
