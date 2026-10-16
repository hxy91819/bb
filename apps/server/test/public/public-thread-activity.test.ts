import { describe, expect, it } from "vitest";
import { createNodeBbSdk } from "@bb/sdk";
import { events, threadPluginMetadata } from "@bb/db";
import { withTestHarness } from "../helpers/test-app.js";
import {
  seedProjectWithSource,
  seedHostSession,
  seedThread,
} from "../helpers/seed.js";

describe("public activity HTTP and SDK transport", () => {
  it("applies boundary defaults and validation through the SDK HTTP request", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, { projectId: project.id });
      harness.db
        .insert(threadPluginMetadata)
        .values({
          threadId: thread.id,
          pluginId: "team",
          metadataJson: '{"memberId":"a"}',
        })
        .run();
      harness.db
        .insert(events)
        .values({
          id: "activity-event",
          threadId: thread.id,
          sequence: 1,
          scopeKind: "thread",
          type: "turn/completed",
          createdAt: 150,
          data: '{"status":"completed"}',
        })
        .run();
      const sdk = createNodeBbSdk({
        baseUrl: "http://127.0.0.1",
        fetch: async (input, init) =>
          harness.app.request(new Request(input, init)),
      });
      const input = {
        mode: "summary" as const,
        metadata: { pluginId: "team", key: "memberId", equals: "a" },
        from: 100,
        to: 300,
      };
      const result = await sdk.threads.experimental_activity(input);
      await expect(
        sdk.threads.experimental_activity({
          ...input,
          metadata: { ...input.metadata, equals: Number.NaN },
        }),
      ).rejects.toThrow("finite JSON number");
      expect(result.items[0]?.threadId).toBe(thread.id);
      expect(result.returned).toBe(1);
      for (const invalid of [
        { ...input, from: 300 },
        { ...input, limit: 101 },
        { ...input, cursor: "x".repeat(2049) },
        { ...input, metadata: { ...input.metadata, equals: { nested: 1 } } },
        { ...input, extra: "ignored" },
      ]) {
        const response = await harness.app.request(
          "/api/v1/threads/experimental-activity",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(invalid),
          },
        );
        expect(response.status).toBe(400);
      }
    });
  });
});
