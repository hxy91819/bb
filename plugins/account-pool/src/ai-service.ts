import type { BbPluginApi, PluginAiServiceStatus } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { createHub } from "./hub.js";
import type { HubTokenStore } from "./store.js";

const TEXT_MODELS = ["gpt-6-luna", "gpt-5.6-luna"] as const;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const completedEventSchema = z.object({
  type: z.literal("response.completed"),
  response: z.object({
    status: z.literal("completed"),
    output: z.array(
      z.object({
        type: z.string(),
        content: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
            }),
          )
          .optional(),
      }),
    ),
  }),
});

async function readCompletedText(response: Response): Promise<string> {
  if (response.body === null)
    throw new Error("Account Pooler returned no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES)
        throw new Error("Account Pooler response is too large");
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/u.exec(buffer)) !== null) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = block
          .split(/\r?\n/u)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]")
          throw new Error(
            "Account Pooler response ended without a completed result",
          );
        const event = z
          .object({ type: z.string() })
          .passthrough()
          .parse(JSON.parse(data));
        if (
          ["error", "response.failed", "response.incomplete"].includes(
            event.type,
          )
        ) {
          throw new Error("Account Pooler text generation failed");
        }
        if (event.type !== "response.completed") continue;
        const completed = completedEventSchema.parse(event);
        const text = completed.response.output
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text ?? "")
          .join("")
          .trim();
        if (!text) throw new Error("Account Pooler returned an empty reply");
        return text;
      }
    }
    throw new Error("Account Pooler response ended without a completed result");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function registerPoolAiService(
  bb: BbPluginApi,
  hub: ReturnType<typeof createHub>,
  hubTokens: HubTokenStore,
  canServe: () => Promise<boolean>,
): void {
  async function status(): Promise<PluginAiServiceStatus> {
    if (!(await canServe())) {
      return {
        ready: false,
        message: "Enable Codex routing and add an available Codex pool account",
      };
    }
    if ((await bb.sdk.system.config()).primaryHostId === null) {
      return { ready: false, message: "No primary machine is configured" };
    }
    return { ready: true };
  }

  bb.experimental_aiServices.register({
    id: "codex-pool",
    displayName: "Account Pooler (Codex)",
    status,
    async complete(prompt, { signal }) {
      signal.throwIfAborted();
      const availability = await status();
      if (!availability.ready) throw new Error(availability.message);
      const { primaryHostId } = await bb.sdk.system.config();
      if (primaryHostId === null)
        throw new Error("No primary machine is configured");
      const token = await hubTokens.forHost(primaryHostId);
      for (const model of TEXT_MODELS) {
        signal.throwIfAborted();
        const response = await hub.handle(
          new Request("http://account-pool/v1/responses", {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              accept: "text/event-stream",
              "openai-beta": "responses=experimental",
            },
            body: JSON.stringify({
              model,
              instructions:
                "Follow the user prompt. Reply with only the requested text, without quotes or commentary.",
              reasoning: { effort: "none" },
              store: false,
              stream: true,
              input: [
                {
                  role: "user",
                  content: [{ type: "input_text", text: prompt }],
                },
              ],
            }),
            signal,
          }),
          "codex",
          "/v1/responses",
        );
        if (response.ok) return readCompletedText(response);
        await response.body?.cancel();
        if (
          model !== TEXT_MODELS[TEXT_MODELS.length - 1] &&
          (response.status === 429 || response.status >= 500)
        )
          continue;
        throw new Error(
          `Account Pooler text generation failed with HTTP ${response.status}`,
        );
      }
      throw new Error("Account Pooler did not answer");
    },
  });
}
