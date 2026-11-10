import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

test("resource policy invalidates the actual server task input contract without invalidating unrelated tests", () => {
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const parsed = ts.parseConfigFileTextToJson(
    "turbo.json",
    fs.readFileSync(path.join(repo, "turbo.json"), "utf8"),
  );
  assert.equal(parsed.error, undefined);
  const original = parsed.config.tasks["@bb/server#test"];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-worker-cache-"));
  const put = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };
  const json = (name, data) => put(name, JSON.stringify(data));
  try {
    json("package.json", {
      name: "cache-fixture",
      private: true,
      packageManager: "pnpm@9.15.0",
    });
    put("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
    put(
      "pnpm-lock.yaml",
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/server: {}\n  apps/unrelated: {}\n",
    );
    for (const name of ["server", "unrelated"])
      json(`apps/${name}/package.json`, {
        name: `@bb/${name}`,
        scripts: { test: "node unused.mjs" },
      });
    json("turbo.json", {
      tasks: { "@bb/server#test": { ...original, dependsOn: [] }, test: {} },
    });
    put(
      "scripts/resource-profile.mjs",
      fs.readFileSync(path.join(repo, "scripts/resource-profile.mjs"), "utf8"),
    );
    put("scripts/unrelated.mjs", "export const unrelated = 1;");
    const run = () => {
      const child = spawnSync(
        path.join(repo, "node_modules/.bin/turbo"),
        ["run", "test", "--dry=json"],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout).tasks;
    };
    const before = run();
    fs.appendFileSync(path.join(root, "scripts/resource-profile.mjs"), "\n");
    const changed = run();
    const hash = (tasks, name) =>
      tasks.find((t) => t.taskId === `@bb/${name}#test`).hash;
    assert.notEqual(hash(before, "server"), hash(changed, "server"));
    assert.equal(hash(before, "unrelated"), hash(changed, "unrelated"));
    fs.appendFileSync(path.join(root, "scripts/unrelated.mjs"), "\n");
    const outside = run();
    assert.equal(hash(changed, "server"), hash(outside, "server"));
    assert.equal(hash(changed, "unrelated"), hash(outside, "unrelated"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
