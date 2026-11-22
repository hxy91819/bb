import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";

const settingsSchema = z.object({
  env: z.object({
    ANTHROPIC_BASE_URL: z.string(),
    ANTHROPIC_AUTH_TOKEN: z.string(),
  }),
});
interface FakeOptions {
  env?: NodeJS.ProcessEnv;
  persistSession?: boolean;
  sessionId?: string;
  resume?: string;
}
function config(env: NodeJS.ProcessEnv) {
  const directory = env.CLAUDE_CONFIG_DIR;
  if (!directory) throw new Error("Missing test configuration directory");
  return {
    directory,
    settings: settingsSchema.parse(
      JSON.parse(readFileSync(join(directory, "settings.json"), "utf8")),
    ),
  };
}
function record(env: NodeJS.ProcessEnv, method: string, resume?: string) {
  const { directory, settings } = config(env);
  if (!env.BB_CLAUDE_HOME_TEST_LOG) throw new Error("Missing execution log");
  appendFileSync(
    env.BB_CLAUDE_HOME_TEST_LOG,
    JSON.stringify({
      method,
      pid: process.pid,
      directory,
      endpoint: settings.env.ANTHROPIC_BASE_URL,
      token: settings.env.ANTHROPIC_AUTH_TOKEN,
      inheritedEndpoint: env.ANTHROPIC_BASE_URL ?? null,
      inheritedToken: env.ANTHROPIC_AUTH_TOKEN ?? null,
      resume: resume ?? null,
    }) + "\n",
  );
  return directory;
}
export function query(args: {
  prompt: AsyncIterable<unknown>;
  options: FakeOptions;
}) {
  const env = args.options.env ?? process.env;
  const directory = record(env, "query", args.options.resume);
  const sessionId =
    args.options.resume ?? args.options.sessionId ?? randomUUID();
  const projects = join(directory, "projects");
  mkdirSync(projects, { recursive: true });
  if (args.options.resume) readFileSync(join(projects, `${sessionId}.json`));
  if (args.options.persistSession !== false)
    writeFileSync(
      join(projects, `${sessionId}.json`),
      JSON.stringify({ sessionId }),
    );
  const stream = (async function* () {
    for await (const _input of args.prompt) {
      record(env, "turn");
      yield {
        type: "result",
        subtype: "success",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: false,
        num_turns: 1,
        result: "ok",
        stop_reason: "end_turn",
        total_cost_usd: 0,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: randomUUID(),
        session_id: sessionId,
      };
    }
  })();
  return Object.assign(stream, {
    initializationResult: async () => ({
      account: {},
      models: [
        {
          value: directory,
          displayName: directory,
          description: "Bound test model",
        },
      ],
      commands: [],
    }),
    close() {},
    async applyFlagSettings() {},
    async setPermissionMode() {},
    async interrupt() {},
    async mcpServerStatus() {
      return [];
    },
    async getContextUsage() {
      return null;
    },
  });
}
export async function forkSession(sourceId: string) {
  const directory = record(process.env, "fork", sourceId);
  const contents = readFileSync(
    join(directory, "projects", `${sourceId}.json`),
  );
  const sessionId = randomUUID();
  writeFileSync(join(directory, "projects", `${sessionId}.json`), contents);
  return { sessionId };
}
export function createSdkMcpServer() {
  return {};
}
export function tool() {
  return {};
}
