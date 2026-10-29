import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshot, preflight } from "./fork-inputs.mjs";
import { runStage } from "./fork-package-state.mjs";

const aggregate = new URL("./fork-aggregate", import.meta.url).pathname;
const execution = new URL("./fork-execution.mjs", import.meta.url).pathname;
const stateTool = new URL("./fork-package-state.mjs", import.meta.url).pathname;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bb-flow-"));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const key of [
    "BB_FORK_INPUT_SNAPSHOT",
    "BB_FORK_EXECUTION_TOKEN",
    "BB_FORK_EXECUTION_ACTIVE",
  ])
    delete env[key];
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (message) => {
    git("add", ".");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(root, ".fork"));
  writeFileSync(
    join(root, ".fork/branches"),
    "base desktop-v1.0.0\nfix/a internal\nfix/b internal\n",
  );
  writeFileSync(
    join(root, ".gitignore"),
    ".worktrees/\nnode_modules/\ndist/\n",
  );
  writeFileSync(join(root, "file"), "base\n");
  const base = commit("base");
  git("tag", "desktop-v1.0.0");
  for (const branch of [
    "fork-tooling",
    "security/baseline",
    "fork-base/desktop-v1.0.0",
    "fix/a",
    "fix/b",
  ])
    git("branch", branch);
  const remote = join(root, ".git/remote.git");
  git("init", "--bare", "-q", "-b", "main", remote);
  for (const name of ["origin", "upstream"]) git("remote", "add", name, remote);
  git(
    "push",
    "-q",
    "origin",
    "main",
    "HEAD:refs/heads/aggregate",
    "refs/tags/desktop-v1.0.0",
  );
  const run = (...args) =>
    spawnSync("bash", [aggregate, ...args], {
      cwd: root,
      env,
      encoding: "utf8",
    });
  return {
    root,
    env,
    git,
    commit,
    base,
    run,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("preflight snapshot pins branch, tooling, security, base and previous through merge and promotion", () => {
  const f = fixture();
  const { root, git, env, commit, base } = f;
  try {
    git("checkout", "-q", "fix/a");
    writeFileSync(join(root, "feature"), "frozen\n");
    const tip = commit("feature");
    git("checkout", "-q", "main");
    const inputs = snapshot(root);
    assert.equal(preflight(root, inputs).length, 0);
    const path = join(root, ".git/inputs.json");
    writeFileSync(path, JSON.stringify(inputs));
    env.BB_FORK_INPUT_SNAPSHOT = path;
    git("checkout", "-q", "fix/a");
    writeFileSync(join(root, "feature"), "moved\n");
    const moved = commit("move all refs");
    git("checkout", "-q", "main");
    for (const ref of [
      "fork-tooling",
      "security/baseline",
      "fork-base/desktop-v1.0.0",
    ])
      git("update-ref", `refs/heads/${ref}`, moved);
    git("update-ref", "refs/remotes/origin/aggregate", moved);
    let result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const candidate = git("rev-parse", "aggregate-next");
    assert.equal(git("show", `${candidate}:feature`), "frozen");
    git("merge-base", "--is-ancestor", tip, candidate);
    assert.notEqual(candidate, moved);
    result = f.run("--promote-only", "--result", candidate);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      git("ls-remote", "origin", "refs/heads/aggregate").split("\t")[0],
      candidate,
    );
    const concurrent = git(
      "commit-tree",
      `${base}^{tree}`,
      "-p",
      base,
      "-m",
      "another promoter",
    );
    git(
      "push",
      "-q",
      "origin",
      `${concurrent}:refs/heads/aggregate`,
      "--force",
    );
    result = f.run("--promote-only", "--result", candidate);
    assert.notEqual(result.status, 0);
    assert.equal(
      git("ls-remote", "origin", "refs/heads/aggregate").split("\t")[0],
      concurrent,
    );
    assert.equal(git("branch", "--show-current"), "main");
  } finally {
    f.cleanup();
  }
});

test("interbranch conflicts retain both intentions and rerere replays the recorded resolution", () => {
  const f = fixture();
  const { root, git, commit } = f;
  try {
    for (const name of ["a", "b"]) {
      git("checkout", "-q", `fix/${name}`);
      writeFileSync(join(root, "file"), `${name}\n`);
      commit(name);
    }
    git("checkout", "-q", "main");
    let result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /fork 分支之间的冲突/);
    const wt = join(root, ".worktrees/aggregate-next");
    writeFileSync(join(wt, "file"), "a\nb\n");
    git("-C", wt, "add", "file");
    git("-C", wt, "commit", "-qm", "resolve both");
    result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /rerere\s+fix\/b/);
    assert.equal(git("show", "aggregate-next:file"), "a\nb");
  } finally {
    f.cleanup();
  }
});

test("missing or corrupt outputs, replaced tools and dependency reruns invalidate downstream successes", async () => {
  const f = fixture();
  const { root } = f;
  const path = join(root, ".git/state.json");
  const tool = join(root, ".git/tool");
  const count = join(root, ".git/count");
  const writeTool = (suffix) => {
    writeFileSync(
      tool,
      `#!/bin/sh\nprintf x >> '${count}'\nmkdir -p dist\nprintf '${suffix}' > dist/payload\n`,
    );
    chmodSync(tool, 0o755);
  };
  const install = [
    process.execPath,
    "-e",
    "const f=require('node:fs');f.mkdirSync('node_modules',{recursive:true});f.writeFileSync('node_modules/.modules.yaml','installed');f.writeFileSync('node_modules/dependency','correct');",
  ];
  const downstream = [
    process.execPath,
    "-e",
    "require('node:fs').appendFileSync('.git/downstream','x')",
  ];
  const run = (name, command) => runStage(path, name, root, command);
  try {
    writeFileSync(
      path,
      JSON.stringify({
        source: f.base,
        base: "desktop-v1.0.0",
        previous: f.base,
        filters: ["full"],
        completed: {},
      }),
    );
    writeTool("correct");
    await run("install", install);
    await run("tests", [tool]);
    await run("runtime", downstream);
    await run("install", install);
    await run("tests", [tool]);
    assert.equal(readFileSync(count, "utf8"), "x");
    rmSync(join(root, "dist/payload"));
    await run("tests", [tool]);
    await run("runtime", downstream);
    assert.equal(readFileSync(join(root, ".git/downstream"), "utf8"), "xx");
    writeFileSync(join(root, "dist/payload"), "corrupt");
    await run("tests", [tool]);
    writeTool("new tool");
    await run("tests", [tool]);
    assert.equal(readFileSync(join(root, "dist/payload"), "utf8"), "new tool");
    writeFileSync(join(root, "node_modules/dependency"), "broken");
    await run("install", install);
    await run("tests", [tool]);
    assert.equal(readFileSync(count, "utf8"), "xxxxx");
    await assert.rejects(
      run("tests", [process.execPath, "-e", "process.exit(29)"]),
      /exit 29/,
    );
    const failed = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(failed.completed.tests, undefined);
    assert.equal(failed.completed.runtime, undefined);
    assert.equal(failed.events.at(-1).status, "failed");
    await run("tests", [tool]);
    const state = JSON.parse(readFileSync(path, "utf8"));
    state.filters = ["partial"];
    writeFileSync(path, JSON.stringify(state));
    await run("tests", [tool]);
    assert.equal(readFileSync(count, "utf8"), "xxxxxxx");
  } finally {
    f.cleanup();
  }
});

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((accept) => setTimeout(accept, 25));
  }
  throw new Error("fixture timed out");
}

function completed(child) {
  return new Promise((accept) =>
    child.once("close", (code, signal) => accept({ code, signal })),
  );
}

test("execution mutex spans Git and nested commands without deadlocking or releasing on contender failure", async () => {
  const f = fixture();
  const { root, env } = f;
  const script = join(root, ".git/hold.sh");
  let child;
  try {
    writeFileSync(
      script,
      `#!/bin/bash\nset -e\nbash '${aggregate}' --preflight\ntouch '${root}/.git/ready'\nwhile [ ! -f '${root}/.git/release' ]; do sleep .05; done\n`,
    );
    child = spawn(process.execPath, [execution, script], {
      cwd: root,
      env,
      stdio: "ignore",
    });
    const done = completed(child);
    await waitFor(() => existsSync(join(root, ".git/ready")));
    for (let i = 0; i < 2; i++) {
      const result = f.run("--preflight");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /另一个 fork 执行/);
    }
    writeFileSync(join(root, ".git/release"), "release");
    assert.equal((await done).code, 0);
    assert.equal(f.run("--preflight").status, 0);
  } finally {
    child?.kill("SIGKILL");
    f.cleanup();
  }
});

test("interrupted stage terminates its child process tree and resume retries instead of reusing success", async () => {
  const f = fixture();
  const path = join(f.root, ".git/state.json");
  const pidFile = join(f.root, ".git/pid");
  let child;
  try {
    writeFileSync(path, JSON.stringify({ source: f.base, completed: {} }));
    const program =
      "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000)";
    child = spawn(
      process.execPath,
      [
        stateTool,
        "run",
        path,
        "tests",
        f.root,
        process.execPath,
        "-e",
        program,
        pidFile,
      ],
      { cwd: f.root, env: f.env, stdio: "ignore" },
    );
    const done = completed(child);
    await waitFor(() => existsSync(pidFile));
    const descendant = Number(readFileSync(pidFile, "utf8"));
    const contender = spawnSync(
      process.execPath,
      [
        stateTool,
        "run",
        path,
        "tests",
        f.root,
        process.execPath,
        "-e",
        "process.exit(0)",
      ],
      { cwd: f.root, env: f.env, encoding: "utf8" },
    );
    assert.notEqual(contender.status, 0);
    assert.match(contender.stderr, /EEXIST/);
    child.kill("SIGTERM");
    assert.equal((await done).code, 1);
    const state = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(state.events.at(-1).status, "interrupted");
    assert.equal(state.completed.tests, undefined);
    await waitFor(() => {
      try {
        return (
          readFileSync(`/proc/${descendant}/stat`, "utf8").split(" ")[2] === "Z"
        );
      } catch {
        return true;
      }
    });
    await runStage(path, "tests", f.root, [
      process.execPath,
      "-e",
      "require('node:fs').writeFileSync('.git/retried','yes')",
    ]);
    assert.equal(readFileSync(join(f.root, ".git/retried"), "utf8"), "yes");
  } finally {
    child?.kill("SIGKILL");
    f.cleanup();
  }
});

test("run records preserve their own coverage and distinguish tag publication from Release and installation", () => {
  const f = fixture();
  const path = join(f.root, ".git/state.json");
  const record = join(f.root, ".git/run.json");
  const command = (...args) =>
    execFileSync(process.execPath, [stateTool, ...args], {
      cwd: f.root,
      env: f.env,
      encoding: "utf8",
    });
  try {
    command("init", path, f.base, "desktop-v1.0.0", f.base, f.root, "full");
    command("begin", path, "0", "1", "1");
    command("journal", record, "verification");
    command("result", path, "verification", "completed");
    command("result", path, "tag", "fork-v1.0.0-fixture");
    command("journal", record, "success", path, "0");
    const completed = JSON.parse(readFileSync(record, "utf8"));
    assert.equal(completed.result.delivery.verification, "completed");
    assert.equal(completed.result.delivery.tag, "fork-v1.0.0-fixture");
    assert.equal(completed.result.delivery.release, "not-observed");
    assert.equal(completed.result.delivery.installation, "not-observed");
    assert.deepEqual(completed.result.filters, ["full"]);
    command(
      "init",
      path,
      f.base,
      "desktop-v1.0.0",
      "b".repeat(40),
      f.root,
      "partial",
    );
    command("begin", path, "1", "0", "0");
    const next = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(next.previous, "b".repeat(40));
    assert.deepEqual(next.filters, ["partial"]);
    assert.equal(next.delivery.verification, "pending");
    assert.equal(next.delivery.promotion, "skipped");
    assert.deepEqual(JSON.parse(readFileSync(record, "utf8")), completed);
  } finally {
    f.cleanup();
  }
});

test("package entry synchronizes once and seals its snapshot before a missing build runner fails verification", () => {
  const f = fixture();
  try {
    const trace = join(f.root, ".git/trace.jsonl");
    const result = spawnSync(
      "bash",
      [new URL("./fork-package", import.meta.url).pathname, "--verify-only"],
      {
        cwd: f.root,
        env: { ...f.env, GIT_TRACE2_EVENT: trace },
        encoding: "utf8",
        timeout: 20000,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /ENOENT/);
    const events = readFileSync(trace, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const fetches = events.filter(
      (event) => event.event === "start" && event.argv?.[1] === "fetch",
    );
    assert.equal(fetches.length, 2);
    const recordPath = result.stdout.match(/本轮结果：([^；\n]+)/)?.[1];
    assert.ok(recordPath, result.stdout);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.equal(record.status, "failed");
    assert.equal(record.result.delivery.verification, "failed");
    assert.equal(record.result.delivery.promotion, "skipped");
    const inputs = JSON.parse(readFileSync(record.result.snapshot, "utf8"));
    assert.equal(inputs.baseSha, f.base);
    assert.equal(inputs.baseRef, "refs/heads/fork-base/desktop-v1.0.0");
    assert.equal(inputs.security, f.base);
    const state = JSON.parse(readFileSync(record.verificationState, "utf8"));
    assert.equal(state.completed.install, undefined);
    assert.equal(state.events.at(-1).status, "failed");
  } finally {
    f.cleanup();
  }
});

test("execution metadata changes reuse validation while unknown environment changes invalidate it", () => {
  const f = fixture();
  const path = join(f.root, ".git/state.json");
  const command = [
    process.execPath,
    "-e",
    "require('node:fs').appendFileSync('.git/counter','x')",
  ];
  try {
    writeFileSync(path, JSON.stringify({ source: f.base, completed: {} }));
    for (const [token, unknown] of [
      ["first", "same"],
      ["second", "same"],
      ["third", "changed"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [stateTool, "run", path, "tests", f.root, ...command],
        {
          cwd: f.root,
          env: {
            ...f.env,
            BB_FORK_EXECUTION_TOKEN: token,
            BB_FORK_INPUT_SNAPSHOT: token,
            SHLVL: token,
            FLOW_UNKNOWN_ENV: unknown,
          },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(readFileSync(join(f.root, ".git/counter"), "utf8"), "xx");
  } finally {
    f.cleanup();
  }
});
