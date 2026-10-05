import {
  mkdtemp,
  mkdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  codexHomeLoginCommand,
  codexExecutionEnv,
  resolveCodexExecution,
} from "./execution-context.js";
import { readCodexAuthFile } from "./ai/codex-auth.js";
import { resolveCodexNativeRoots } from "./native-roots.js";

const directories: string[] = [];

it("quotes the selected home in POSIX and PowerShell login commands", () => {
  expect(codexHomeLoginCommand("/tmp/it's home", "linux")).toBe(
    "env 'CODEX_HOME=/tmp/it'\\''s home' codex login",
  );
  expect(codexHomeLoginCommand("C:\\Users\\it's home", "win32")).toBe(
    "$env:CODEX_HOME='C:\\Users\\it''s home'; codex login",
  );
});
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("reads external credential updates through the existing symlink without publishing a copy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-bound-auth-"));
  directories.push(directory);
  const home = join(directory, "home");
  await mkdir(home);
  const target = join(directory, "shared-auth.json");
  await writeFile(
    target,
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "dummy-before" }),
  );
  await symlink(target, join(home, "auth.json"));
  const env = codexExecutionEnv(
    resolveCodexExecution({
      codexExecution: {
        kind: "home",
        providerId: "codex-bound",
        codexHome: home,
      },
    }),
    {},
  );
  expect(await readCodexAuthFile(env)).toMatchObject({
    state: "ok",
    credentials: { apiKey: "dummy-before" },
  });
  await writeFile(
    target,
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "dummy-after" }),
  );
  expect(await readCodexAuthFile(env)).toMatchObject({
    state: "ok",
    credentials: { apiKey: "dummy-after" },
  });
  expect(await readlink(join(home, "auth.json"))).toBe(target);
});

it("discovers skills from the selected home while preserving the process environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-bound-skills-"));
  directories.push(directory);
  const inherited = {
    CODEX_HOME: join(directory, "other"),
    CODEX_OPENAI_BASE_URL: "https://pool.invalid",
    CODEX_POOL_AUTH_TOKEN: "dummy",
  };
  const env = codexExecutionEnv(
    resolveCodexExecution({
      codexExecution: {
        kind: "home",
        providerId: "codex-bound",
        codexHome: join(directory, "bound"),
      },
    }),
    inherited,
  );
  const roots = await resolveCodexNativeRoots({ homeDir: directory, env });
  expect(roots.skills?.map((root) => root.path)).toContain(
    join(directory, "bound", "skills"),
  );
  expect(roots.skills?.map((root) => root.path)).not.toContain(
    join(directory, "other", "skills"),
  );
  expect(inherited.CODEX_HOME).toBe(join(directory, "other"));
  expect(inherited.CODEX_POOL_AUTH_TOKEN).toBe("dummy");
});
