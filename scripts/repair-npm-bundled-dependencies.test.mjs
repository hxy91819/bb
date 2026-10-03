import assert from "node:assert/strict";
import { once } from "node:events";
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { repairNpmBundledDependencies } from "./repair-npm-bundled-dependencies.mjs";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

test("repairs npm's physical modules and lock metadata while preserving library behavior", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "bb-npm-bundle-repair-"));
  const npmDirectory = join(temporary, "node_modules/npm");
  const runtimeLock = join(temporary, "package-lock.json");
  const require = createRequire(join(repo, "packages/bb-app/package.json"));
  const installedNpm = dirname(require.resolve("npm/package.json"));
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/error" ? 503 : 200);
    response.end(request.url === "/error" ? "unavailable" : "repaired");
  });
  let agent;
  try {
    for (const [name, version] of [
      ["undici", "6.26.0"],
      ["brace-expansion", "5.0.6"],
    ]) {
      const directory = join(npmDirectory, "node_modules", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ name, version, main: "index.js" }),
      );
      await writeFile(
        join(directory, "index.js"),
        "throw new Error('obsolete bundled module');\n",
      );
    }
    await cp(
      join(installedNpm, "node_modules/balanced-match"),
      join(npmDirectory, "node_modules/balanced-match"),
      { recursive: true, dereference: true },
    );
    const entries = {
      "node_modules/undici": { version: "6.26.0" },
      "node_modules/brace-expansion": { version: "5.0.6" },
    };
    await writeFile(
      runtimeLock,
      JSON.stringify({
        packages: Object.fromEntries(
          Object.entries(entries).map(([key, value]) => [
            `node_modules/npm/${key}`,
            value,
          ]),
        ),
      }),
    );
    const originalModule = join(temporary, "original-module.js");
    const originalLock = join(temporary, "original-lock.json");
    await link(
      join(npmDirectory, "node_modules/undici/index.js"),
      originalModule,
    );
    await link(runtimeLock, originalLock);
    await repairNpmBundledDependencies(repo, npmDirectory, runtimeLock);
    assert.equal(
      await readFile(originalModule, "utf8"),
      "throw new Error('obsolete bundled module');\n",
    );
    const untouchedLock = JSON.parse(await readFile(originalLock, "utf8"));
    assert.equal(
      untouchedLock.packages["node_modules/npm/node_modules/undici"].version,
      "6.26.0",
    );
    const repairedRequire = createRequire(join(npmDirectory, "package.json"));
    const { expand } = repairedRequire("brace-expansion");
    assert.deepEqual(expand("file-{a,b}-{1..2}.txt"), [
      "file-a-1.txt",
      "file-a-2.txt",
      "file-b-1.txt",
      "file-b-2.txt",
    ]);
    const { Agent, fetch } = repairedRequire("undici");
    agent = new Agent({ connections: 1 });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal(
      await (await fetch(base, { dispatcher: agent })).text(),
      "repaired",
    );
    const response = await fetch(`${base}/error`, { dispatcher: agent });
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "unavailable");
    for (const [path, prefix] of [
      [runtimeLock, "node_modules/npm/node_modules/"],
    ]) {
      const lock = JSON.parse(await readFile(path, "utf8"));
      assert.equal(lock.packages[`${prefix}undici`].version, "6.28.1");
      assert.equal(lock.packages[`${prefix}brace-expansion`].version, "5.0.12");
    }
    const initialLock = await readFile(runtimeLock, "utf8");
    await repairNpmBundledDependencies(repo, npmDirectory, runtimeLock);
    assert.equal(await readFile(runtimeLock, "utf8"), initialLock);
    await cp(originalLock, runtimeLock);
    await repairNpmBundledDependencies(repo, npmDirectory, runtimeLock);
    assert.equal(await readFile(runtimeLock, "utf8"), initialLock);
  } finally {
    await agent?.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
});
