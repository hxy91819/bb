import { describe, expect, it } from "vitest";
import {
  acpInitializeResultSchema,
  acpRequestPermissionParamsSchema,
  acpSessionForkResultSchema,
  acpSessionNewResultSchema,
  acpToolCallUpdateEventSchema,
} from "./wire.js";

describe("acpToolCallUpdateEventSchema", () => {
  it("parses an unknown kind as `other` and keeps the agent's word on rawKind", () => {
    const parsed = acpToolCallUpdateEventSchema.parse({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Deploy preview",
      kind: "deploy",
      status: "in_progress",
    });

    expect(parsed.kind).toBe("other");
    expect(parsed.rawKind).toBe("deploy");
    expect(parsed.status).toBe("in_progress");
  });

  it("accepts switch_mode and the v2 cancelled status", () => {
    const parsed = acpToolCallUpdateEventSchema.parse({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      kind: "switch_mode",
      status: "cancelled",
    });

    expect(parsed.kind).toBe("switch_mode");
    expect(parsed.rawKind).toBeUndefined();
    expect(parsed.status).toBe("cancelled");
  });

  it("parses an unknown status as pending and a null kind or status as absent", () => {
    const unknownStatus = acpToolCallUpdateEventSchema.parse({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "queued",
    });
    expect(unknownStatus.status).toBe("pending");

    const nulls = acpToolCallUpdateEventSchema.parse({
      sessionUpdate: "tool_call",
      toolCallId: "call-2",
      kind: null,
      status: null,
    });
    expect(nulls.kind).toBeUndefined();
    expect(nulls.status).toBeUndefined();
  });

  it("skips a content entry of an unknown type instead of dropping the call", () => {
    const parsed = acpToolCallUpdateEventSchema.parse({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      content: [
        { type: "hologram", frames: 3 },
        { type: "content", content: { type: "text", text: "done" } },
      ],
    });

    expect(parsed.content).toEqual([
      { type: "content", content: { type: "text", text: "done" } },
    ]);
  });

  it("opens the enums on a permission request's tool call too", () => {
    const parsed = acpRequestPermissionParamsSchema.parse({
      sessionId: "s",
      toolCall: { toolCallId: "call-1", kind: "deploy", status: "queued" },
      options: [{ optionId: "y", name: "Allow", kind: "allow_once" }],
    });

    expect(parsed.toolCall).toMatchObject({
      kind: "other",
      rawKind: "deploy",
      status: "pending",
    });
  });
});

describe("acpInitializeResultSchema", () => {
  it("exposes the unstable session fork capability", () => {
    const parsed = acpInitializeResultSchema.parse({
      protocolVersion: 1,
      agentCapabilities: {
        sessionCapabilities: { fork: {} },
      },
    });

    expect(parsed.agentCapabilities?.sessionCapabilities?.fork).toEqual({});
  });

  it("exposes the stable session resume capability", () => {
    const parsed = acpInitializeResultSchema.parse({
      protocolVersion: 1,
      agentCapabilities: {
        sessionCapabilities: { close: {}, list: {}, resume: {} },
      },
    });

    expect(parsed.agentCapabilities?.sessionCapabilities).toEqual({
      close: {},
      list: {},
      resume: {},
    });
  });
});

describe("acpSessionNewResultSchema", () => {
  it("accepts explicit null for optional model and config-option strings", () => {
    const parsed = acpSessionNewResultSchema.safeParse({
      sessionId: "session-1",
      models: {
        currentModelId: "openai-codex/gpt-5.5",
        availableModels: [
          {
            modelId: "openai-codex/gpt-5.5",
            name: "openai-codex/GPT-5.5",
            description: null,
          },
        ],
      },
      configOptions: [
        {
          type: "select",
          id: "model",
          category: "model",
          name: "Model",
          description: "Select the model for this session",
          currentValue: "openai-codex/gpt-5.5",
          options: [
            {
              value: "openai-codex/gpt-5.5",
              name: "openai-codex/GPT-5.5",
              description: null,
            },
          ],
        },
        {
          type: "select",
          id: "thought_level",
          category: null,
          name: "Thinking",
          currentValue: "medium",
          options: [{ value: "medium", name: null }],
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(
      parsed.data.models?.availableModels?.[0].description,
    ).toBeUndefined();
    expect(parsed.data.configOptions?.[0].options?.[0].name).toBe(
      "openai-codex/GPT-5.5",
    );
    expect(parsed.data.configOptions?.[1].category).toBeUndefined();
    expect(parsed.data.configOptions?.[1].options?.[0].name).toBeUndefined();
  });

  it("flattens grouped ACP v1 model select options", () => {
    const parsed = acpSessionNewResultSchema.parse({
      sessionId: "session-1",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: '["deepseek-official","deepseek-v4-flash"]',
          options: [
            {
              group: "deepseek-official",
              name: "DeepSeek Official",
              options: [
                {
                  value: '["deepseek-official","deepseek-v4-flash"]',
                  name: "DeepSeek V4 Flash",
                },
                {
                  value: '["deepseek-official","deepseek-v4-pro"]',
                  name: "DeepSeek V4 Pro",
                },
              ],
            },
          ],
        },
        {
          id: "reasoning_effort",
          name: "Reasoning effort",
          category: "thought_level",
          type: "select",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
            { value: "max", name: "Max" },
          ],
        },
      ],
    });

    expect(parsed.configOptions?.[0]?.options).toEqual([
      {
        value: '["deepseek-official","deepseek-v4-flash"]',
        name: "DeepSeek V4 Flash",
      },
      {
        value: '["deepseek-official","deepseek-v4-pro"]',
        name: "DeepSeek V4 Pro",
      },
    ]);
    expect(parsed.configOptions?.[1]?.options).toEqual([
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
      { value: "max", name: "Max" },
    ]);
  });

  it("accepts a DeepSeek Harness session/new payload", () => {
    const initialize = acpInitializeResultSchema.parse({
      protocolVersion: 1,
      agentInfo: { name: "deepseek-harness-acp", version: "0.0.1" },
      agentCapabilities: {
        mcpCapabilities: { http: true },
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
        sessionCapabilities: { close: {}, list: {}, resume: {} },
      },
      authMethods: [],
    });
    expect(initialize.agentCapabilities?.loadSession).toBeUndefined();
    expect(initialize.agentCapabilities?.sessionCapabilities?.resume).toEqual(
      {},
    );

    const parsed = acpSessionNewResultSchema.parse({
      sessionId: "5dd1a177-f517-4cd4-91ef-dfa417f971d1",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: '["deepseek-official","deepseek-v4-flash"]',
          options: [
            {
              group: "deepseek-official",
              name: "DeepSeek",
              options: [
                {
                  value: '["deepseek-official","deepseek-flash"]',
                  name: "DeepSeek-V41-Flash",
                },
                {
                  value: '["deepseek-official","deepseek-v4-flash"]',
                  name: "DeepSeek-V4-Flash",
                },
                {
                  value: '["deepseek-official","deepseek-v4-pro"]',
                  name: "DeepSeek-V4-Pro",
                },
                {
                  value:
                    '["deepseek-official","deepseek-v4-flash-vision-exp"]',
                  name: "DeepSeek-V4-Flash-Vision-Exp",
                },
              ],
            },
          ],
        },
        {
          id: "reasoning_effort",
          name: "Reasoning effort",
          category: "thought_level",
          type: "select",
          currentValue: "high",
          options: [
            { value: "off", name: "Off" },
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
            { value: "max", name: "Max" },
          ],
        },
      ],
    });

    expect(parsed.configOptions?.[0]?.options?.map((option) => option.value)).toEqual(
      [
        '["deepseek-official","deepseek-flash"]',
        '["deepseek-official","deepseek-v4-flash"]',
        '["deepseek-official","deepseek-v4-pro"]',
        '["deepseek-official","deepseek-v4-flash-vision-exp"]',
      ],
    );
    expect(parsed.configOptions?.[1]?.currentValue).toBe("high");
    expect(parsed.configOptions?.[1]?.options?.map((option) => option.value)).toEqual(
      ["off", "low", "high", "max"],
    );
  });
});

describe("acpSessionForkResultSchema", () => {
  it("accepts the SDK's nullable configOptions field", () => {
    const parsed = acpSessionForkResultSchema.parse({
      sessionId: "forked-session",
      configOptions: null,
    });

    expect(parsed).toEqual({
      sessionId: "forked-session",
      configOptions: undefined,
    });
  });
});
