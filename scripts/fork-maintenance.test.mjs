import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replacementDropIn } from "./fork-cutover.mjs";
import { latestStable, preflight, readInputs } from "./fork-inputs.mjs";
import { runStage } from "./fork-package-state.mjs";

test("stable selection ignores prereleases and compares version components", () => {
  assert.equal(
    latestStable(
      "desktop-v0.9.8\ndesktop-v0.10.1\ndesktop-v0.10.2-beta.1\ndesktop-v0.10.1^{}\ndesktop-v0.10.0",
    ),
    "desktop-v0.10.1",
  );
  assert.throws(() => latestStable("desktop-v0.11.0-rc.1"), /稳定/);
});

test("preflight reports every upstream conflict without touching worktrees or refs", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-preflight-"));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(root, ".fork"));
    writeFileSync(
      join(root, ".fork/branches"),
      "base desktop-v1.1.0\nfix/a needs-feedback\nfix/b needs-feedback\nfix/c needs-feedback\n",
    );
    writeFileSync(join(root, "file"), "base\n");
    git("add", ".");
    git("commit", "-qm", "initial");
    const initial = git("rev-parse", "HEAD");
    for (const name of ["a", "b", "c"]) {
      git("checkout", "-qb", `fix/${name}`, initial);
      writeFileSync(
        join(root, name === "c" ? "independent" : "file"),
        `${name}\n`,
      );
      git("add", ".");
      git("commit", "-qm", name);
    }
    git("checkout", "-q", "main");
    writeFileSync(join(root, "file"), "upstream\n");
    git("add", ".");
    git("commit", "-qm", "upstream");
    git("tag", "desktop-v1.1.0");
    git("branch", "fork-tooling");
    const refs = git("show-ref");
    const worktrees = git("worktree", "list", "--porcelain");
    const conflicts = preflight(root, readInputs(root));
    assert.deepEqual(
      conflicts.map(({ name }) => name),
      ["fix/a", "fix/b"],
    );
    assert.equal(git("show-ref"), refs);
    assert.equal(git("worktree", "list", "--porcelain"), worktrees);
    assert.equal(git("status", "--porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package stages reuse success, retry failure and invalidate changed commands and sources", async () => {
  const root = mkdtempSync(join(tmpdir(), "bb-package-state-"));
  const path = join(root, "state.json");
  const counter = join(root, "counter");
  const marker = join(root, "ready");
  const command = [
    process.execPath,
    "-e",
    "const fs=require('node:fs'); if(!fs.existsSync(process.argv[2])) process.exit(23); fs.appendFileSync(process.argv[1], 'x');",
    counter,
    marker,
  ];
  try {
    writeFileSync(
      path,
      JSON.stringify({
        source: "a".repeat(40),
        base: "desktop-v1.0.0",
        previous: "b".repeat(40),
        completed: {},
      }),
    );
    await assert.rejects(runStage(path, "tests", root, command), /exit 23/);
    assert.equal(
      JSON.parse(readFileSync(path, "utf8")).completed.tests,
      undefined,
    );
    writeFileSync(marker, "ready");
    await runStage(path, "tests", root, command);
    await runStage(path, "tests", root, command);
    assert.equal(readFileSync(counter, "utf8"), "x");
    await runStage(path, "tests", root, [...command, "changed-filter"]);
    assert.equal(readFileSync(counter, "utf8"), "xx");
    const state = JSON.parse(readFileSync(path, "utf8"));
    state.source = "c".repeat(40);
    writeFileSync(path, JSON.stringify(state));
    await runStage(path, "tests", root, [...command, "changed-filter"]);
    assert.equal(readFileSync(counter, "utf8"), "xxx");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resuming after a test shard or toolchain change executes the required validation", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-package-env-"));
  const path = join(root, "state.json");
  const counter = join(root, "executed");
  const script = new URL("./fork-package-state.mjs", import.meta.url).pathname;
  const command = [
    process.execPath,
    "-e",
    "require('node:fs').appendFileSync(process.argv[1], JSON.stringify([process.env.BB_CI_TEST_SHARD ?? 'full', process.env.BB_BUILD_TOOLCHAIN]) + '\\n')",
    counter,
  ];
  const env = { ...process.env, BB_BUILD_TOOLCHAIN: "before" };
  delete env.BB_CI_TEST_SHARD;
  const run = (runtimeEnv) =>
    spawnSync(
      process.execPath,
      [script, "run", path, "tests", root, ...command],
      { env: runtimeEnv, encoding: "utf8" },
    );
  try {
    writeFileSync(
      path,
      JSON.stringify({
        source: "a".repeat(40),
        base: "desktop-v1.0.0",
        previous: "b".repeat(40),
        completed: {},
      }),
    );
    for (const runtimeEnv of [
      { ...env, BB_CI_TEST_SHARD: "1/2" },
      env,
      { ...env, BB_BUILD_TOOLCHAIN: "after" },
      { ...env, BB_BUILD_TOOLCHAIN: "after" },
    ]) {
      const result = run(runtimeEnv);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.deepEqual(
      readFileSync(counter, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
      [
        ["1/2", "before"],
        ["full", "before"],
        ["full", "after"],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed cutover changes both pointers and retains data, flags and other directives", () => {
  const oldDirectory = "/opt/old";
  const dropIn =
    "[Service]\nWorkingDirectory=/opt/old\nExecStart=\nExecStart=/opt/old/bin/bb-app --data-dir /opt/old/data --server-port 1234\nEnvironment=HOME=/root\nOOMPolicy=continue\n";
  assert.equal(
    replacementDropIn({
      dropIn,
      oldDirectory,
      target: "/opt/new",
      release: true,
    }),
    "[Service]\nWorkingDirectory=/opt/new\nExecStart=\nExecStart=/opt/new/bin/bb-app --data-dir /opt/old/data --server-port 1234\nEnvironment=HOME=/root\nOOMPolicy=continue\n",
  );
});

test("source cutover retains Node and launcher arguments", () => {
  const dropIn =
    "[Service]\nWorkingDirectory=/src/old\nExecStart=\nExecStart=/usr/bin/node --import tsx /src/old/scripts/start-bb.mjs --data-dir /data/bb\n";
  assert.equal(
    replacementDropIn({
      dropIn,
      oldDirectory: "/src/old",
      target: "/src/new",
      release: false,
    }),
    "[Service]\nWorkingDirectory=/src/new\nExecStart=\nExecStart=/usr/bin/node --import tsx /src/new/scripts/start-bb.mjs --data-dir /data/bb\n",
  );
  assert.throws(
    () =>
      replacementDropIn({
        dropIn,
        oldDirectory: "/src/old",
        target: "/opt/pkg",
        release: true,
      }),
    /must not be mixed/,
  );
});

test("cutover rejects a stale working directory and installed-to-source mismatch", () => {
  const dropIn =
    "[Service]\nWorkingDirectory=/opt/old\nExecStart=\nExecStart=/opt/old/bin/bb-app --data-dir /data/bb\n";
  assert.throws(
    () =>
      replacementDropIn({
        dropIn,
        oldDirectory: "/obsolete",
        target: "/opt/new",
        release: true,
      }),
    /actual WorkingDirectory/,
  );
  assert.throws(
    () =>
      replacementDropIn({
        dropIn,
        oldDirectory: "/opt/old",
        target: "/src/new",
        release: false,
      }),
    /must not be mixed/,
  );
});

for (const dataDirectory of ["/data/bb", "/src/old/data"]) {
  test(`documented relative source launcher preserves ${dataDirectory}`, () => {
    const command = `ExecStart=/usr/bin/node --conditions=source --import tsx packages/bb-app/src/bin/bb-app.ts --data-dir ${dataDirectory}\n`;
    const dropIn = `[Service]\nWorkingDirectory=/src/old\nExecStart=\n${command}`;
    assert.equal(
      replacementDropIn({
        dropIn,
        oldDirectory: "/src/old",
        target: "/src/new",
        release: false,
      }),
      `[Service]\nWorkingDirectory=/src/new\nExecStart=\n${command}`,
    );
  });
}

for (const dirty of ["legacy", "tracked", "untracked"]) {
  test(`promote refuses ${dirty} roots without changing files or HEAD`, () => {
    const root = mkdtempSync(join(tmpdir(), "bb-promote-"));
    try {
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      };
      const git = (...args) =>
        execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
      git("init", "-q", "-b", "main");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.com");
      mkdirSync(join(root, ".fork"));
      writeFileSync(join(root, ".fork/branches"), "base desktop-v1.0.0\n");
      writeFileSync(
        join(root, "AGENTS.md"),
        dirty === "legacy"
          ? "<!-- open-source-fork-maintenance:start -->\n"
          : "<!-- fork-maintenance:start -->\n",
      );
      git("add", ".");
      git("commit", "-qm", "fixture");
      const before = git("rev-parse", "HEAD");
      if (dirty === "tracked")
        writeFileSync(
          join(root, "AGENTS.md"),
          "<!-- fork-maintenance:start -->\ndirty\n",
        );
      if (dirty === "untracked")
        writeFileSync(join(root, "user-work"), "preserve\n");
      const status = git("status", "--porcelain");
      const result = spawnSync(
        "bash",
        [
          new URL("./fork-aggregate", import.meta.url).pathname,
          "--promote-only",
        ],
        { cwd: root, env, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        dirty === "legacy" ? /旧维护模型/ : /未提交或未跟踪/,
      );
      assert.equal(git("rev-parse", "HEAD"), before);
      assert.equal(git("status", "--porcelain"), status);
      if (dirty === "untracked")
        assert.equal(
          readFileSync(join(root, "user-work"), "utf8"),
          "preserve\n",
        );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const pinned of [false, true]) {
  test(`a clean main root promotes the ${pinned ? "explicit" : "staged"} verified SHA to fork/main`, () => {
    const root = mkdtempSync(join(tmpdir(), "bb-promote-clean-"));
    try {
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      };
      const git = (...args) =>
        execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
      git("init", "-q", "-b", "main");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.com");
      mkdirSync(join(root, ".fork"));
      writeFileSync(join(root, ".fork/branches"), "base desktop-v1.0.0\n");
      writeFileSync(
        join(root, "AGENTS.md"),
        "<!-- fork-maintenance:start -->\n",
      );
      git("add", ".");
      git("commit", "-qm", "base");
      git("tag", "desktop-v1.0.0");
      git("branch", "fork-tooling");
      git("branch", "local/aggregate");
      const previous = git("rev-parse", "HEAD");
      const remote = join(root, ".git", "remote.git");
      git("init", "--bare", "-q", "-b", "main", remote);
      git("remote", "add", "origin", remote);
      git("remote", "add", "fork", remote);
      git(
        "push",
        "-q",
        "fork",
        "main",
        "fork-tooling",
        "local/aggregate",
        "refs/tags/desktop-v1.0.0",
      );
      const next = git(
        "commit-tree",
        "HEAD^{tree}",
        "-p",
        "HEAD",
        "-m",
        "verified candidate",
      );
      git("branch", "aggregate/next", pinned ? previous : next);
      const result = spawnSync(
        "bash",
        [
          new URL("./fork-aggregate", import.meta.url).pathname,
          "--promote-only",
          ...(pinned ? ["--result", next] : []),
        ],
        { cwd: root, env, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(git("branch", "--show-current"), "main");
      assert.equal(git("rev-parse", "HEAD"), next);
      assert.equal(
        git("ls-remote", "fork", "refs/heads/main").split("\t")[0],
        next,
      );
      assert.equal(
        git("ls-remote", "fork", "refs/heads/local/aggregate").split("\t")[0],
        previous,
      );
      const clone = join(root, ".git", "clone");
      git("clone", "-q", remote, clone);
      assert.equal(git("-C", clone, "branch", "--show-current"), "main");
      assert.equal(git("-C", clone, "rev-parse", "HEAD"), next);
      assert.equal(git("status", "--porcelain"), "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("SDK source identity rejects wrong SHA, tag and dirty input while allowing ignored build outputs", async () => {
  const { checkSource } = await import("./fork-release/sdk-artifact.mjs");
  const root = mkdtempSync(join(tmpdir(), "bb-sdk-source-"));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(root, ".gitignore"), "dist/\n");
    git("add", ".");
    git("commit", "-qm", "fixture");
    const before = git("rev-parse", "HEAD");
    git("tag", "fork-v1-test");
    git("commit", "--allow-empty", "-qm", "candidate");
    const source = git("rev-parse", "HEAD");
    assert.throws(() => checkSource(root, "fork-v1-candidate", before), /SHA/);
    assert.throws(() => checkSource(root, "fork-v1-test", source), /Tag/);
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist/generated"), "generated");
    checkSource(root, "fork-v1-candidate", source);
    writeFileSync(join(root, "untracked"), "user work");
    assert.throws(
      () => checkSource(root, "fork-v1-candidate", source),
      /clean/,
    );
    rmSync(join(root, "untracked"));
    writeFileSync(join(root, ".gitignore"), "changed\n");
    assert.throws(
      () => checkSource(root, "fork-v1-candidate", source),
      /clean/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release publication requires SDK identity and completes drafts without overwriting published assets", async () => {
  const { createHash } = await import("node:crypto");
  const { copyFileSync, chmodSync, readdirSync, symlinkSync } =
    await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "bb-sdk-publish-"));
  const tag = "fork-v1-test";
  const source = "a".repeat(40);
  const digest = (file) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  try {
    mkdirSync(join(root, "scripts/fork-release"), { recursive: true });
    mkdirSync(join(root, "packages/plugin-sdk"), { recursive: true });
    mkdirSync(join(root, "package"));
    mkdirSync(join(root, "release"));
    mkdirSync(join(root, "bin"));
    for (const file of ["sdk-artifact.mjs", "verify-sdk.mjs", "publish.sh"])
      copyFileSync(
        new URL(`./fork-release/${file}`, import.meta.url),
        join(root, "scripts/fork-release", file),
      );
    const pkg = { name: "@get-bb/plugin-sdk", version: "1.0.0" };
    for (const path of [
      "packages/plugin-sdk/package.json",
      "package/package.json",
    ])
      writeFileSync(join(root, path), JSON.stringify(pkg));
    const filename = `bb-plugin-sdk-${tag}.tgz`;
    const archive = join(root, "release", filename);
    execFileSync("tar", ["-czf", archive, "package"], { cwd: root });
    writeFileSync(`${archive}.sha256`, `${digest(archive)}  ${filename}\n`);
    const provenance = {
      tag,
      source,
      package: pkg.name,
      version: pkg.version,
      filename,
      sha256: digest(archive),
    };
    const provenancePath = join(root, "release", `bb-plugin-sdk-${tag}.json`);
    writeFileSync(provenancePath, JSON.stringify(provenance));
    const runtimeName = `bb-${tag}-linux-x64.tar.gz`;
    const runtimePath = join(root, "release", runtimeName);
    writeFileSync(runtimePath, "runtime fixture");
    writeFileSync(
      `${runtimePath}.sha256`,
      `${digest(runtimePath)}  ${runtimeName}\n`,
    );
    const assets = readdirSync(join(root, "release")).map((name) => ({
      name,
      size: 1,
    }));
    writeFileSync(
      join(root, "bin/git"),
      '#!/bin/sh\nprintf "%s\\trefs/tags/%s\\n" "$GITHUB_SHA" "$RELEASE_TAG"\n',
    );
    writeFileSync(
      join(root, "bin/gh"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$FIXTURE_ROOT/calls"
if [ "$1 $2" = 'release view' ]; then cat "$FIXTURE_ROOT/state.json"; fi
`,
    );
    for (const bin of ["git", "gh"]) chmodSync(join(root, "bin", bin), 0o755);
    for (const [name, target] of Object.entries({
      bash: "/bin/bash",
      cat: "/bin/cat",
      node: process.execPath,
      gzip: execFileSync("which", ["gzip"], { encoding: "utf8" }).trim(),
      tar: execFileSync("which", ["tar"], { encoding: "utf8" }).trim(),
      awk: execFileSync("which", ["awk"], { encoding: "utf8" }).trim(),
      shasum: execFileSync("which", ["shasum"], { encoding: "utf8" }).trim(),
    }))
      symlinkSync(target, join(root, "bin", name));
    const env = {
      ...process.env,
      GH_REPO: "hxy91819/bb",
      RELEASE_TAG: tag,
      GITHUB_SHA: source,
      FIXTURE_ROOT: root,
      PATH: join(root, "bin"),
    };
    const invoke = () =>
      spawnSync("bash", ["scripts/fork-release/publish.sh"], {
        cwd: root,
        env,
        encoding: "utf8",
      });
    const state = (isDraft, expectedAssets = assets) => {
      writeFileSync(
        join(root, "state.json"),
        JSON.stringify({
          isDraft,
          body: `commit ${source}.`,
          assets: expectedAssets,
        }),
      );
      writeFileSync(join(root, "calls"), "");
    };
    state(false);
    let result = invoke();
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(
      readFileSync(join(root, "calls"), "utf8"),
      /release (upload|edit|create)/,
    );
    state(
      false,
      assets.filter((asset) => asset.name !== filename),
    );
    result = invoke();
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      readFileSync(join(root, "calls"), "utf8"),
      /release (upload|edit|create)/,
    );
    state(true);
    result = invoke();
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(join(root, "calls"), "utf8");
    assert.match(calls, /release upload/);
    for (const { name } of assets) assert.ok(calls.includes(name));
    assert.match(calls, /--draft=false/);
    for (const change of [
      { source: "b".repeat(40) },
      { tag: "fork-v2-wrong" },
      { sha256: "b".repeat(64) },
      { version: "2.0.0" },
      { package: "other" },
    ]) {
      state(true);
      writeFileSync(
        provenancePath,
        JSON.stringify({ ...provenance, ...change }),
      );
      result = invoke();
      assert.notEqual(result.status, 0, JSON.stringify(change));
      assert.equal(readFileSync(join(root, "calls"), "utf8"), "");
    }
    writeFileSync(provenancePath, JSON.stringify(provenance));
    state(true);
    writeFileSync(runtimePath, "corrupted runtime");
    assert.notEqual(invoke().status, 0);
    assert.equal(readFileSync(join(root, "calls"), "utf8"), "");
    rmSync(runtimePath);
    assert.notEqual(invoke().status, 0);
    assert.equal(readFileSync(join(root, "calls"), "utf8"), "");
    writeFileSync(runtimePath, "runtime fixture");
    writeFileSync(archive, "corrupted");
    assert.notEqual(invoke().status, 0);
    rmSync(archive);
    assert.notEqual(invoke().status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
