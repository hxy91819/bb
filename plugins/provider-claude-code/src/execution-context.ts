import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  claudeHomeBindingSchema,
  type ClaudeHomeBinding,
} from "./home-bindings.js";

const executionOptionsSchema = z.object({
  claudeExecution: claudeHomeBindingSchema.optional(),
});
export function resolveClaudeExecution(
  options: unknown,
): ClaudeHomeBinding | null {
  return executionOptionsSchema.parse(options ?? {}).claudeExecution ?? null;
}
export function claudeExecutionEnv(
  binding: ClaudeHomeBinding | null,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  if (binding === null) return env;
  for (const name of Object.keys(env)) {
    if (
      name.startsWith("ANTHROPIC_") ||
      name.startsWith("CLAUDE_CODE_") ||
      name === "MAX_THINKING_TOKENS" ||
      name === "BB_ACCOUNT_POOL_PARENT_URL" ||
      name === "BB_ACCOUNT_POOL_PARENT_TOKEN"
    )
      delete env[name];
  }
  const expression = binding.claudeConfigDir;
  const configDir = expression.startsWith("~/")
    ? path.join(os.homedir(), expression.slice(2))
    : expression;
  if (!path.isAbsolute(configDir))
    throw new Error(
      "The Claude config directory must be absolute on this machine.",
    );
  env.CLAUDE_CONFIG_DIR = path.normalize(configDir);
  return env;
}
