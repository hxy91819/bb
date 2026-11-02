import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  desktopVersion,
  compareDesktopVersions,
  verifyDesktopArtifacts,
} from "./windows-desktop.mjs";
import { writeDesktopFixture } from "../test-fixtures/windows-desktop.mjs";
const tag = "fork-v1.0.0-20261030.2",
  source = "a".repeat(40);

test("fork desktop versions advance within an upstream version", () => {
  assert.equal(desktopVersion(tag), "1.0.0-fork.20261030.2");
  assert.ok(
    compareDesktopVersions("1.0.0-fork.20261030.10", "1.0.0-fork.20261030.2") >
      0,
  );
  assert.ok(
    compareDesktopVersions("1.1.0-fork.20261001.1", "1.0.0-fork.20261030.2") >
      0,
  );
  assert.throws(() => desktopVersion("fork-v1-test"));
  assert.throws(() => compareDesktopVersions("1.0.0", "1.0.0-fork.20261030.1"));
});

test("Windows publication rejects changed bytes, wrong sources, and incomplete bundles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-windows-artifact-"));
  try {
    const assets = writeDesktopFixture(dir, tag, source);
    assert.deepEqual(
      (await verifyDesktopArtifacts(dir, tag, source)).assets.sort(),
      assets.sort(),
    );
    await assert.rejects(verifyDesktopArtifacts(dir, tag, "b".repeat(40)));
    const exe = assets.find((n) => n.endsWith(".exe"));
    await writeFile(join(dir, exe), "corrupt");
    await assert.rejects(verifyDesktopArtifacts(dir, tag, source));
    writeDesktopFixture(dir, tag, source);
    await rm(join(dir, `${exe}.blockmap`));
    await assert.rejects(verifyDesktopArtifacts(dir, tag, source));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const ghFixture = String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),root=process.env.FIXTURE_ROOT;
fs.appendFileSync(path.join(root,'calls'),JSON.stringify(args)+'\n');
const value=k=>args[args.indexOf(k)+1],alias=path.join(root,'alias');
if(args[0]==='api') {
 if(args.some(a=>a.endsWith('/assets?per_page=100'))){process.stdout.write(JSON.stringify([fs.readdirSync(alias).map(name=>({name}))]));process.exit(0)}
 if(process.env.FIXTURE_API_ERROR){process.stdout.write(JSON.stringify({status:'503',message:'Unavailable'}));process.exit(1)}
 if(!fs.existsSync(alias)){process.stdout.write(JSON.stringify({status:'404',message:'Not Found'}));process.exit(1)}
 process.stdout.write(JSON.stringify({id:1,draft:false,assets:fs.readdirSync(alias).map(name=>({name}))}));
} else if(args[0]==='release'&&args[1]==='download'){
 const from=args[2]==='fork-desktop-latest'?alias:path.join(root,'immutable'),to=value('--dir');
 fs.mkdirSync(to,{recursive:true});
 for(let i=0;i<args.length;i++)if(args[i]==='--pattern')fs.copyFileSync(path.join(from,args[++i]),path.join(to,args[i]));
} else if(args[1]==='create'){fs.mkdirSync(alias,{recursive:true})}
else if(args[1]==='upload'){
 if(process.env.FIXTURE_FAIL_WATERMARK==='1'){
  const files=args.filter(a=>a.includes('/bb-fork-windows-watermark'));
  if(files.length){for(const file of files){const target=path.join(alias,path.basename(file));if(args.includes('--clobber')&&fs.existsSync(target))fs.unlinkSync(target)}process.exit(1)}
 }

 if(process.env.FIXTURE_FAIL_MANIFEST==='1'&&args.some(a=>a.endsWith('/bb-fork-windows.json')))process.exit(1);
 for(const arg of args.slice(3))if(fs.existsSync(arg)&&fs.statSync(arg).isFile())fs.copyFileSync(arg,path.join(alias,path.basename(arg)));
}
`;

for (const scenario of [
  "publish",
  "newer",
  "network-error",
  "different-bytes",
  "wrong-immutable-source",
])
  test(`Windows update promotion: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "bb-windows-publish-"));
    try {
      await mkdir(join(root, "bin"));
      await writeFile(join(root, "bin/gh"), ghFixture, { mode: 0o755 });
      writeDesktopFixture(join(root, "local"), tag, source);
      writeDesktopFixture(join(root, "immutable"), tag, source);
      if (scenario === "newer")
        writeDesktopFixture(
          join(root, "alias"),
          "fork-v1.0.0-20261030.10",
          "b".repeat(40),
        );
      if (scenario === "different-bytes") {
        writeDesktopFixture(join(root, "immutable"), tag, source, {
          installer: "original published installer",
        });
      }
      if (scenario === "wrong-immutable-source")
        writeDesktopFixture(join(root, "immutable"), tag, "b".repeat(40));
      const result = spawnSync(
        process.execPath,
        [
          resolve("scripts/fork-release/publish-windows-feed.mjs"),
          join(root, "local"),
          tag,
          source,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: join(root, "bin") + ":" + process.env.PATH,
            GH_REPO: "example/fork",
            FIXTURE_ROOT: root,
            ...(scenario === "network-error" ? { FIXTURE_API_ERROR: "1" } : {}),
          },
        },
      );
      const calls = (await readFile(join(root, "calls"), "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      if (["publish", "different-bytes"].includes(scenario)) {
        assert.equal(result.status, 0, result.stderr);
        await verifyDesktopArtifacts(join(root, "alias"), tag, source);
        assert.deepEqual(
          await readFile(join(root, "alias", "bb-fork-windows.json")),
          await readFile(join(root, "immutable", "bb-fork-windows.json")),
        );
        const uploads = calls.filter((a) => a[1] === "upload");
        assert.equal(uploads.length, 4);
        assert.ok(
          uploads[0].some((a) => a.includes("bb-fork-windows-watermark-")),
        );
        assert.ok(uploads[1].some((a) => a.endsWith(".exe")));
        assert.ok(
          uploads.at(-1).some((a) => a.endsWith("bb-fork-windows.json")),
        );
      } else {
        assert.equal(
          result.status,
          scenario === "newer" ? 0 : 1,
          result.stderr,
        );
        assert.ok(
          !calls.some((a) => ["upload", "edit", "create"].includes(a[1])),
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test("an interrupted metadata promotion reserves its version against an older job", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-windows-interrupted-"));
  try {
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin/gh"), ghFixture, { mode: 0o755 });
    writeDesktopFixture(join(root, "alias"), "fork-v1.0.0-20261030.1", source);
    const invoke = (revision, fail) => {
      const next = `fork-v1.0.0-20261030.${revision}`;
      writeDesktopFixture(join(root, "local"), next, source);
      writeDesktopFixture(join(root, "immutable"), next, source);
      return spawnSync(
        process.execPath,
        [
          resolve("scripts/fork-release/publish-windows-feed.mjs"),
          join(root, "local"),
          next,
          source,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: join(root, "bin") + ":" + process.env.PATH,
            GH_REPO: "example/fork",
            FIXTURE_ROOT: root,
            ...(fail ? { FIXTURE_FAIL_MANIFEST: "1" } : {}),
          },
        },
      );
    };
    assert.equal(invoke(3, true).status, 1);
    const readVersion = async (name) =>
      JSON.parse(await readFile(join(root, "alias", name), "utf8")).version;
    assert.equal(
      await readVersion("desktop-version-windows.json"),
      "1.0.0-fork.20261030.3",
    );
    assert.equal(
      await readVersion("bb-fork-windows.json"),
      "1.0.0-fork.20261030.1",
    );
    const older = invoke(2, false);
    assert.equal(older.status, 0, older.stderr);
    assert.equal(
      await readVersion("desktop-version-windows.json"),
      "1.0.0-fork.20261030.3",
    );
    const retry = invoke(3, false);
    assert.equal(retry.status, 0, retry.stderr);
    await verifyDesktopArtifacts(
      join(root, "alias"),
      "fork-v1.0.0-20261030.3",
      source,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed newer watermark upload preserves an earlier incomplete promotion", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-windows-watermark-"));
  try {
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin/gh"), ghFixture, { mode: 0o755 });
    writeDesktopFixture(join(root, "alias"), "fork-v1.0.0-20261030.1", source);
    const invoke = (revision, failure) => {
      const next = `fork-v1.0.0-20261030.${revision}`;
      writeDesktopFixture(join(root, "local"), next, source);
      writeDesktopFixture(join(root, "immutable"), next, source);
      return spawnSync(
        process.execPath,
        [
          resolve("scripts/fork-release/publish-windows-feed.mjs"),
          join(root, "local"),
          next,
          source,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: join(root, "bin") + ":" + process.env.PATH,
            GH_REPO: "example/fork",
            FIXTURE_ROOT: root,
            ...(failure === "manifest" ? { FIXTURE_FAIL_MANIFEST: "1" } : {}),
            ...(failure === "watermark" ? { FIXTURE_FAIL_WATERMARK: "1" } : {}),
          },
        },
      );
    };
    assert.equal(invoke(3, "manifest").status, 1);
    assert.equal(invoke(4, "watermark").status, 1);
    const older = invoke(2);
    assert.equal(older.status, 0, older.stderr);
    assert.equal(
      JSON.parse(
        await readFile(
          join(root, "alias", "desktop-version-windows.json"),
          "utf8",
        ),
      ).version,
      "1.0.0-fork.20261030.3",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
