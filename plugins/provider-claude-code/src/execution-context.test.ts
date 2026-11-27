import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  claudeExecutionEnv,
  resolveClaudeExecution,
} from "./execution-context.js";

it("keeps the default provider unchanged and resolves a bound home without inheriting another endpoint or login", () => {
  const inherited = {
    PATH: "/bin",
    ANTHROPIC_BASE_URL: "https://original.invalid",
    ANTHROPIC_AUTH_TOKEN: "old-token",
    CLAUDE_CODE_OAUTH_TOKEN: "old-login",
    CLAUDE_CODE_EFFORT_LEVEL: "medium",
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: "200000",
    MAX_THINKING_TOKENS: "1000",
    BB_ACCOUNT_POOL_PARENT_URL: "http://pool",
    BB_ACCOUNT_POOL_PARENT_TOKEN: "pool-token",
    BB_CLAUDE_CODE_EXECUTABLE: "/bin/claude",
  };
  expect(claudeExecutionEnv(null, inherited)).toEqual(inherited);
  const binding = resolveClaudeExecution({
    claudeExecution: {
      id: "work",
      displayName: "Work",
      claudeConfigDir: "~/.claude-work",
    },
  });
  const bound = claudeExecutionEnv(binding, inherited);
  expect(bound).toEqual({
    PATH: "/bin",
    BB_CLAUDE_CODE_EXECUTABLE: "/bin/claude",
    CLAUDE_CONFIG_DIR: path.join(os.homedir(), ".claude-work"),
  });
  expect(inherited.ANTHROPIC_AUTH_TOKEN).toBe("old-token");
});
it("rejects a home path invalid on the execution platform", () => {
  const otherPlatformPath =
    process.platform === "win32" ? "/linux/home" : "C:\\claude-home";
  if (path.isAbsolute(otherPlatformPath)) return;
  const binding = resolveClaudeExecution({
    claudeExecution: {
      id: "work",
      displayName: "Work",
      claudeConfigDir: otherPlatformPath,
    },
  });
  expect(() => claudeExecutionEnv(binding, {})).toThrow(
    "absolute on this machine",
  );
});
