import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  symlinkSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshot, preflight } from "./fork-inputs.mjs";
import {
  cleanupEmpty,
  inspectOwner,
  killOwned,
  managerEnv,
  ownerDirectory,
  queryUnits,
  readOwner,
} from "./fork-cgroup.mjs";
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
  for (const key of Object.keys(env))
    if (key.startsWith("BB_RESOURCE_") || key === "VITEST_MAX_WORKERS")
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
  const microbin = join(root, ".git/microbin");
  mkdirSync(microbin);
  const systemdRun = execFileSync("bash", ["-c", "command -v systemd-run"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(
    join(microbin, "systemd-run"),
    `#!/bin/sh\nfor arg do\n  case "$arg" in RuntimeMaxSec=*|RuntimeMaxUSec=*) exec '${systemdRun}' "$@";; esac\ndone\nexec '${systemdRun}' --property=RuntimeMaxSec=20s "$@"\n`,
  );
  chmodSync(join(microbin, "systemd-run"), 0o755);
  env.PATH = `${microbin}:${env.PATH}`;
  return {
    root,
    env,
    git,
    commit,
    base,
    run,
    cleanup: () => {
      for (const file of readdirSync(join(root, ".git")).filter((name) =>
        name.endsWith(".lock.owner.json"),
      )) {
        const owner = readOwner(join(root, ".git", file.slice(0, -11)));
        killOwned(owner);
        cleanupEmpty(owner);
      }
      rmSync(root, { recursive: true, force: true });
    },
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
    assert.match(contender.stderr, /阶段执行仍持有/);
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
    assert.equal(record.result.delivery.verification, "failed", result.stderr);
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

function alive(pid) {
  try {
    if (readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2] === "Z")
      return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForKernelRelease(path) {
  await waitFor(() => {
    const result = spawnSync(
      "perl",
      [
        "-MFcntl=:flock",
        "-e",
        "open(my $file, '+<', $ARGV[0]) or die $!; flock($file, LOCK_EX|LOCK_NB) or exit 75",
        path,
      ],
      { encoding: "utf8" },
    );
    if (result.status === 75) return false;
    assert.equal(result.status, 0, result.stderr);
    return true;
  });
}

for (const signal of ["SIGKILL", "SIGTERM"]) {
  test(`execution ${signal} recovery retains inherited writers and admits only one new owner`, async () => {
    const f = fixture();
    const { root, env } = f;
    const script = join(root, ".git/writer.sh");
    const grandScript = join(root, ".git/grand.sh");
    const marker = join(root, ".git/owner-ready");
    const runs = join(root, ".git/fork-package/runs");
    mkdirSync(runs, { recursive: true });
    const record = join(runs, "run.crashed");
    const partial = join(runs, "run.partial");
    let owner;
    const descendants = [];
    const contenders = [];
    try {
      writeFileSync(
        grandScript,
        `#!/bin/bash\necho $$ > '${root}/.git/grand-pid'\nwhile [ ! -f '${root}/.git/leave' ]; do sleep .05; done\n`,
      );
      writeFileSync(
        script,
        `#!/bin/bash\n'${process.execPath}' '${stateTool}' journal '${record}' tests\n: > '${partial}'\necho $$ > '${root}/.git/shell-pid'\nbash '${grandScript}' &\ntouch '${marker}'\nwait\n`,
      );
      owner = spawn(process.execPath, [execution, script], {
        cwd: root,
        env,
        stdio: "ignore",
      });
      const exited = completed(owner);
      await waitFor(
        () => existsSync(marker) && existsSync(join(root, ".git/grand-pid")),
      );
      const shell = Number(readFileSync(join(root, ".git/shell-pid"), "utf8"));
      const grand = Number(readFileSync(join(root, ".git/grand-pid"), "utf8"));
      descendants.push(shell, grand);
      owner.kill(signal);
      assert.notEqual((await exited).code, 0);
      if (signal === "SIGKILL") {
        assert.equal(alive(grand), true);
        assert.equal(
          JSON.parse(readFileSync(record, "utf8")).status,
          undefined,
        );
        assert.match(f.run("--preflight").stderr, /仍持有/);
        process.kill(shell, "SIGKILL");
        await waitFor(() => !alive(shell));
        assert.match(f.run("--preflight").stderr, /仍持有/);
        process.kill(grand, "SIGTERM");
      }
      await waitFor(() => !alive(shell) && !alive(grand));
      await waitForKernelRelease(join(root, ".git/fork-execution.lock"));
      const gate = join(root, ".git/new-ready");
      writeFileSync(
        script,
        `#!/bin/bash\necho x >> '${root}/.git/owners'\ntouch '${gate}'\nwhile [ ! -f '${root}/.git/release-new' ]; do sleep .05; done\n`,
      );
      const endings = [];
      for (let i = 0; i < 2; i++) {
        const next = spawn(process.execPath, [execution, script], {
          cwd: root,
          env,
          stdio: "ignore",
        });
        contenders.push(next);
        endings.push(completed(next));
      }
      await waitFor(() => existsSync(gate));
      assert.equal((await Promise.race(endings)).code, 1);
      assert.equal(readFileSync(join(root, ".git/owners"), "utf8"), "x\n");
      assert.match(f.run("--preflight").stderr, /仍持有/);
      writeFileSync(join(root, ".git/release-new"), "release");
      assert.deepEqual(
        (await Promise.all(endings)).map(({ code }) => code).sort(),
        [0, 1],
      );
      assert.equal(f.run("--preflight").status, 0);
      const recovered = JSON.parse(readFileSync(record, "utf8"));
      assert.equal(recovered.status, "interrupted");
      assert.equal(recovered.phases.at(-1).status, "interrupted");
      assert.equal(
        JSON.parse(readFileSync(partial, "utf8")).status,
        "interrupted",
      );
    } finally {
      owner?.kill("SIGKILL");
      for (const child of contenders) child.kill("SIGKILL");
      for (const pid of descendants) {
        if (alive(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }
      f.cleanup();
    }
  });
}

test("SIGKILL stage recovery waits for its writer, preserves interruption and retries without accepting partial success", async () => {
  const f = fixture();
  const path = join(f.root, ".git/state.json");
  const writerFile = join(f.root, ".git/writer-pid");
  let runner;
  let writer;
  try {
    writeFileSync(path, JSON.stringify({ source: f.base, completed: {} }));
    const command = [
      "bash",
      "-c",
      `echo $$ > '${writerFile}'; while [ ! -f '${f.root}/.git/leave' ]; do sleep .05; done`,
    ];
    runner = spawn(
      process.execPath,
      [stateTool, "run", path, "tests", f.root, ...command],
      { cwd: f.root, env: f.env, stdio: "ignore" },
    );
    const exited = completed(runner);
    await waitFor(() => existsSync(writerFile));
    writer = Number(readFileSync(writerFile, "utf8"));
    runner.kill("SIGKILL");
    assert.equal((await exited).signal, "SIGKILL");
    assert.equal(alive(writer), true);
    const retry = () =>
      spawnSync(
        process.execPath,
        [
          stateTool,
          "run",
          path,
          "tests",
          f.root,
          process.execPath,
          "-e",
          "require('node:fs').appendFileSync('.git/retried','x')",
        ],
        { cwd: f.root, env: f.env, encoding: "utf8" },
      );
    const busy = retry();
    assert.equal(busy.status, 1);
    assert.match(busy.stderr, /仍持有/);
    assert.equal(
      JSON.parse(readFileSync(path, "utf8")).completed.tests,
      undefined,
    );
    writeFileSync(join(f.root, ".git/leave"), "leave");
    await waitFor(() => !alive(writer));
    await waitForKernelRelease(`${path}.lock`);
    const result = retry();
    assert.equal(result.status, 0, result.stderr);
    const state = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(state.events.at(-2).status, "interrupted");
    assert.equal(state.events.at(-1).status, "completed");
    assert.equal(readFileSync(join(f.root, ".git/retried"), "utf8"), "x");
  } finally {
    runner?.kill("SIGKILL");
    if (writer && alive(writer)) process.kill(writer, "SIGKILL");
    f.cleanup();
  }
});

test("Perl kernel-lock fallback recovers after SIGKILL without losing inherited writer exclusion", async () => {
  const f = fixture();
  let owner;
  let writer;
  try {
    const utilities = join(f.root, ".git/utilities");
    mkdirSync(utilities);
    for (const name of [
      "git",
      "bash",
      "perl",
      "sleep",
      "systemctl",
      "systemd-run",
    ]) {
      const binary =
        name === "python3"
          ? execFileSync(
              "python3",
              ["-c", "import sys; print(sys.executable)"],
              { encoding: "utf8" },
            ).trim()
          : execFileSync("bash", ["-c", `command -v ${name}`], {
              encoding: "utf8",
            }).trim();
      symlinkSync(binary, join(utilities, name));
    }
    const env = { ...f.env, PATH: utilities };
    const hold = join(f.root, ".git/hold.sh");
    const once = join(f.root, ".git/once.sh");
    const pidFile = join(f.root, ".git/pid");
    writeFileSync(
      hold,
      `#!/bin/bash\necho $$ > '${pidFile}'\nwhile [ ! -f '${f.root}/.git/leave' ]; do sleep .05; done\n`,
    );
    writeFileSync(
      once,
      `#!/bin/bash\necho success > '${f.root}/.git/recovered'\n`,
    );
    owner = spawn(process.execPath, [execution, hold], {
      cwd: f.root,
      env,
      stdio: "ignore",
    });
    const exited = completed(owner);
    await waitFor(() => existsSync(pidFile));
    writer = Number(readFileSync(pidFile, "utf8"));
    owner.kill("SIGKILL");
    await exited;
    const retry = () =>
      spawnSync(process.execPath, [execution, once], {
        cwd: f.root,
        env,
        encoding: "utf8",
      });
    assert.match(retry().stderr, /仍持有/);
    writeFileSync(join(f.root, ".git/leave"), "leave");
    await waitFor(() => !alive(writer));
    await waitForKernelRelease(join(f.root, ".git/fork-execution.lock"));
    const result = retry();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(f.root, ".git/recovered"), "utf8"),
      "success\n",
    );
  } finally {
    owner?.kill("SIGKILL");
    if (writer && alive(writer)) process.kill(writer, "SIGKILL");
    f.cleanup();
  }
});

test("actual runtime helper supervision excludes recovery while detached Node writers outlive the runner and wrappers", async () => {
  const f = fixture();
  const state = join(f.root, ".git/state.json");
  const writerPath = join(f.root, ".git/writer.cjs");
  const turbo = join(f.root, "node_modules/turbo/bin");
  const children = [];
  let runner;
  try {
    writeFileSync(
      join(f.root, "package.json"),
      JSON.stringify({ name: "fixture", private: true }),
    );
    const source = f.commit("runtime fixture");
    f.git("push", "-q", "origin", "HEAD:refs/heads/aggregate");
    mkdirSync(turbo, { recursive: true });
    writeFileSync(
      join(turbo, "../package.json"),
      JSON.stringify({ name: "turbo" }),
    );
    writeFileSync(
      writerPath,
      "const f=require('node:fs');f.writeFileSync('.git/writer-pid',String(process.pid));setInterval(()=>f.appendFileSync('.git/writes','x'),20)",
    );
    writeFileSync(
      join(turbo, "turbo"),
      `const f=require('node:fs');f.writeFileSync('.git/helper-pid',String(process.ppid));f.writeFileSync('.git/turbo-pid',String(process.pid));require('node:child_process').spawn(process.execPath,[${JSON.stringify(writerPath)}],{stdio:'ignore',detached:true});setInterval(()=>{},1000)`,
    );
    writeFileSync(state, JSON.stringify({ source, completed: {} }));
    runner = spawn(
      process.execPath,
      [
        stateTool,
        "run",
        state,
        "runtime",
        f.root,
        process.execPath,
        new URL(
          "../.bb/skills/local-aggregate-deploy/scripts/build-runtime.mjs",
          import.meta.url,
        ).pathname,
        "--repo",
        f.root,
      ],
      { cwd: f.root, env: f.env, stdio: "ignore" },
    );
    const done = completed(runner);
    await waitFor(() => existsSync(join(f.root, ".git/writes")));
    for (const file of ["helper-pid", "turbo-pid", "writer-pid"])
      children.push(Number(readFileSync(join(f.root, `.git/${file}`), "utf8")));
    runner.kill("SIGKILL");
    await done;
    process.kill(children[0], "SIGKILL");
    process.kill(children[1], "SIGKILL");
    const writer = children[2];
    await waitFor(() => !alive(children[0]) && !alive(children[1]));
    assert.equal(alive(writer), true);
    const count = readFileSync(join(f.root, ".git/writes"), "utf8").length;
    const retry = () =>
      spawnSync(
        process.execPath,
        [
          stateTool,
          "run",
          state,
          "runtime",
          f.root,
          process.execPath,
          "-e",
          "require('node:fs').writeFileSync('.git/recovered','yes')",
        ],
        { cwd: f.root, env: f.env, encoding: "utf8" },
      );
    const blocked = retry();
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /仍持有/);
    await waitFor(
      () => readFileSync(join(f.root, ".git/writes"), "utf8").length > count,
    );
    assert.equal(
      JSON.parse(readFileSync(state, "utf8")).completed.runtime,
      undefined,
    );
    process.kill(writer, "SIGTERM");
    await waitFor(() => !alive(writer));
    await waitForKernelRelease(`${state}.lock`);
    const resumed = retry();
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(readFileSync(join(f.root, ".git/recovered"), "utf8"), "yes");
    assert.equal(
      JSON.parse(readFileSync(state, "utf8")).events.at(-2).status,
      "interrupted",
    );
  } finally {
    runner?.kill("SIGKILL");
    for (const pid of children) if (alive(pid)) process.kill(pid, "SIGKILL");
    f.cleanup();
  }
});

for (const outer of [false, true])
  test(`${outer ? "nested execution TERM" : "TERM"} bounds cleanup when the Node wrapper exits and its pipe-inheriting writer ignores TERM`, async () => {
    const f = fixture();
    const state = join(f.root, ".git/state.json");
    const writerPath = join(f.root, ".git/writer.cjs");
    let runner;
    let writer;
    try {
      writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
      writeFileSync(
        writerPath,
        "const f=require('node:fs');process.on('SIGTERM',()=>{});f.writeFileSync('.git/writer-pid',String(process.pid));setInterval(()=>f.appendFileSync('.git/writes','x'),20)",
      );
      const wrapper = `require('node:fs').writeFileSync('.git/wrapper-pid',String(process.pid));require('node:child_process').spawn(process.execPath,[${JSON.stringify(writerPath)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
      const launcher = join(f.root, ".git/launch.sh");
      writeFileSync(join(f.root, ".git/wrapper.cjs"), wrapper);
      writeFileSync(
        launcher,
        `#!/bin/bash\nexec '${process.execPath}' '${stateTool}' run '${state}' tests '${f.root}' '${process.execPath}' '${f.root}/.git/wrapper.cjs'\n`,
      );
      runner = spawn(
        process.execPath,
        outer
          ? [execution, launcher]
          : [
              stateTool,
              "run",
              state,
              "tests",
              f.root,
              process.execPath,
              "-e",
              wrapper,
            ],
        { cwd: f.root, env: f.env, stdio: "ignore" },
      );
      const done = completed(runner);
      await waitFor(() => existsSync(join(f.root, ".git/writes")));
      writer = Number(readFileSync(join(f.root, ".git/writer-pid"), "utf8"));
      const wrapperPid = Number(
        readFileSync(join(f.root, ".git/wrapper-pid"), "utf8"),
      );
      const started = Date.now();
      runner.kill("SIGTERM");
      await waitFor(() => !alive(wrapperPid));
      assert.equal(alive(writer), true);
      let timer;
      try {
        const outcome = await Promise.race([
          done,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("TERM cleanup exceeded 6s")),
              6000,
            );
          }),
        ]);
        assert.notEqual(outcome.code, 0);
      } finally {
        clearTimeout(timer);
      }
      assert.ok(Date.now() - started < 6000);
      assert.equal(alive(writer), false);
      const failed = JSON.parse(readFileSync(state, "utf8"));
      if (!outer) assert.equal(failed.events.at(-1).status, "interrupted");
      assert.equal(failed.completed.tests, undefined);
      if (!outer) assert.equal(failed.running, undefined);
      await runStage(state, "tests", f.root, [
        process.execPath,
        "-e",
        "process.exit(0)",
      ]);
    } finally {
      runner?.kill("SIGKILL");
      if (writer && alive(writer)) process.kill(writer, "SIGKILL");
      f.cleanup();
    }
  });

test("workspace dependency redirection and missing workspace installation roots force reinstall and observable revalidation", async () => {
  const f = fixture();
  const state = join(f.root, ".git/state.json");
  try {
    mkdirSync(join(f.root, "packages/a"), { recursive: true });
    writeFileSync(
      join(f.root, "packages/a/package.json"),
      JSON.stringify({ name: "workspace-a" }),
    );
    writeFileSync(
      join(f.root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/a:\n    dependencies: {}\n",
    );
    f.commit("workspace layout");
    const installCode =
      "const f=require('node:fs');f.mkdirSync('node_modules',{recursive:true});f.writeFileSync('node_modules/.modules.yaml','installed');for(const value of ['good','bad']){const p='node_modules/.pnpm/'+value+'/node_modules/dep';f.mkdirSync(p,{recursive:true});f.writeFileSync(p+'/index.js','module.exports='+JSON.stringify(value))}f.mkdirSync('packages/a/node_modules',{recursive:true});f.rmSync('packages/a/node_modules/dep',{recursive:true,force:true});f.symlinkSync('../../../node_modules/.pnpm/good/node_modules/dep','packages/a/node_modules/dep');f.appendFileSync('.git/installs','x')";
    const checkCode =
      "const f=require('node:fs');f.appendFileSync('.git/checks','x');if(require('./packages/a/node_modules/dep')!=='good')process.exit(9)";
    const install = [process.execPath, "-e", installCode];
    const check = [process.execPath, "-e", checkCode];
    writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
    await runStage(state, "install", f.root, install);
    await runStage(state, "tests", f.root, check);
    rmSync(join(f.root, "packages/a/node_modules/dep"));
    symlinkSync(
      "../../../node_modules/.pnpm/bad/node_modules/dep",
      join(f.root, "packages/a/node_modules/dep"),
    );
    assert.equal(
      spawnSync(process.execPath, ["-e", checkCode], { cwd: f.root }).status,
      9,
    );
    await runStage(state, "install", f.root, install);
    await runStage(state, "tests", f.root, check);
    assert.equal(readFileSync(join(f.root, ".git/installs"), "utf8"), "xx");
    assert.equal(readFileSync(join(f.root, ".git/checks"), "utf8"), "xxx");
    rmSync(join(f.root, "packages/a/node_modules"), { recursive: true });
    await runStage(state, "install", f.root, install);
    await runStage(state, "tests", f.root, check);
    assert.equal(readFileSync(join(f.root, ".git/installs"), "utf8"), "xxx");
    assert.equal(readFileSync(join(f.root, ".git/checks"), "utf8"), "xxxx");
  } finally {
    f.cleanup();
  }
});

test("declared bundled runtime changes and previously absent output roots invalidate stage receipts", async () => {
  const f = fixture();
  const state = join(f.root, ".git/state.json");
  try {
    mkdirSync(join(f.root, "plugins/a"), { recursive: true });
    writeFileSync(
      join(f.root, "plugins/a/package.json"),
      JSON.stringify({ name: "plugin-a" }),
    );
    writeFileSync(
      join(f.root, "turbo.json"),
      JSON.stringify({
        tasks: {
          build: { outputs: ["dist/**"] },
          "prepare:bundled": { outputs: [".bundled-runtime/**"] },
        },
      }),
    );
    writeFileSync(
      join(f.root, ".gitignore"),
      ".worktrees/\nnode_modules/\ndist/\n.bundled-runtime/\n",
    );
    f.commit("declared outputs");
    mkdirSync(join(f.root, "plugins/a/.bundled-runtime"));
    writeFileSync(join(f.root, "plugins/a/.bundled-runtime/value"), "first");
    writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
    const command = [
      process.execPath,
      "-e",
      "const f=require('node:fs');f.mkdirSync('dist',{recursive:true});f.writeFileSync('dist/value',f.readFileSync('plugins/a/.bundled-runtime/value'));f.appendFileSync('.git/builds','x')",
    ];
    await runStage(state, "runtime", f.root, command);
    await runStage(state, "runtime", f.root, command);
    assert.equal(readFileSync(join(f.root, ".git/builds"), "utf8"), "x");
    writeFileSync(join(f.root, "plugins/a/.bundled-runtime/value"), "second");
    await runStage(state, "runtime", f.root, command);
    assert.equal(readFileSync(join(f.root, "dist/value"), "utf8"), "second");
    mkdirSync(join(f.root, "plugins/a/dist"));
    writeFileSync(join(f.root, "plugins/a/dist/new"), "new root");
    await runStage(state, "runtime", f.root, command);
    assert.equal(readFileSync(join(f.root, ".git/builds"), "utf8"), "xxx");
  } finally {
    f.cleanup();
  }
});

function ownedPlans(path) {
  const owner = readOwner(`${path}.lock`);
  return {
    owner,
    plans: readdirSync(ownerDirectory(owner))
      .filter((name) => name.endsWith(".plan"))
      .map((name) =>
        JSON.parse(readFileSync(join(ownerDirectory(owner), name), "utf8")),
      ),
  };
}

function boundMicroScopes(path) {
  for (const plan of ownedPlans(path).plans) {
    const unit = queryUnits([plan.name]).get(plan.name);
    if (unit.LoadState === "loaded" && unit.ActiveState === "active") {
      const result = spawnSync(
        "systemctl",
        ["--user", "show", plan.name, "-p", "RuntimeMaxUSec", "--value"],
        { env: managerEnv(), encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout.trim(), /20s/);
    }
  }
}

function retryStage(
  f,
  state,
  code = "require('node:fs').writeFileSync('.git/recovered','yes')",
  env = f.env,
) {
  return spawnSync(
    process.execPath,
    [stateTool, "run", state, "tests", f.root, process.execPath, "-e", code],
    { cwd: f.root, env, encoding: "utf8" },
  );
}

test("kernel Slice retains orphaned Node writers after all controllers die, fails closed on bus errors and serializes recovery", async () => {
  const f = fixture();
  const state = join(f.root, ".git/state.json");
  const writerPath = join(f.root, ".git/native-writer.cjs");
  const pids = [];
  let runner;
  const contenders = [];
  try {
    writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
    writeFileSync(
      writerPath,
      "const f=require('node:fs');f.writeFileSync('.git/writer',String(process.pid));setInterval(()=>f.appendFileSync('.git/writes','x'),20)",
    );
    const wrapper = `const f=require('node:fs');f.writeFileSync('.git/launcher',String(process.ppid));f.writeFileSync('.git/command',String(process.pid));require('node:child_process').spawn(process.execPath,[${JSON.stringify(writerPath)}],{stdio:'ignore',detached:true});setInterval(()=>{},1000)`;
    runner = spawn(
      process.execPath,
      [
        stateTool,
        "run",
        state,
        "tests",
        f.root,
        process.execPath,
        "-e",
        wrapper,
      ],
      { cwd: f.root, env: f.env, stdio: "ignore" },
    );
    const dead = completed(runner);
    await waitFor(() => existsSync(join(f.root, ".git/writes")));
    boundMicroScopes(state);
    for (const name of ["launcher", "command", "writer"])
      pids.push(Number(readFileSync(join(f.root, `.git/${name}`), "utf8")));
    const { owner } = ownedPlans(state);
    const original = readFileSync(`${state}.lock.owner.json`, "utf8");
    runner.kill("SIGKILL");
    await dead;
    process.kill(pids[0], "SIGKILL");
    process.kill(pids[1], "SIGKILL");
    await waitFor(() => !alive(pids[0]) && !alive(pids[1]));
    assert.equal(alive(pids[2]), true);
    const before = readFileSync(join(f.root, ".git/writes"), "utf8").length;
    const unavailable = retryStage(f, state, "process.exit(0)", {
      ...f.env,
      XDG_RUNTIME_DIR: `${f.root}/.git/no-runtime`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${f.root}/.git/no-bus`,
    });
    assert.equal(unavailable.status, 1);
    assert.match(unavailable.stderr, /保留记录|归属查询/);
    assert.equal(readFileSync(`${state}.lock.owner.json`, "utf8"), original);
    const blocked = retryStage(f, state);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /内核 writer/);
    assert.ok(
      readFileSync(join(f.root, ".git/writes"), "utf8").length > before,
    );
    assert.ok(inspectOwner(owner).busy.length > 0);
    assert.equal(
      JSON.parse(readFileSync(state, "utf8")).completed.tests,
      undefined,
    );
    process.kill(pids[2], "SIGTERM");
    await waitFor(() => !alive(pids[2]));
    const ready = join(f.root, ".git/recovery-ready");
    const program =
      "const f=require('node:fs');f.appendFileSync('.git/recovery-count','x');f.writeFileSync('.git/recovery-ready','yes');const t=setInterval(()=>{if(f.existsSync('.git/release')){clearInterval(t)}},20)";
    const exits = [];
    for (let i = 0; i < 2; i++) {
      const child = spawn(
        process.execPath,
        [
          stateTool,
          "run",
          state,
          "tests",
          f.root,
          process.execPath,
          "-e",
          program,
        ],
        { cwd: f.root, env: f.env, stdio: "ignore" },
      );
      contenders.push(child);
      exits.push(completed(child));
    }
    await waitFor(() => existsSync(ready));
    boundMicroScopes(state);
    assert.equal((await Promise.race(exits)).code, 1);
    assert.equal(
      readFileSync(join(f.root, ".git/recovery-count"), "utf8"),
      "x",
    );
    assert.equal(retryStage(f, state).status, 1);
    writeFileSync(join(f.root, ".git/release"), "release");
    assert.deepEqual(
      (await Promise.all(exits)).map(({ code }) => code).sort(),
      [0, 1],
    );
    const final = JSON.parse(readFileSync(state, "utf8"));
    assert.equal(final.events.at(-2).status, "interrupted");
    assert.equal(final.events.at(-1).status, "completed");
  } finally {
    runner?.kill("SIGKILL");
    for (const child of contenders) child.kill("SIGKILL");
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    f.cleanup();
  }
});

test("a writer regrouped into another real scope remains in its execution Slice after the origin scope and controllers exit", async () => {
  const f = fixture();
  const state = join(f.root, ".git/state.json");
  const mover = join(f.root, ".git/move.sh");
  const payload = join(f.root, ".git/moved.cjs");
  const writerPath = join(f.root, ".git/writer.cjs");
  const enter = new URL("./fork-cgroup-enter.mjs", import.meta.url).pathname;
  const unit = `bb-fork-${randomUUID()}.scope`;
  const pids = [];
  let runner;
  try {
    writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
    writeFileSync(
      writerPath,
      "const f=require('node:fs');f.writeFileSync('.git/writer',String(process.pid));setInterval(()=>f.appendFileSync('.git/writes','x'),20)",
    );
    writeFileSync(
      payload,
      `const f=require('node:fs');f.writeFileSync('.git/new-launcher',String(process.ppid));f.writeFileSync('.git/command',String(process.pid));require('node:child_process').spawn(process.execPath,[${JSON.stringify(writerPath)}],{stdio:'ignore',detached:true});setInterval(()=>{},1000)`,
    );
    writeFileSync(
      mover,
      `#!/bin/bash\necho "$PPID" > '${f.root}/.git/old-launcher'\nexec systemd-run --user --scope --collect --quiet --slice-inherit --unit='${unit}' -p RuntimeMaxSec=20s -p TimeoutStopSec=3s -- '${process.execPath}' '${enter}' resource "$BB_FORK_CGROUP_PLAN" -- '${process.execPath}' '${payload}'\n`,
    );
    runner = spawn(
      process.execPath,
      [stateTool, "run", state, "tests", f.root, "bash", mover],
      { cwd: f.root, env: f.env, stdio: "ignore" },
    );
    const dead = completed(runner);
    await waitFor(() => existsSync(join(f.root, ".git/writes")));
    boundMicroScopes(state);
    const originalScope = ownedPlans(state).plans[0].name;
    for (const name of ["old-launcher", "new-launcher", "command", "writer"])
      pids.push(Number(readFileSync(join(f.root, `.git/${name}`), "utf8")));
    runner.kill("SIGKILL");
    await dead;
    for (const pid of pids.slice(0, 3)) process.kill(pid, "SIGKILL");
    await waitFor(() => pids.slice(0, 3).every((pid) => !alive(pid)));
    const units = queryUnits([originalScope, unit]);
    assert.equal(units.get(originalScope).ActiveState, "inactive");
    assert.equal(units.get(unit).ActiveState, "active");
    assert.equal(alive(pids[3]), true);
    const blocked = retryStage(f, state);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /内核 writer/);
    process.kill(pids[3], "SIGTERM");
    await waitFor(() => !alive(pids[3]));
    const recovered = retryStage(f, state);
    assert.equal(recovered.status, 0, recovered.stderr);
  } finally {
    runner?.kill("SIGKILL");
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    f.cleanup();
  }
});

test("same-named replacement units are not claimed or killed as the old execution instance", async () => {
  const f = fixture();
  const state = join(f.root, ".git/state.json");
  let foreign;
  let slice;
  let scope;
  try {
    writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
    await runStage(state, "tests", f.root, [
      process.execPath,
      "-e",
      "process.exit(0)",
    ]);
    const { owner, plans } = ownedPlans(state);
    const record = inspectOwner(owner).entries.find(
      (entry) => entry.invocation,
    );
    slice = record.name;
    scope = plans[0].name;
    const stopped = spawnSync("systemctl", ["--user", "stop", slice], {
      env: managerEnv(f.env),
      encoding: "utf8",
    });
    assert.equal(stopped.status, 0, stopped.stderr);
    const code =
      "const f=require('node:fs');f.writeFileSync('.git/foreign-ready','yes');setInterval(()=>f.appendFileSync('.git/foreign-writes','x'),20)";
    foreign = spawn(
      "systemd-run",
      [
        "--user",
        "--scope",
        "--collect",
        "--quiet",
        `--unit=${scope}`,
        `--slice=${slice}`,
        "-p",
        "RuntimeMaxSec=20s",
        "--",
        process.execPath,
        "-e",
        code,
      ],
      { cwd: f.root, env: managerEnv(f.env), stdio: "ignore" },
    );
    const dead = completed(foreign);
    await waitFor(() => existsSync(join(f.root, ".git/foreign-writes")));
    const replacement = queryUnits([slice]).get(slice);
    assert.notEqual(replacement.InvocationID, record.invocation);
    const recovered = retryStage(f, state);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(
      queryUnits([slice]).get(slice).InvocationID,
      replacement.InvocationID,
    );
    const before = readFileSync(
      join(f.root, ".git/foreign-writes"),
      "utf8",
    ).length;
    await waitFor(
      () =>
        readFileSync(join(f.root, ".git/foreign-writes"), "utf8").length >
        before,
    );
    const result = spawnSync("systemctl", ["--user", "stop", scope], {
      env: managerEnv(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    await dead;
  } finally {
    if (scope)
      spawnSync("systemctl", ["--user", "stop", scope], {
        env: managerEnv(),
        encoding: "utf8",
      });
    if (slice)
      spawnSync("systemctl", ["--user", "stop", slice], {
        env: managerEnv(),
        encoding: "utf8",
      });
    foreign?.kill("SIGKILL");
    f.cleanup();
  }
});

function microResourceWrapper(f) {
  mkdirSync(join(f.root, "scripts"));
  const wrapper = join(f.root, "scripts/run-resource-isolated");
  const unit = `bb-fork-${randomUUID()}`;
  const actual = readFileSync(
    new URL("./run-resource-isolated", import.meta.url),
    "utf8",
  );
  assert.ok(actual.includes("unit_name='bb-local-verification'"));
  writeFileSync(
    wrapper,
    actual.replace("unit_name='bb-local-verification'", `unit_name='${unit}'`),
  );
  for (const name of ["resource-profile.mjs", "resource-runtime.mjs"])
    writeFileSync(
      join(f.root, "scripts", name),
      readFileSync(new URL(`./${name}`, import.meta.url)),
    );
  chmodSync(wrapper, 0o755);
  return { wrapper, unit };
}

test("the actual resource wrapper preserves Slice ownership and refuses a recursively populated micro scope", async () => {
  const f = fixture();
  const state = join(f.root, ".git/state.json");
  let task;
  try {
    const { wrapper, unit } = microResourceWrapper(f);
    f.commit("isolated resource wrapper");
    writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
    const child =
      "const f=require('node:fs');f.writeFileSync(process.argv[1]+'/cgroup.procs',String(process.pid));f.writeFileSync('.git/child-ready','yes');const t=setInterval(()=>{f.appendFileSync('.git/child-writes','x');if(f.existsSync('.git/release'))clearInterval(t)},20)";
    const program = `const f=require('node:fs');const group=f.readFileSync('/proc/self/cgroup','utf8').trim().split(':').at(-1);f.writeFileSync('.git/resource',JSON.stringify({group,memoryMax:f.readFileSync('/sys/fs/cgroup'+group+'/memory.max','utf8').trim(),cpuMax:f.readFileSync('/sys/fs/cgroup'+group+'/cpu.max','utf8').trim()}));const path='/sys/fs/cgroup'+group+'/bb-fork-micro-child';f.mkdirSync(path);require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)},path],{stdio:'ignore',detached:true}).unref()`;
    task = runStage(state, "tests", f.root, [
      wrapper,
      "--profile",
      "package",
      "--",
      process.execPath,
      "-e",
      program,
    ]);
    task.catch(() => {});
    await waitFor(() => existsSync(join(f.root, ".git/child-writes")));
    const observed = JSON.parse(
      readFileSync(join(f.root, ".git/resource"), "utf8"),
    );
    await waitFor(
      () =>
        readFileSync(
          `/sys/fs/cgroup${observed.group}/cgroup.procs`,
          "utf8",
        ).trim() === "",
    );
    const owner = ownedPlans(state).owner;
    const entry = inspectOwner(owner).entries.find((item) => item.invocation);
    assert.ok(observed.group.startsWith(`${entry.cgroup}/`));
    assert.ok(observed.group.endsWith(`/${unit}.scope`));
    assert.notEqual(observed.memoryMax, "max");
    assert.notEqual(observed.cpuMax.split(" ")[0], "max");
    const before = queryUnits([`${unit}.scope`]).get(
      `${unit}.scope`,
    ).InvocationID;
    const refused = spawnSync(wrapper, ["--profile", "package", "--", "true"], {
      cwd: f.root,
      env: managerEnv(f.env),
      encoding: "utf8",
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Another .* job is still running/);
    assert.equal(
      queryUnits([`${unit}.scope`]).get(`${unit}.scope`).InvocationID,
      before,
    );
    assert.equal(
      JSON.parse(readFileSync(state, "utf8")).completed.tests,
      undefined,
    );
    writeFileSync(join(f.root, ".git/release"), "release");
    await task;
    assert.equal(
      JSON.parse(readFileSync(state, "utf8")).events.at(-1).status,
      "completed",
    );
  } finally {
    writeFileSync(join(f.root, ".git/release"), "release");
    await task?.catch(() => {});
    f.cleanup();
  }
});

test("nested resource calls inherit a frozen budget and refuse profile upgrades without touching the writer", () => {
  const f = fixture();
  try {
    const { wrapper } = microResourceWrapper(f);
    const env = {
      ...managerEnv(f.env),
      BB_RESOURCE_MEMORY_MAX_BYTES: String(1024 ** 3),
      BB_RESOURCE_MEMORY_HIGH_BYTES: String(768 * 1024 ** 2),
      BB_RESOURCE_CPU_QUOTA_PERCENT: "100",
      BB_RESOURCE_VITEST_WORKERS: "1",
    };
    delete env.BB_RESOURCE_BUDGET;
    const script = `const c=require('node:child_process'); const before=process.env.BB_RESOURCE_BUDGET; const nested=c.spawnSync(${JSON.stringify(wrapper)},['--profile','verification','--',process.execPath,'-e','process.stdout.write(process.env.BB_RESOURCE_BUDGET)'],{env:{...process.env,BB_RESOURCE_MEMORY_MAX_BYTES:'1',BB_RESOURCE_CPU_QUOTA_PERCENT:'999999'},encoding:'utf8'}); if(nested.status!==0) throw Error(nested.stderr); if(nested.stdout!==before) throw Error('budget drift'); process.stdout.write(before)`;
    const result = spawnSync(
      wrapper,
      ["--profile", "package", "--", process.execPath, "-e", script],
      { cwd: f.root, env, encoding: "utf8", timeout: 15000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).selected.memoryMaxBytes, 1024 ** 3);
    const upgrade = spawnSync(
      wrapper,
      [
        "--",
        wrapper,
        "--profile",
        "package",
        "--",
        "touch",
        ".git/should-not-run",
      ],
      { cwd: f.root, env, encoding: "utf8", timeout: 15000 },
    );
    assert.notEqual(upgrade.status, 0);
    assert.match(upgrade.stderr, /Cannot upgrade/);
    assert.equal(existsSync(join(f.root, ".git/should-not-run")), false);
  } finally {
    f.cleanup();
  }
});

test("selected resource changes invalidate stage success and malformed budgets leave failed state", () => {
  const f = fixture();
  try {
    const { wrapper } = microResourceWrapper(f);
    f.commit("budget fixture");
    const state = join(f.root, ".git/state.json");
    writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
    const tool = new URL("./resource-runtime.mjs", import.meta.url).pathname;
    const env = {
      ...managerEnv(f.env),
      BB_RESOURCE_MEMORY_MAX_BYTES: String(1024 ** 3),
      BB_RESOURCE_MEMORY_HIGH_BYTES: String(768 * 1024 ** 2),
      BB_RESOURCE_CPU_QUOTA_PERCENT: "100",
      BB_RESOURCE_VITEST_WORKERS: "1",
    };
    delete env.BB_RESOURCE_BUDGET;
    env.BB_RESOURCE_BUDGET = execFileSync(
      process.execPath,
      [tool, "select", "package"],
      { env, encoding: "utf8" },
    ).trim();
    const args = [
      stateTool,
      "run",
      state,
      "tests",
      f.root,
      wrapper,
      "--profile",
      "package",
      "--",
      "true",
    ];
    const run = () =>
      spawnSync(process.execPath, args, {
        cwd: f.root,
        env,
        encoding: "utf8",
        timeout: 15000,
      });
    assert.equal(run().status, 0);
    assert.equal(run().status, 0);
    assert.equal(
      JSON.parse(readFileSync(state, "utf8")).events.at(-1).status,
      "reused",
    );
    const budget = JSON.parse(env.BB_RESOURCE_BUDGET);
    budget.selected.cpuQuotaPercent = 50;
    env.BB_RESOURCE_BUDGET = JSON.stringify(budget);
    const changed = run();
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(
      JSON.parse(readFileSync(state, "utf8")).events.at(-1).status,
      "completed",
    );
    env.BB_RESOURCE_BUDGET = "{}";
    assert.notEqual(run().status, 0);
    const failed = JSON.parse(readFileSync(state, "utf8"));
    assert.equal(failed.events.at(-1).status, "failed");
    assert.equal(failed.completed.tests, undefined);
  } finally {
    f.cleanup();
  }
});

test("empty ownership cleanup cannot terminate a replacement created after its final check", async () => {
  const f = fixture();
  const state = join(f.root, ".git/state.json");
  let slice;
  const scope = `bb-fork-${randomUUID()}.scope`;
  try {
    writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
    await runStage(state, "tests", f.root, [
      process.execPath,
      "-e",
      "process.exit(0)",
    ]);
    const { owner } = ownedPlans(state);
    const entry = inspectOwner(owner).entries.find((value) => value.invocation);
    slice = entry.name;
    const unitsAfterExit = queryUnits([slice, ownedPlans(state).plans[0].name]);
    const empty = unitsAfterExit.get(slice);
    console.log(
      JSON.stringify({
        emptySlice: {
          load: empty.LoadState,
          active: empty.ActiveState,
          populated: readFileSync(
            `/sys/fs/cgroup${empty.ControlGroup}/cgroup.events`,
            "utf8",
          ).match(/^populated (\d)$/m)?.[1],
        },
        exitedScope: unitsAfterExit.get(ownedPlans(state).plans[0].name)
          .LoadState,
      }),
    );
    const realSystemctl = execFileSync("bash", ["-c", "command -v systemctl"], {
      encoding: "utf8",
    }).trim();
    const replace = join(f.root, ".git/replace.sh");
    const marker = join(f.root, ".git/replaced");
    const ready = join(f.root, ".git/new-writes");
    const writer = `require('node:fs').appendFileSync(${JSON.stringify(ready)},'x');setInterval(()=>require('node:fs').appendFileSync(${JSON.stringify(ready)},'x'),20)`;
    writeFileSync(
      replace,
      `#!/bin/bash\nset -eu\n[ ! -f '${marker}' ] || exit 0\ntouch '${marker}'\n'${realSystemctl}' --user stop '${slice}'\nsystemd-run --user --scope --collect --quiet --slice='${slice}' --unit='${scope}' -p RuntimeMaxSec=20s -p TimeoutStopSec=1s -- '${process.execPath}' -e ${JSON.stringify(writer)} >/dev/null 2>&1 &\nfor ((i=0;i<300;i++)); do [ ! -s '${ready}' ] || exit 0; sleep .01; done\nexit 1\n`,
    );
    const shim = join(f.root, ".git/microbin/systemctl");
    writeFileSync(
      shim,
      `#!/bin/bash\nfor arg do if [ "$arg" = stop ]; then bash '${replace}' || exit; break; fi; done\nexec '${realSystemctl}' "$@"\n`,
    );
    chmodSync(shim, 0o755);
    const module = new URL("./fork-cgroup.mjs", import.meta.url).pathname;
    const code = `import {readOwner,cleanupEmpty} from ${JSON.stringify(module)};import {execFileSync} from 'node:child_process';cleanupEmpty(readOwner(${JSON.stringify(`${state}.lock`)}));execFileSync('bash',[${JSON.stringify(replace)}]);`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code],
      { cwd: f.root, env: managerEnv(f.env), encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const replacement = queryUnits([slice]).get(slice);
    assert.notEqual(replacement.InvocationID, entry.invocation);
    assert.equal(queryUnits([scope]).get(scope).ActiveState, "active");
    const before = readFileSync(ready, "utf8").length;
    await waitFor(() => readFileSync(ready, "utf8").length > before);
    assert.equal(queryUnits([scope]).get(scope).ActiveState, "active");
    const saved = readFileSync(`${state}.lock.owner.json`, "utf8");
    const failure = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code],
      {
        cwd: f.root,
        env: {
          ...managerEnv(f.env),
          XDG_RUNTIME_DIR: join(f.root, ".git/no-bus"),
          DBUS_SESSION_BUS_ADDRESS: `unix:path=${f.root}/.git/no-bus/bus`,
        },
        encoding: "utf8",
      },
    );
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /保留记录|归属查询/);
    assert.equal(readFileSync(`${state}.lock.owner.json`, "utf8"), saved);
    assert.equal(queryUnits([scope]).get(scope).ActiveState, "active");
  } finally {
    const real = execFileSync("bash", ["-c", "command -v systemctl"], {
      encoding: "utf8",
    }).trim();
    for (const name of [scope, slice].filter(Boolean))
      spawnSync(real, ["--user", "stop", name], {
        env: managerEnv(),
        stdio: "ignore",
      });
    rmSync(join(f.root, ".git/microbin/systemctl"), { force: true });
    f.cleanup();
  }
});

test("independent execution scopes reuse one state while source, configuration, budget and unknown environment still invalidate", () => {
  const f = fixture();
  try {
    const state = join(f.root, ".git/state.json");
    writeFileSync(state, JSON.stringify({ source: f.base, completed: {} }));
    const shell = join(f.root, ".git/invoke.sh");
    const program =
      "require('node:fs').appendFileSync('.git/execution-count','x')";
    writeFileSync(
      shell,
      `#!/bin/bash\nprintf '%s\\n' "$INVOCATION_ID" >> '${f.root}/.git/invocations'\nexec '${process.execPath}' '${stateTool}' run '${state}' tests '${f.root}' '${process.execPath}' -e '${program}'\n`.replace(
        `'${program}'`,
        JSON.stringify(program),
      ),
    );
    const budgetTool = new URL("./resource-runtime.mjs", import.meta.url)
      .pathname;
    const environment = {
      ...f.env,
      BB_RESOURCE_CPU_QUOTA_PERCENT: "100",
      BB_RESOURCE_MEMORY_MAX_BYTES: String(1024 ** 3),
      BB_RESOURCE_MEMORY_HIGH_BYTES: String(768 * 1024 ** 2),
    };
    delete environment.BB_RESOURCE_BUDGET;
    environment.BB_RESOURCE_BUDGET = execFileSync(
      process.execPath,
      [budgetTool, "select", "package"],
      { env: environment, encoding: "utf8" },
    ).trim();
    const run = () => {
      const result = spawnSync(process.execPath, [execution, shell], {
        cwd: f.root,
        env: environment,
        encoding: "utf8",
        timeout: 15000,
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(readFileSync(state, "utf8")).events.at(-1).status;
    };
    assert.equal(run(), "completed");
    assert.equal(run(), "reused");
    assert.equal(
      readFileSync(join(f.root, ".git/execution-count"), "utf8"),
      "x",
    );
    const ids = readFileSync(join(f.root, ".git/invocations"), "utf8")
      .trim()
      .split("\n");
    assert.match(ids[0], /^[a-f0-9]{32}$/);
    assert.notEqual(ids[0], ids[1]);
    const changed = JSON.parse(readFileSync(state, "utf8"));
    writeFileSync(join(f.root, "file"), "changed source\n");
    changed.source = f.commit("changed source");
    writeFileSync(state, JSON.stringify(changed));
    assert.equal(run(), "completed");
    writeFileSync(
      join(f.root, "package.json"),
      JSON.stringify({ name: "changed", private: true }),
    );
    assert.equal(run(), "completed");
    const budget = JSON.parse(environment.BB_RESOURCE_BUDGET);
    budget.selected.cpuQuotaPercent = 50;
    environment.BB_RESOURCE_BUDGET = JSON.stringify(budget);
    assert.equal(run(), "completed");
    environment.FLOW_REAL_SETTING = "changed";
    assert.equal(run(), "completed");
    assert.equal(run(), "reused");
    assert.equal(
      readFileSync(join(f.root, ".git/execution-count"), "utf8"),
      "xxxxx",
    );
  } finally {
    f.cleanup();
  }
});
