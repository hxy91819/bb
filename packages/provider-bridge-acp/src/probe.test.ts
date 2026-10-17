import { describe, expect, it } from "vitest";
import { z } from "zod";
import { acpAgentProbeSchema, probeAcpAgent } from "./probe.js";

describe("probeAcpAgent", () => {
  it("accepts older host replies and remains readable by older servers", () => {
    expect(acpAgentProbeSchema.parse({ reachable: true, fork: true })).toEqual({
      reachable: true,
      fork: true,
    });
    const oldSchema = z.object({
      reachable: z.literal(true),
      fork: z.boolean(),
    });
    expect(
      oldSchema.parse({ reachable: true, fork: true, checkpointFork: true }),
    ).toEqual({
      reachable: true,
      fork: true,
    });
  });

  it("retains the Cursor checkpoint extension through the host RPC schema", async () => {
    const probe = await probeAcpAgent({
      command: process.execPath,
      args: [
        "-e",
        `process.stdin.on("data", () => {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1,
          result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: {
            fork: { _meta: { "cursor-acp/checkpoint": true } }
          } } }
        }) + "\\n");
      });`,
      ],
      cwd: process.cwd(),
    });
    expect(acpAgentProbeSchema.parse(probe)).toEqual({
      reachable: true,
      fork: true,
      checkpointFork: true,
    });
  });

  it("reports a missing agent instead of throwing", async () => {
    const probe = await probeAcpAgent({
      command: "bb-acp-agent-that-does-not-exist",
      args: [],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });

    expect(probe.reachable).toBe(false);
    expect(probe.reachable === false && probe.reason).toContain("ENOENT");
    expect(acpAgentProbeSchema.safeParse(probe).success).toBe(true);
  });

  it("gives up on an agent that never answers initialize", async () => {
    const probe = await probeAcpAgent({
      command: process.execPath,
      args: ["-e", "process.stdin.resume();"],
      cwd: process.cwd(),
      timeoutMs: 300,
    });

    expect(probe).toEqual({
      reachable: false,
      reason: "the agent did not answer initialize within 300ms",
    });
  });

  it("strips the bridge runtime environment the way a real launch does", async () => {
    const previous = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = "1";
    try {
      const probe = await probeAcpAgent({
        command: process.execPath,
        args: [
          "-e",
          `process.stdin.on("data", () => {
             process.stdout.write(JSON.stringify({
               jsonrpc: "2.0",
               id: 1,
               result: {
                 protocolVersion: 1,
                 agentCapabilities: {
                   sessionCapabilities:
                     process.env.ELECTRON_RUN_AS_NODE === undefined
                       ? { fork: {} }
                       : {},
                 },
               },
             }) + "\\n");
           });`,
        ],
        cwd: process.cwd(),
        timeoutMs: 10_000,
      });

      expect(probe).toEqual({
        reachable: true,
        fork: true,
        checkpointFork: false,
      });
    } finally {
      if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = previous;
    }
  });

  it("reads the fork capability out of the agent's full reply", async () => {
    const probe = await probeAcpAgent({
      command: process.execPath,
      args: [
        "-e",
        `process.stdin.on("data", () => {
           process.stdout.write(JSON.stringify({
             jsonrpc: "2.0",
             id: 1,
             result: {
               protocolVersion: 1,
               agentCapabilities: {
                 loadSession: true,
                 sessionCapabilities: { fork: {} },
                 promptCapabilities: { image: true },
               },
               authMethods: [{ id: "token" }],
             },
           }) + "\\n");
         });`,
      ],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });

    expect(probe).toEqual({
      reachable: true,
      fork: true,
      checkpointFork: false,
    });
  });
});
