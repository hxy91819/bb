import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread experimental-activity", () => {
  setupCommandOutputTestEnvironment();
  const register = (program: Parameters<typeof registerThreadCommands>[0]) =>
    registerThreadCommands(program, () => "http://server");
  it("preserves JSON scalar types and UTC numbers and emits compact wire JSON", async () => {
    const response = {
      mode: "details",
      items: [],
      coverage: { source: "retained-events" },
      returned: 0,
    };
    const post = vi.fn(async () => response);
    stubServerApi({ "v1.threads.experimental-activity.$post": post });
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      await runCommand(
        [
          "thread",
          "experimental-activity",
          "--plugin",
          "team",
          "--key",
          "memberId",
          "--equals",
          "true",
          "--from",
          "100",
          "--to",
          "200",
          "--thread",
          "thr_1",
          "--limit",
          "2",
          "--json",
        ],
        register,
      );
      expect(post).toHaveBeenCalledWith({
        json: {
          mode: "details",
          threadId: "thr_1",
          metadata: { pluginId: "team", key: "memberId", equals: true },
          from: 100,
          to: 200,
          limit: 2,
        },
      });
      expect(write.mock.calls.map((call) => call[0])).toContain(
        JSON.stringify(response),
      );
    } finally {
      write.mockRestore();
    }
  });
});
