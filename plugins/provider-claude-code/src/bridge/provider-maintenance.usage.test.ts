import type {
  AccountInfo,
  SDKControlGetUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  account: {} as AccountInfo,
  usage: {} as Pick<
    SDKControlGetUsageResponse,
    "rate_limits_available" | "rate_limits"
  >,
  failure: "",
  env: undefined as NodeJS.ProcessEnv | undefined,
  close: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: { env: NodeJS.ProcessEnv } }) => {
    state.env = { ...options.env };
    return {
      initializationResult: async () => {
        if (state.failure) throw new Error(state.failure);
        return { account: state.account };
      },
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () =>
        state.usage,
      close: state.close,
    };
  },
}));

vi.mock("node:fs/promises", () => ({
  default: { readFile: async () => JSON.stringify({ oauthAccount: {} }) },
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@get-bb/plugin-sdk/provider-bridge")
  >()),
  experimental_resolveExecutablePath: () => Promise.resolve("/test/claude"),
}));

import { getClaudeProviderUsage } from "./provider-maintenance.js";

afterEach(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.stubEnv("CLAUDE_CONFIG_DIR", "/home/agent/.claude-bound");
  state.account = { apiProvider: "firstParty", tokenSource: "apiKeyHelper" };
  state.usage = { rate_limits_available: false, rate_limits: null };
  state.failure = "";
  state.env = undefined;
  state.close.mockClear();
});

describe("Claude Code bound-home usage reporting", () => {
  it.each([
    [undefined, null],
    ["bound@example.com", "bound@example.com"],
    ["token", null],
  ])(
    "reports a signed-in bound home without plan limits (%s)",
    async (email, accountEmail) => {
      state.account = { ...state.account, email };
      await expect(getClaudeProviderUsage()).resolves.toEqual({
        supported: true,
        usage: { status: "ok", accountEmail, planLabel: null, windows: [] },
      });
      expect(state.env?.CLAUDE_CONFIG_DIR).toBe("/home/agent/.claude-bound");
      expect(state.close).toHaveBeenCalledOnce();
    },
  );

  it("reports an unauthenticated bound home when the SDK says signed out", async () => {
    state.account = { apiProvider: "firstParty", tokenSource: "none" };
    await expect(getClaudeProviderUsage()).resolves.toEqual({
      supported: true,
      usage: { status: "unauthenticated" },
    });
  });

  it("reports a probe failure and closes the SDK session", async () => {
    state.failure = "cli crashed";
    await expect(getClaudeProviderUsage()).resolves.toEqual({
      supported: true,
      usage: {
        status: "error",
        message: "cli crashed",
        planLabel: null,
        accountEmail: null,
      },
    });
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("reports subscription windows from the bound home's SDK session", async () => {
    state.account = {
      apiProvider: "firstParty",
      subscriptionType: "Claude Pro",
    };
    state.usage = {
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 20, resets_at: null },
        seven_day: { utilization: 40, resets_at: null },
      },
    };
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
  });
});
