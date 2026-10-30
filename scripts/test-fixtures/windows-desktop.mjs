import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
export function writeDesktopFixture(directory, tag, source, options = {}) {
  const version = tag
    .replace(/^fork-v/u, "")
    .replace(/-(\d{8})\.(\d+)$/u, "-fork.$1.$2");
  const executable = `bb-${version}-x64.exe`;
  const bytes = Buffer.from(options.installer ?? "installer fixture");
  const hash = (b, alg = "sha256", encoding = "hex") =>
    createHash(alg).update(b).digest(encoding);
  const metadata = {
    version,
    files: [
      {
        url: executable,
        sha512: hash(bytes, "sha512", "base64"),
        size: bytes.length,
      },
    ],
    path: executable,
    sha512: hash(bytes, "sha512", "base64"),
    releaseDate: "2026-10-30T00:00:00.000Z",
  };
  mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries({
    [executable]: bytes,
    [`${executable}.blockmap`]: "blockmap",
    [`${executable}.sha256`]: `${hash(bytes)}  ${executable}\n`,
    "latest.yml": JSON.stringify(metadata),
    "desktop-version-windows.json": JSON.stringify({
      ...metadata,
      platform: "windows",
      channel: "latest",
      schemaVersion: 1,
    }),
  }))
    writeFileSync(join(directory, name), value);
  const names = [
    "latest.yml",
    "desktop-version-windows.json",
    executable,
    `${executable}.blockmap`,
    `${executable}.sha256`,
  ];
  writeFileSync(
    join(directory, "bb-fork-windows.json"),
    JSON.stringify({
      schemaVersion: 1,
      tag,
      source,
      version,
      platform: "windows",
      arch: "x64",
      files: names.map((name) => {
        const bytes = readFileSync(join(directory, name));
        return { name, size: bytes.length, sha256: hash(bytes) };
      }),
    }),
  );
  return names.concat("bb-fork-windows.json");
}
