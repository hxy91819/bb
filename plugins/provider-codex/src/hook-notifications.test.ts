import { describe, expect, it } from "vitest";
import { experimental_createDeltaAssembler as createDeltaAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { createCodexEventTranslator } from "./translator.js";

function createHarness() {
  const translator = createCodexEventTranslator({
    additionalWorkspaceWriteRoots: [],
  });
  const assembler = createDeltaAssembler({
    providerId: "codex",
    entropyPrefix: "hooks",
    textDeltaFlushMs: 0,
  });
  return (method: string, params: Record<string, unknown>) =>
    assembler.assemble({
      threadId: "thread-test",
      deltas: translator.translateEvent({ jsonrpc: "2.0", method, params }),
    });
}

describe("Codex lifecycle notification diagnostics", () => {
  const compactionWarning =
    "Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted.";

  it.each(["thread-test", null])(
    "suppresses the compaction accuracy warning with threadId %s",
    (threadId) => {
      const translate = createHarness();
      expect(
        translate("warning", { threadId, message: compactionWarning }),
      ).toEqual([]);
    },
  );

  it("suppresses the compaction accuracy warning when its recommendation changes", () => {
    const translate = createHarness();
    expect(
      translate("warning", {
        threadId: "thread-test",
        message:
          "Heads up: Long threads and multiple compactions can cause the model to be less accurate. Consider starting a new thread.",
      }),
    ).toEqual([]);
  });

  it.each([
    ["configWarning", "config"],
    ["deprecationNotice", "deprecation"],
  ])("preserves %s even with the compaction warning text", (method, category) => {
    const translate = createHarness();
    expect(
      translate(method, { summary: compactionWarning, details: "Details" }),
    ).toEqual([
      expect.objectContaining({
        type: "provider/warning",
        category,
        summary: compactionWarning,
        details: "Details",
      }),
    ]);
  });

  it.each(["hook/started", "hook/completed"])(
    "suppresses routine %s notifications",
    (method) => {
      const translate = createHarness();
      const events = translate(method, {
        threadId: "thread-test",
        turnId: null,
        run: {
          id: "hook-test",
          eventName: "sessionStart",
          handlerType: "command",
          executionMode: "sync",
          scope: "thread",
          sourcePath: "/tmp/hooks.json",
          source: "user",
          displayOrder: 0,
          status: method === "hook/started" ? "running" : "completed",
          statusMessage: null,
          startedAt: 1,
          completedAt: method === "hook/completed" ? 2 : null,
          durationMs: method === "hook/completed" ? 1 : null,
          entries: [],
        },
      });
      expect(events).toEqual([]);
    },
  );

  it.each(["thread-test", null])(
    "normalizes a warning with threadId %s exactly once",
    (threadId) => {
      const translate = createHarness();
      const events = translate("warning", {
        threadId,
        message: "Provider context budget notice",
      });
      expect(events).toEqual([
        expect.objectContaining({
          type: "provider/warning",
          category: "general",
          summary: "Provider context budget notice",
        }),
      ]);
    },
  );

  it.each(["failed", "blocked", "stopped"])(
    "preserves %s hook diagnostics",
    (status) => {
      const translate = createHarness();
      expect(translate("hook/completed", { run: { status } })).toEqual([
        expect.objectContaining({
          type: "provider/unhandled",
          rawType: "hook/completed",
        }),
      ]);
    },
  );

  it("preserves unknown notifications as diagnostics", () => {
    const translate = createHarness();
    expect(translate("future/notification", { value: 1 })).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        rawType: "future/notification",
      }),
    ]);
  });

  it("preserves malformed warnings as diagnostics", () => {
    const translate = createHarness();
    expect(translate("warning", { threadId: null, message: 42 })).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        rawType: "warning",
      }),
    ]);
  });
});
