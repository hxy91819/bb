import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authStdout: "",
  authFailure: "",
  credentials: "",
  authCalls: 0,
}));

vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: readonly string[],
    _options: object,
    callback: (
      error: Error | null,
      result: { stdout: string; stderr: string },
    ) => void,
  ) => {
    if (file === "security") {
      callback(new Error("unavailable"), { stdout: "", stderr: "" });
      return;
    }
    if (args[0] === "auth") {
      state.authCalls += 1;
      if (state.authFailure) {
        const error = new Error(state.authFailure);
        (error as Error & { stdout?: string }).stdout = state.authFailure;
        callback(error, { stdout: "", stderr: "" });
        return;
      }
      callback(null, { stdout: state.authStdout, stderr: "" });
      return;
    }
    callback(new Error(`unexpected command: ${args.join(" ")}`), {
      stdout: "",
      stderr: "",
    });
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (file: string) => {
      if (file.endsWith(".credentials.json")) {
        return state.credentials === ""
          ? Promise.reject(new Error("missing credentials"))
          : Promise.resolve(state.credentials);
      }
      return Promise.resolve(JSON.stringify({ oauthAccount: {} }));
    },
  },
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@get-bb/plugin-sdk/provider-bridge")
  >()),
  experimental_resolveExecutablePath: () => Promise.resolve("/test/claude"),
}));

import { getClaudeProviderUsage } from "./provider-maintenance.js";

const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;

afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  vi.unstubAllGlobals();
});

beforeEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  state.authStdout = "";
  state.authFailure = "";
  state.credentials = "";
  state.authCalls = 0;
});

describe("Claude Code usage reporting", () => {
  it("reports an authenticated bound home without plan limits", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/home/agent/.claude-bound";
    state.authStdout = JSON.stringify({ loggedIn: true });

    await expect(getClaudeProviderUsage()).resolves.toEqual({
      supported: true,
      usage: {
        status: "ok",
        accountEmail: null,
        planLabel: null,
        windows: [],
      },
    });
  });

  it("reports the bound home account email when the CLI exposes one", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/home/agent/.claude-bound";
    state.authStdout = JSON.stringify({
      loggedIn: true,
      email: "bound@example.com",
    });

    await expect(getClaudeProviderUsage()).resolves.toEqual({
      supported: true,
      usage: {
        status: "ok",
        accountEmail: "bound@example.com",
        planLabel: null,
        windows: [],
      },
    });
  });

  it("keeps the non-email auth status email out of the usage measurement", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/home/agent/.claude-bound";
    state.authStdout = JSON.stringify({
      loggedIn: true,
      email: "token",
    });

    await expect(getClaudeProviderUsage()).resolves.toEqual({
      supported: true,
      usage: {
        status: "ok",
        accountEmail: null,
        planLabel: null,
        windows: [],
      },
    });
  });

  it("reports an unauthenticated bound home when the CLI says logged out", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/home/agent/.claude-bound";
    state.authStdout = JSON.stringify({ loggedIn: false });

    await expect(getClaudeProviderUsage()).resolves.toEqual({
      supported: true,
      usage: { status: "unauthenticated" },
    });
  });

  it("reports an error when the bound home CLI status cannot be read", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/home/agent/.claude-bound";
    state.authFailure = "cli crashed";

    await expect(getClaudeProviderUsage()).resolves.toEqual({
      supported: true,
      usage: {
        status: "error",
        message: "Could not read the bound Claude CLI authentication status.",
        planLabel: null,
        accountEmail: null,
      },
    });
  });

  it("still reports Anthropic usage for a bound home with OAuth credentials", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/home/agent/.claude-bound";
    state.authStdout = JSON.stringify({ loggedIn: false });
    state.credentials = JSON.stringify({
      claudeAiOauth: {
        accessToken: "test-access-token",
        expiresAt: null,
        subscriptionType: "pro",
        rateLimitTier: null,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          five_hour: { utilization: 20, resets_at: null },
          seven_day: { utilization: 40, resets_at: null },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getClaudeProviderUsage()).resolves.toEqual({
      supported: true,
      usage: {
        status: "ok",
        accountKey: null,
        accountEmail: null,
        planLabel: "Pro",
        plan: { id: "pro", multiplier: null },
        windows: [
          {
            kind: "five-hour",
            label: "Current session",
            usedPercent: 20,
            resetsAt: null,
          },
          {
            kind: "weekly",
            label: "Weekly limit",
            usedPercent: 40,
            resetsAt: null,
          },
        ],
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(state.authCalls).toBe(0);
  });

  it("keeps the default home unauthenticated without credentials", async () => {
    state.authStdout = JSON.stringify({ loggedIn: true });

    await expect(getClaudeProviderUsage()).resolves.toEqual({
      supported: true,
      usage: { status: "unauthenticated" },
    });
  });
});
