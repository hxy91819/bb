import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { listEvents } from "@bb/db";
import { threadResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerConfiguredAcpProvider } from "../../../apps/server/test/helpers/provider-registry.js";
import { getThreadEvents, sendTextMessage } from "../helpers/api.js";
import { waitForThreadStatus } from "../helpers/assertions.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../helpers/fixtures.js";
import { createIntegrationHarness } from "../helpers/harness.js";

const adapterEntry = process.env.BB_CURSOR_SDK_ACP_ENTRY;
const execFile = promisify(execFileCallback);
const execution = {
  model: "composer-2.5",
  permissionMode: "accept-edits" as const,
};

describe.skipIf(!adapterEntry)("Cursor SDK native BB Fork", () => {
  it.each(["tip", "checkpoint"] as const)(
    "forks at %s through the BB API and preserves isolated context after daemon restarts",
    async (fork) => {
      if (!adapterEntry) throw new Error("BB_CURSOR_SDK_ACP_ENTRY is required");
      const directory = await mkdtemp(path.join(tmpdir(), "bb-cursor-fork-"));
      const childCwd = path.join(directory, "child");
      await mkdir(childCwd);
      const harness = await createIntegrationHarness();
      const inheritedToken = randomBytes(12).toString("hex");
      const laterToken = randomBytes(12).toString("hex");
      const parentToken = randomBytes(12).toString("hex");
      const childToken = randomBytes(12).toString("hex");
      const sourceCwd = harness.repoDir;
      const send = async (threadId: string, text: string) => {
        const baseline =
          (await getThreadEvents(harness.api, threadId)).at(-1)?.seq ?? 0;
        await sendTextMessage(harness.api, threadId, { execution, text });
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          const events = (await getThreadEvents(harness.api, threadId)).filter(
            (event) => event.seq > baseline,
          );
          const completion = events.find(
            (event) => event.type === "turn/completed",
          );
          if (completion?.type === "turn/completed") {
            expect(completion.data.status).toBe("completed");
            expect(
              events.filter(
                (event) =>
                  event.type === "item/completed" &&
                  event.data.item.type === "toolCall",
              ),
            ).toEqual([]);
            const replies = events.flatMap((event) =>
              event.type === "item/completed" &&
              event.data.item.type === "agentMessage"
                ? [event.data.item.text]
                : [],
            );
            expect(
              replies,
              JSON.stringify({ threadId, baseline, events }),
            ).toHaveLength(1);
            await waitForThreadStatus(harness.api, threadId, "idle", 10_000);
            return replies[0]?.trim();
          }
          const error = events.find(
            (event) =>
              event.type === "provider/error" || event.type === "system/error",
          );
          if (error) throw new Error(JSON.stringify(error));
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        throw new Error(
          `Timed out waiting for thread ${threadId}: ${JSON.stringify((await getThreadEvents(harness.api, threadId)).slice(-8))}`,
        );
      };
      try {
        await registerConfiguredAcpProvider(harness.server.providerRegistry, {
          id: "cursor-sdk-fork-test",
          displayName: "Cursor SDK Fork Test",
          command: process.execPath,
          args: [path.resolve(adapterEntry)],
          env: { CURSOR_ACP_CONFIG_DIR: path.join(directory, "acp-config") },
          fork,
        });
        const project = await createProjectFixture(harness, {
          name: "Cursor Fork Isolation",
        });
        const { thread: parent } = await createReadyHostThread(harness, {
          execution,
          projectId: project.id,
          providerId: "acp-cursor-sdk-fork-test",
          workspace: { type: "unmanaged", path: sourceCwd },
          timeoutMs: 90_000,
          input: [
            {
              type: "text",
              text: "Reply only READY. Do not use any tools.",
              mentions: [],
            },
          ],
        });
        expect(
          await send(
            parent.id,
            `The current conversation token is ${inheritedToken}. Remember it. Reply only ACK. Do not use any tools.`,
          ),
        ).toBe("ACK");
        const checkpointTurn = listEvents(harness.db, { threadId: parent.id })
          .reverse()
          .find((event) => event.type === "turn/completed");
        if (!checkpointTurn)
          throw new Error("Missing completed checkpoint turn");
        expect(
          z
            .object({ providerCheckpointId: z.string().min(1) })
            .parse(JSON.parse(checkpointTurn.data)).providerCheckpointId,
        ).toBeTruthy();
        expect(
          await send(
            parent.id,
            `Replace the current conversation token with ${laterToken}. Reply only ACK. Do not use any tools.`,
          ),
        ).toBe("ACK");
        await harness.restartDaemon("cursor-fork-before-fork");
        const forkResponse = await harness.api.threads.fork.$post({
          json: {
            sourceThreadId: parent.id,
            ...(fork === "checkpoint"
              ? { sourceSeqEnd: checkpointTurn.sequence }
              : {}),
            visibility: "visible",
            origin: "sdk",
            environment: {
              type: "host",
              hostId: harness.hostId,
              workspace: { type: "unmanaged", path: childCwd },
            },
          },
        });
        expect(forkResponse.status, await forkResponse.clone().text()).toBe(
          201,
        );
        const child = threadResponseSchema.parse(await forkResponse.json());
        await waitForThreadStatus(harness.api, child.id, "idle", 90_000);
        expect(child.id).not.toBe(parent.id);
        const childHistory = JSON.stringify(
          await getThreadEvents(harness.api, child.id),
        );
        expect(childHistory).toContain(inheritedToken);
        if (fork === "checkpoint")
          expect(childHistory).not.toContain(laterToken);
        else expect(childHistory).toContain(laterToken);
        const parentIdentity = listEvents(harness.db, {
          threadId: parent.id,
        })
          .reverse()
          .find((event) => event.providerThreadId !== null)?.providerThreadId;
        const childIdentity = listEvents(harness.db, {
          threadId: child.id,
        })
          .reverse()
          .find((event) => event.providerThreadId !== null)?.providerThreadId;
        expect(parentIdentity).toBeTruthy();
        expect(childIdentity).toBeTruthy();
        expect(childIdentity).not.toBe(parentIdentity);
        const sdkSessionIds: string[] = [];
        for (const [cwd, sessionId] of [
          [sourceCwd, parentIdentity],
          [childCwd, childIdentity],
        ] as const) {
          const encodedCwd = cwd
            .replace(/^\//, "")
            .replace(/\//g, "-")
            .replace(/:/g, "-");
          const contents = await readFile(
            path.join(
              directory,
              "acp-config",
              "sessions",
              encodedCwd,
              `${sessionId}.jsonl`,
            ),
            "utf8",
          );
          const records = z
            .array(
              z.object({
                type: z.string(),
                modelId: z.string().optional(),
                sdkSessionId: z.string().optional(),
              }),
            )
            .parse(
              contents
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line)),
            );
          const metadata = records
            .filter((record) => record.type === "session_meta")
            .reverse();
          expect(
            metadata.find((record) => record.modelId !== undefined)?.modelId,
          ).toBe("composer-2.5");
          const sdkSessionId = metadata.find(
            (record) => record.sdkSessionId !== undefined,
          )?.sdkSessionId;
          expect(sdkSessionId).toMatch(/^agent-/);
          if (!sdkSessionId)
            throw new Error("SDK session ID was not persisted");
          sdkSessionIds.push(sdkSessionId);
        }
        expect(sdkSessionIds[0]).not.toBe(sdkSessionIds[1]);
        await harness.restartDaemon("cursor-fork-after-fork");
        expect(
          await send(
            parent.id,
            `Replace the current conversation token with ${parentToken}. Reply only ACK. Do not use any tools.`,
          ),
        ).toBe("ACK");
        expect(
          await send(
            child.id,
            "What is the current conversation token? Reply only the token. Do not use any tools.",
          ),
        ).toBe(fork === "checkpoint" ? inheritedToken : laterToken);
        expect(
          await send(
            child.id,
            `Replace the current conversation token with ${childToken}. Reply only ACK. Do not use any tools.`,
          ),
        ).toBe("ACK");
        expect(
          await send(
            parent.id,
            "What is the current conversation token? Reply only the token. Do not use any tools.",
          ),
        ).toBe(parentToken);
        expect(
          await send(
            child.id,
            "What is the current conversation token? Reply only the token. Do not use any tools.",
          ),
        ).toBe(childToken);
        console.log(
          `PASS: isolated BB server/daemon -> native ACP ${fork} fork -> Composer 2.5; history cutoff, cross-cwd inheritance, two daemon restarts, distinct session IDs and bidirectional isolation.`,
        );
      } finally {
        await harness.cleanup();
        await execFile(process.execPath, [
          "--input-type=module",
          "-e",
          `import {createRequire} from 'node:module'; import {rm} from 'node:fs/promises'; const {getDefaultSdkStateRoot} = createRequire(${JSON.stringify(path.resolve(adapterEntry))})('@cursor/sdk'); for (const cwd of ${JSON.stringify([sourceCwd, childCwd])}) await rm(getDefaultSdkStateRoot(cwd), {recursive: true, force: true});`,
        ]);
        await rm(directory, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
