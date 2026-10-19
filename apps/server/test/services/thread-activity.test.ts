import {
  PERSONAL_PROJECT_ID,
  parseStoredThreadEvent,
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  projects,
  threads,
  events,
  threadPluginMetadata,
  deriveStoredEventItemFields,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { eq } from "drizzle-orm";
import {
  experimentalThreadActivityRequestSchema,
  type ExperimentalThreadActivityInput,
} from "@bb/server-contract";
import { queryThreadActivity } from "../../src/services/threads/thread-activity.js";

let db: DbConnection;
const request: ExperimentalThreadActivityInput = {
  mode: "summary",
  metadata: { pluginId: "team", key: "memberId", equals: "a" },
  from: 100,
  to: 300,
};
function query(input: ExperimentalThreadActivityInput = request) {
  return queryThreadActivity(
    db,
    experimentalThreadActivityRequestSchema.parse(input),
  );
}
function thread(
  id: string,
  overrides: Partial<typeof threads.$inferInsert> = {},
  metadata: Record<string, unknown> = { memberId: "a" },
  pluginId = "team",
) {
  db.insert(threads)
    .values({
      id,
      projectId: "project",
      providerId: "codex",
      status: "idle",
      latestAttentionAt: 1,
      createdAt: 1,
      updatedAt: 999,
      ...overrides,
    })
    .run();
  db.insert(threadPluginMetadata)
    .values({ threadId: id, pluginId, metadataJson: JSON.stringify(metadata) })
    .run();
}
function event(
  threadId: string,
  sequence: number,
  createdAt = 150,
  type: typeof events.$inferInsert.type = "item/completed",
  data?: Record<string, unknown>,
) {
  const scope =
    type.startsWith("turn/") || type.startsWith("item/")
      ? turnScope(`${threadId}-turn`)
      : threadScope();
  const fallback =
    type === "turn/input/accepted"
      ? {
          clientRequestId: encodeClientTurnRequestIdNumber({ value: sequence }),
        }
      : {
          item: {
            type: "agentMessage",
            id: `item-${sequence}`,
            text: "I finished it",
          },
        };
  const payload: Record<string, unknown> = {
    providerThreadId: "fixture-provider",
    ...(data ?? fallback),
  };
  if (typeof payload.item === "object" && payload.item !== null)
    payload.item = { id: `item-${sequence}`, ...payload.item };
  const parsed = parseStoredThreadEvent({
    threadId,
    type,
    data: payload,
    scope,
    providerThreadId: "fixture-provider",
  });
  db.insert(events)
    .values({
      id: `${threadId}-${sequence}`,
      threadId,
      sequence,
      scopeKind: scope.kind,
      turnId: scope.kind === "turn" ? scope.turnId : null,
      providerThreadId: "fixture-provider",
      createdAt,
      type,
      data: JSON.stringify(payload),
      ...deriveStoredEventItemFields(parsed),
    })
    .run();
}
beforeEach(() => {
  db = createMigratedConnection();
  db.insert(projects)
    .values({ id: "project", name: "Activity", createdAt: 1, updatedAt: 1 })
    .run();
});
afterEach(() => db.$client.close());

describe("retained activity public service", () => {
  it("uses event time and observable payload states, never rename time or agent claims as results", () => {
    thread("old", {
      archivedAt: 5,
      visibility: "hidden",
      title: "😀".repeat(250),
    });
    thread("rename");
    event("rename", 1, 150, "thread/name/updated", { threadName: "Done" });
    event("old", 1, 100, "turn/input/accepted");
    event("old", 2, 150, "turn/completed", { status: "failed" });
    event("old", 3, 200, "item/completed", {
      item: {
        type: "commandExecution",
        command: "test --secret SECRET",
        cwd: "/tmp/activity",
        approvalStatus: null,
        status: "completed",
        exitCode: 0,
        aggregatedOutput: "SECRET",
      },
    });
    event("old", 4, 201, "item/completed", {
      item: { type: "toolCall", tool: "query", status: "completed" },
    });
    event("old", 5, 202);
    event("old", 6, 299, "item/completed", {
      item: {
        type: "fileChange",
        approvalStatus: null,
        status: "failed",
        changes: [{ path: "file", kind: "update", diff: "SECRET" }],
      },
    });
    event("old", 7, 300);
    event("old", 8, 99);
    event("old", 9, 151, "item/completed", {
      item: { type: "reasoning", summary: ["SECRET"], content: ["SECRET"] },
    });
    event("old", 10, 152, "item/agentMessage/delta", {
      delta: "SECRET",
      itemId: "delta-item",
    });
    const result = query();
    expect(result.mode).toBe("summary");
    if (result.mode !== "summary") throw new Error();
    expect(result.totalThreads).toBe(1);
    expect(result.items[0]?.threadId).toBe("old");
    expect(Array.from(result.items[0]?.title ?? "")).toHaveLength(200);
    expect(result.items[0]).toMatchObject({
      projectId: "project",
      acceptedInputs: 1,
      completedTurns: 1,
      lastActivityAt: 299,
    });
    const detail = query({ ...request, mode: "details", threadId: "old" });
    if (detail.mode !== "details") throw new Error();
    expect(detail.totalEvidence).toBe(6);
    expect(detail.items.map((e) => [e.type, e.status])).toEqual([
      ["acceptedInput", "accepted"],
      ["completedTurn", "failed"],
      ["commandExecution", "completed"],
      ["toolCall", "completed"],
      ["agentMessage", "statement"],
      ["fileChange", "failed"],
    ]);
    expect(JSON.stringify(detail)).not.toContain("SECRET");
    expect(detail.items[2]).toMatchObject({
      commandName: "test",
      exitCode: 0,
      outcome: "exit-zero",
    });
    expect(detail.items[3]?.exitCode).toBeNull();
    expect(detail.items[3]?.outcome).toBe("unknown");
  });

  it.each([null, "1", 1, true, false, 0])(
    "matches scalar %j exactly and only in the requested namespace and top-level key",
    (value) => {
      const values = [null, "1", 1, true, false, 0];
      values.forEach((v, i) => {
        thread(`t${i}`, {}, { 'key.with[syntax]"': v });
        event(`t${i}`, 1);
      });
      thread("missing", {}, {});
      event("missing", 1);
      thread("nested", {}, { nested: { 'key.with[syntax]"': value } });
      event("nested", 1);
      thread("namespace", {}, { 'key.with[syntax]"': value }, "other");
      event("namespace", 1);
      thread("corrupt", {}, {});
      event("corrupt", 1);
      db.update(threadPluginMetadata)
        .set({ metadataJson: "{" })
        .where(eq(threadPluginMetadata.threadId, "corrupt"))
        .run();
      const result = query({
        ...request,
        metadata: { pluginId: "team", key: 'key.with[syntax]"', equals: value },
      });
      expect(result.items.map((t) => t.threadId)).toEqual([
        `t${values.indexOf(value)}`,
      ]);
    },
  );

  it("excludes deleted and non-public projects and rechecks details ownership, project and deletion", () => {
    db.insert(projects)
      .values([
        { id: "other", name: "Other", createdAt: 1, updatedAt: 1 },
        {
          id: "deleted",
          name: "Deleted",
          deletedAt: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ])
      .run();
    thread("a");
    thread("b", { projectId: "other" });
    thread("c", { deletedAt: 2 });
    thread("d", { projectId: PERSONAL_PROJECT_ID });
    thread("e", { projectId: "deleted" });
    for (const id of ["a", "b", "c", "d", "e"]) event(id, 1);
    expect(query().items.map((t) => t.threadId)).toEqual(["a", "b"]);
    expect(
      query({ ...request, projectId: "project" }).items.map((t) => t.threadId),
    ).toEqual(["a"]);
    expect(
      query({
        ...request,
        mode: "details",
        threadId: "b",
        projectId: "project",
      }).items,
    ).toEqual([]);
    expect(
      query({
        ...request,
        mode: "details",
        threadId: "a",
        metadata: { ...request.metadata, equals: "b" },
      }).items,
    ).toEqual([]);
    for (const id of ["c", "d", "e"])
      expect(() =>
        query({ ...request, mode: "details", threadId: id }),
      ).toThrow();
  });

  it("keeps binary thread order, recomputes counts and permits a new page size across a database reopen", () => {
    for (const id of ["a", "B", "z"]) {
      thread(id);
      event(id, 1);
    }
    const liveRequest = { ...request, to: Date.now() + 10000 };
    const first = query({ ...liveRequest, limit: 1 });
    expect(first.items.map((t) => t.threadId)).toEqual(["B"]);
    thread("A", { createdAt: first.coverage.asOf });
    event("A", 1);
    event("a", 2, first.coverage.asOf);
    event("z", 2, first.coverage.asOf - 1);
    const snapshot = db.$client.serialize();
    db.$client.close();
    db = createConnection(snapshot);
    const next = query({
      ...liveRequest,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(next.items.map((t) => t.threadId)).toEqual(["a", "z"]);
    expect(next.hasMore).toBe(false);
    if (next.mode !== "summary") throw new Error();
    expect(next.totalThreads).toBe(3);
    expect(next.items[0]?.lastActivityAt).toBe(150);
    expect(next.items[1]?.lastActivityAt).toBe(first.coverage.asOf - 1);
    db.update(threadPluginMetadata)
      .set({ metadataJson: '{"memberId":"b"}' })
      .where(eq(threadPluginMetadata.threadId, "z"))
      .run();
    const changed = query({
      ...liveRequest,
      cursor: first.nextCursor ?? undefined,
    });
    if (changed.mode !== "summary") throw new Error();
    expect(changed.totalThreads).toBe(2);
    expect(changed.items.map((t) => t.threadId)).toEqual(["a"]);
  });

  it("fixes details sequence ceiling and reports deletion/reuse and time backfill as live pagination", () => {
    thread("a");
    event("a", 1, 200);
    event("a", 2, 150);
    event("a", 3, 100);
    const first = query({
      ...request,
      mode: "details",
      threadId: "a",
      limit: 1,
    });
    expect(first.coverage.throughSequence).toBe(3);
    event("a", 4, 101);
    db.delete(events).where(eq(events.id, "a-2")).run();
    db.delete(events).where(eq(events.id, "a-1")).run();
    event("a", 1, 200, "item/completed", {
      item: { type: "agentMessage", text: "reused behind cursor" },
    });
    db.update(events)
      .set({
        data: JSON.stringify({
          item: { type: "agentMessage", text: "rewritten" },
        }),
      })
      .where(eq(events.id, "a-3"))
      .run();
    const next = query({
      ...request,
      mode: "details",
      threadId: "a",
      cursor: first.nextCursor ?? undefined,
    });
    if (next.mode !== "details") throw new Error();
    expect(next.totalEvidence).toBe(2);
    expect(next.items.map((e) => e.sequence)).toEqual([3]);
    expect(next.items[0]?.excerpt).toBe("rewritten");
    expect(next.coverage.pagination).toBe("live-pagination");
    db.update(threads).set({ deletedAt: 2 }).where(eq(threads.id, "a")).run();
    expect(() =>
      query({
        ...request,
        mode: "details",
        threadId: "a",
        cursor: first.nextCursor ?? undefined,
      }),
    ).toThrow();
  });

  it("rejects cursor query changes and malformed/version/position cursors without binding limit", () => {
    thread("a");
    thread("b");
    event("a", 1);
    event("b", 1);
    const first = query({ ...request, limit: 1 });
    const cursor = first.nextCursor ?? "";
    for (const changes of [
      { from: 101 },
      { to: 301 },
      { projectId: "project" },
      { metadata: { ...request.metadata, equals: "b" } },
      { metadata: { ...request.metadata, key: "different" } },
      { metadata: { ...request.metadata, pluginId: "different" } },
      { mode: "details" as const, threadId: "a" },
    ]) {
      expect(() => query({ ...request, ...changes, cursor })).toThrow(
        "does not match",
      );
    }
    for (const changes of [
      { version: 2 },
      { position: "" },
      { position: -1 },
      { asOf: -1 },
      { binding: "scope" },
    ]) {
      const modified = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(cursor, "base64url").toString()),
          ...changes,
        }),
      ).toString("base64url");
      expect(() => query({ ...request, cursor: modified })).toThrow();
    }
    expect(() => query({ ...request, cursor: "x".repeat(2049) })).toThrow();
    expect(() => query({ ...request, cursor: "!" })).toThrow();
    expect(
      query({ ...request, cursor, limit: 100 }).items.map((t) => t.threadId),
    ).toEqual(["b"]);
  });

  it("reveals excluded forks with no boundary even when there are no summary rows", () => {
    thread("fork", { originKind: "fork" });
    event("fork", 1);
    const result = query();
    expect(result.items).toEqual([]);
    expect(result.coverage.incomplete).toBe(true);
    expect(result.coverage.forkBoundaryGaps).toEqual({
      count: 1,
      missingIdentityCount: 1,
      uncertainPrefixCount: 0,
      samples: [
        {
          threadId: "fork",
          projectId: "project",
          reason: "missing-local-identity",
        },
      ],
    });
    expect(
      query({ ...request, mode: "details", threadId: "fork" }).items,
    ).toEqual([]);
    for (let i = 0; i < 11; i++) thread(`fork-${i}`, { originKind: "fork" });
    const gaps = query().coverage.forkBoundaryGaps;
    expect(gaps.count).toBe(12);
    expect(gaps.samples).toHaveLength(10);
  });

  it("caps complete compact responses, truncates Unicode excerpts and resumes at every returned item", () => {
    db.transaction(() => {
      for (let i = 0; i < 100; i++) {
        const id = `t${String(i).padStart(3, "0")}`;
        thread(id, { title: "😀".repeat(300) });
        for (let n = 1; n <= 3; n++)
          event(id, n, 150, "item/completed", {
            item: { type: "agentMessage", text: "😀".repeat(20000) },
          });
      }
    });
    const first = query({ ...request, limit: 100 });
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(
      262144,
    );
    expect(first.truncated).toBe(true);
    expect(first.returned).toBeGreaterThan(0);
    expect(first.hasMore).toBe(true);
    if (first.mode !== "summary") throw new Error();
    expect(first.items[0]?.recentEvidence[0]?.excerptTruncated).toBe(true);
    expect(
      Array.from(first.items[0]?.recentEvidence[0]?.excerpt ?? ""),
    ).toHaveLength(512);
    const onlyOne = query({
      ...request,
      cursor: first.items[0]?.cursorAfter,
      limit: 1,
    });
    expect(onlyOne.items[0]?.threadId).toBe("t001");
    const next = query({
      ...request,
      cursor: first.nextCursor ?? undefined,
      limit: 100,
    });
    expect(next.items[0]?.threadId).toBe(
      `t${String(first.returned).padStart(3, "0")}`,
    );
  });

  it("counts more than 10000 matching threads in SQL without a result materialization threshold", () => {
    db.transaction(() => {
      for (let i = 0; i < 10001; i++) {
        const id = `t${String(i).padStart(5, "0")}`;
        thread(id);
        event(id, 1);
      }
    });
    const result = query({ ...request, limit: 2 });
    if (result.mode !== "summary") throw new Error();
    expect(result.totalThreads).toBe(10001);
    expect(result.returned).toBe(2);
    expect(result.hasMore).toBe(true);
  });
});
