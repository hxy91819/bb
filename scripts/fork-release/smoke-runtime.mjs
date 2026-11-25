import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [archiveArg] = process.argv.slice(2);
if (!archiveArg)
  throw new Error("Usage: node smoke-runtime.mjs <archive.tar.gz>");
const archive = resolve(archiveArg);
const temp = await mkdtemp(join(tmpdir(), "bb-fork-smoke-"));
let child;
let output = "";

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const port = server.address().port;
  await new Promise((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return port;
}

try {
  const expectedHash = (await readFile(`${archive}.sha256`, "utf8")).split(
    " ",
  )[0];
  const hash = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (hash !== expectedHash) throw new Error("Archive checksum mismatch");
  execFileSync("tar", ["-xzf", archive, "-C", temp]);
  const entries = await readdir(temp);
  if (entries.length !== 1) throw new Error("Expected one runtime directory");
  const runtime = join(temp, entries[0]);
  const manifest = JSON.parse(
    await readFile(join(runtime, "release.json"), "utf8"),
  );
  if (manifest.platform !== process.platform || manifest.arch !== process.arch)
    throw new Error("Runtime platform mismatch");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("BB_") &&
        !["NODE_OPTIONS", "NODE_PATH", "DATA_DIR"].includes(key),
    ),
  );
  env.HOME = join(temp, "home");
  env.BB_TELEMETRY = "false";
  env.PATH = "/usr/bin:/bin";
  const invoke = (bin, args = []) =>
    execFileSync(join(runtime, "bin", bin), args, {
      cwd: temp,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
  const runtimeNode = invoke("node", ["--version"]).trim();
  if (runtimeNode !== manifest.node)
    throw new Error("Bundled Node version mismatch");
  for (const bin of ["bb", "bb-app", "bb-server", "bb-host-daemon"])
    invoke(bin, ["--help"]);
  const serverPort = await freePort();
  let daemonPort = await freePort();
  while (serverPort === daemonPort) daemonPort = await freePort();
  env.BB_SERVER_URL = `http://127.0.0.1:${serverPort}`;
  child = spawn(
    join(runtime, "bin/bb-app"),
    [
      "--data-dir",
      join(temp, "data"),
      "--server-port",
      String(serverPort),
      "--host-daemon-port",
      String(daemonPort),
    ],
    { cwd: temp, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  child.on("error", (error) => (output += error.message));
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Runtime exited early\n${output}`);
    try {
      const server = await fetch(`${env.BB_SERVER_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      const daemon = await fetch(`http://127.0.0.1:${daemonPort}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (server.ok && daemon.ok) {
        const { plugins } = JSON.parse(
          invoke("bb", ["plugin", "list", "--json"]),
        );
        if (
          ["provider-acp", "provider-codex", "automations"].every((id) =>
            plugins.some(
              (plugin) => plugin.id === id && plugin.status === "running",
            ),
          )
        ) {
          ready = true;
          break;
        }
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready)
    throw new Error(
      `Runtime health or builtin plugin check timed out\n${output}`,
    );
  process.stdout.write(
    `Standalone runtime passed: ${manifest.tag} ${manifest.platform}-${manifest.arch} ${manifest.source}\n`,
  );
} finally {
  if (child?.pid) {
    const exit = new Promise((done) => child.once("exit", done));
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    await Promise.race([exit, new Promise((done) => setTimeout(done, 5000))]);
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  await rm(temp, { recursive: true, force: true });
}
