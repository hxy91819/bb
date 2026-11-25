import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { experimental_formatCommand as formatCommand } from "@get-bb/plugin-sdk/provider-bridge";
import { codexHomeExpressionSchema } from "./home-bindings.js";

const executionOptionsSchema = z
  .object({
    codexExecution: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("default"),
            providerId: z.literal("codex"),
          })
          .strict(),
        z
          .object({
            kind: z.literal("home"),
            providerId: z.string().min(1),
            codexHome: codexHomeExpressionSchema,
          })
          .strict(),
      ])
      .optional(),
  })
  .passthrough();

export interface CodexExecutionContext {
  providerId: string;
  codexHome: string | null;
}

export function codexHomeLoginCommand(
  codexHome: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32")
    return `$env:CODEX_HOME='${codexHome.replace(/'/gu, "''")}'; codex login`;
  return formatCommand("env", [`CODEX_HOME=${codexHome}`, "codex", "login"]);
}

export function resolveCodexExecution(
  providerOptions: unknown,
): CodexExecutionContext {
  const execution = executionOptionsSchema.parse(
    providerOptions ?? {},
  ).codexExecution;
  if (execution === undefined || execution.kind === "default")
    return { providerId: "codex", codexHome: null };
  const expression = execution.codexHome;
  const codexHome = expression.startsWith("~/")
    ? path.join(os.homedir(), expression.slice(2))
    : expression;
  if (!path.isAbsolute(codexHome))
    throw new Error("The Codex home must be absolute on this machine.");
  return {
    providerId: execution.providerId,
    codexHome: path.normalize(codexHome),
  };
}

export function codexExecutionEnv(
  execution: CodexExecutionContext,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  if (execution.codexHome !== null) {
    for (const name of [
      "CODEX_OPENAI_BASE_URL",
      "CODEX_POOL_AUTH_TOKEN",
      "BB_ACCOUNT_POOL_PARENT_URL",
      "BB_ACCOUNT_POOL_PARENT_TOKEN",
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
    ])
      delete env[name];
    env.CODEX_HOME = execution.codexHome;
    env.CODEX_SQLITE_HOME = execution.codexHome;
  }
  return env;
}
