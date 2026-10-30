import { archiveThread, threadSearchSegments, markThreadDeleted } from "@bb/db";
import {
  threadSearchResponseSchema,
  threadMessageSearchResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public thread search route", () => {
  it("returns active and archived search result groups", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const activeThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routeactive",
        titleFallback: "routeactive",
      });
      const archivedThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routearchived",
        titleFallback: "routearchived",
      });
      archiveThread(harness.deps.db, harness.deps.hub, archivedThread.id);
      const hiddenThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routehidden",
        titleFallback: "routehidden",
        visibility: "hidden",
      });
      const hiddenArchivedThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routehiddenarchived",
        titleFallback: "routehiddenarchived",
        visibility: "hidden",
      });
      archiveThread(harness.deps.db, harness.deps.hub, hiddenArchivedThread.id);

      const response = await harness.app.request(
        "/api/v1/threads/search?query=route&limitPerGroup=10",
      );

      expect(response.status).toBe(200);
      const body = threadSearchResponseSchema.parse(await readJson(response));
      expect(body.active.results.map((result) => result.thread.id)).toContain(
        activeThread.id,
      );
      expect(body.archived.results.map((result) => result.thread.id)).toContain(
        archivedThread.id,
      );
      expect(
        [...body.active.results, ...body.archived.results].map(
          (result) => result.thread.id,
        ),
      ).not.toContain(hiddenThread.id);
      expect(
        [...body.active.results, ...body.archived.results].map(
          (result) => result.thread.id,
        ),
      ).not.toContain(hiddenArchivedThread.id);
    });
  });

  it("validates required query and limit parameters before the thread-id route", async () => {
    await withTestHarness(async (harness) => {
      const missingQueryResponse = await harness.app.request(
        "/api/v1/threads/search",
      );
      expect(missingQueryResponse.status).toBe(400);

      const shortQueryResponse = await harness.app.request(
        "/api/v1/threads/search?query=x",
      );
      expect(shortQueryResponse.status).toBe(400);

      const badLimitResponse = await harness.app.request(
        "/api/v1/threads/search?query=valid&limitPerGroup=bad",
      );
      expect(badLimitResponse.status).toBe(400);
    });
  });
  it("searches all messages in one thread with literal Unicode text, snippets and pagination", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, { projectId: project.id });
      const other = seedThread(harness.deps, { projectId: project.id });
      const segments: Omit<
        typeof threadSearchSegments.$inferInsert,
        "id" | "createdAt" | "updatedAt"
      >[] = [
        ...Array.from({ length: 4 }, (_, index) => ({
          threadId: thread.id,
          sourceKind:
            index % 2 === 0
              ? ("user_message" as const)
              : ("assistant_message" as const),
          sourceKey: String(index),
          sourceSeq: index + 1,
          text: `${"prefix ".repeat(50)}中文会话 %_ SQL() CAFÉ 😀 中文会话 ${index}`,
        })),
        ...(["title", "system_message"] as const).map((sourceKind) => ({
          threadId: thread.id,
          sourceKind,
          sourceKey: `fixture-${sourceKind}`,
          sourceSeq: 10,
          text: "中文会话 %_ SQL() CAFÉ 😀",
        })),
        {
          threadId: other.id,
          sourceKind: "assistant_message",
          sourceKey: "other",
          sourceSeq: 1,
          text: "中文会话 %_ SQL() CAFÉ 😀",
        },
      ];
      harness.deps.db
        .insert(threadSearchSegments)
        .values(
          segments.map((segment, index) => ({
            ...segment,
            id: `search-${index}`,
            createdAt: 1,
            updatedAt: 1,
          })),
        )
        .run();
      for (const query of ["中", "文会", "%_", "sql()", "cafe", "😀"]) {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/search?${new URLSearchParams({ query, limit: "2", offset: "1" })}`,
        );
        expect(response.status).toBe(200);
        const body = threadMessageSearchResponseSchema.parse(
          await readJson(response),
        );
        expect(body.total).toBe(4);
        expect(body.matches.map((match) => match.sourceSeq)).toEqual([2, 3]);
        for (const match of body.matches) {
          expect(match.text.length).toBeLessThan(200);
          expect(match.highlightRanges.length).toBeGreaterThan(0);
          for (const range of match.highlightRanges) {
            expect(match.text.slice(range.start, range.end)).toBe(
              query === "sql()" ? "SQL()" : query === "cafe" ? "CAFÉ" : query,
            );
          }
        }
      }
      const empty = await harness.app.request(
        `/api/v1/threads/${thread.id}/search?query=missing`,
      );
      expect(await readJson(empty)).toEqual({ total: 0, matches: [] });
      const pastEnd = await harness.app.request(
        `/api/v1/threads/${thread.id}/search?query=中&offset=99`,
      );
      expect(await readJson(pastEnd)).toEqual({ total: 4, matches: [] });
    });
  });

  it("validates message search bounds and refuses missing or deleted threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, { projectId: project.id });
      for (const params of [
        "query=",
        "query=%20",
        "query=%CC%81",
        "query=x&limit=0",
        "query=x&limit=101",
        "query=x&offset=-1",
        "query=x&offset=9007199254740992",
        "query=x&limit=1.5",
        `query=${"x".repeat(1001)}`,
      ]) {
        expect(
          (
            await harness.app.request(
              `/api/v1/threads/${thread.id}/search?${params}`,
            )
          ).status,
        ).toBe(400);
      }
      expect(
        (await harness.app.request("/api/v1/threads/missing/search?query=x"))
          .status,
      ).toBe(404);
      markThreadDeleted(harness.deps.db, harness.deps.hub, {
        threadId: thread.id,
      });
      expect(
        (
          await harness.app.request(
            `/api/v1/threads/${thread.id}/search?query=x`,
          )
        ).status,
      ).toBe(404);
    });
  });
});
