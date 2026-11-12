import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const require = createRequire(__filename);
const builderRequire = createRequire(
  require.resolve("electron-builder/package.json"),
);
const libraryRequire = createRequire(
  builderRequire.resolve("app-builder-lib/package.json"),
);
const asar: {
  createPackage(
    source: string,
    destination: string,
  ): Promise<NodeJS.WritableStream>;
  listPackage(archive: string, options: { isPack: boolean }): string[];
  extractFile(archive: string, filename: string): Buffer;
  uncache(archive: string): boolean;
} = libraryRequire("@electron/asar");

it("packs nested application files through the desktop archive dependency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-asar-packaging-"));
  const source = join(directory, "app");
  const archive = join(directory, "app.asar");
  try {
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({ name: "fixture", main: "assets/main.js" }),
    );
    await writeFile(
      join(source, "assets/main.js"),
      "module.exports = 'packaged';",
    );
    await asar.createPackage(source, archive);
    expect(
      asar
        .listPackage(archive, { isPack: false })
        .map((entry) => entry.replaceAll("\\", "/")),
    ).toEqual(expect.arrayContaining(["/package.json", "/assets/main.js"]));
    expect(asar.extractFile(archive, "assets/main.js").toString()).toBe(
      "module.exports = 'packaged';",
    );
  } finally {
    asar.uncache(archive);
    await rm(directory, { recursive: true, force: true });
  }
});
