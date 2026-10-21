import { createHash } from "node:crypto";
import { z } from "zod";
import {
  activityCounts,
  activityForkBoundaryGaps,
  activitySummaryPage,
  activityThroughSequence,
  countActivityEvidence,
  listActivityEvidence,
  type DbConnection,
} from "@bb/db";
import type {
  ExperimentalThreadActivityRequest,
  ExperimentalThreadActivityResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import {
  requirePublicStandardProject,
  requirePublicThread,
} from "../lib/entity-lookup.js";

const cursorSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["summary", "details"]),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    asOf: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    throughSequence: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    position: z.union([
      z.string().min(1).max(128),
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ]),
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;
const LIMITATIONS = [
  "Only currently retained events; pruning and deletion cannot be reconstructed.",
  "Live pages recheck ownership, project access and deletion; counts may change.",
  "asOf is a timestamp bound, not a database snapshot. Backfills and metadata changes may appear after the cursor or be missed before it.",
  "throughSequence excludes normal appends; rewrites and reused sequences may replace evidence or move it before the cursor.",
  "Fork evidence starts after the first retained local thread/identity; Missing identities exclude all evidence; prefix gaps can hide earlier local activity but retain evidence after the confirmed identity. Lost earlier boundaries cannot always be detected.",
];
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function readCursor(
  value: string,
  binding: string,
  mode: "summary" | "details",
): Cursor {
  let parsed: Cursor;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (parsed.binding !== binding || parsed.mode !== mode)
      throw new ApiError(
        400,
        "cursor_query_mismatch",
        "Activity cursor does not match the query or access scope",
      );
    if (
      encodeCursor(parsed) !== value ||
      parsed.asOf > Date.now() ||
      (mode === "summary"
        ? typeof parsed.position !== "string" || parsed.throughSequence !== null
        : typeof parsed.position !== "number" ||
          parsed.throughSequence === null ||
          parsed.position > parsed.throughSequence)
    )
      throw new Error();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      400,
      "invalid_activity_cursor",
      "Invalid or unsupported activity cursor",
    );
  }
  return parsed;
}

export function queryThreadActivity(
  db: DbConnection,
  request: ExperimentalThreadActivityRequest,
): ExperimentalThreadActivityResponse {
  if (request.projectId !== undefined)
    requirePublicStandardProject(db, request.projectId);
  if (request.mode === "details") {
    const thread = requirePublicThread(db, request.threadId);
    requirePublicStandardProject(db, thread.projectId);
  }
  const binding = createHash("sha256")
    .update(
      JSON.stringify({
        scope: "public-standard-projects/non-deleted-threads/v1",
        mode: request.mode,
        pluginId: request.metadata.pluginId,
        key: request.metadata.key,
        equals: request.metadata.equals,
        projectId: request.projectId ?? null,
        threadId: request.mode === "details" ? request.threadId : null,
        from: request.from,
        to: request.to,
      }),
    )
    .digest("hex");
  const cursor =
    request.cursor === undefined
      ? null
      : readCursor(request.cursor, binding, request.mode);
  return db.transaction(
    (tx) => {
      const asOf = cursor?.asOf ?? Date.now();
      const throughSequence =
        request.mode === "details"
          ? (cursor?.throughSequence ??
            activityThroughSequence(tx, request, asOf))
          : null;
      const forkBoundaryGaps = activityForkBoundaryGaps(tx, request, asOf);
      const coverage = {
        source: "retained-events" as const,
        pagination: "live-pagination" as const,
        from: request.from,
        to: request.to,
        asOf,
        throughSequence,
        includesArchived: true as const,
        includesHidden: true as const,
        incomplete: forkBoundaryGaps.count > 0,
        forkBoundaryGaps,
        limitations: [...LIMITATIONS],
      };
      const budget = {
        encoding: "compact-json-utf8" as const,
        maxBytes: 262144 as const,
      };
      const cursorAfter = (position: string | number) =>
        encodeCursor({
          version: 1,
          mode: request.mode,
          binding,
          asOf,
          throughSequence,
          position,
        });
      let response: ExperimentalThreadActivityResponse;
      if (request.mode === "summary") {
        const page = activitySummaryPage(tx, {
          filter: request,
          asOf,
          limit: request.limit + 1,
          ...(cursor !== null && typeof cursor.position === "string"
            ? { afterThreadId: cursor.position }
            : {}),
        });
        const items = page.rows.slice(0, request.limit).map((row) => {
          const filter = { ...request, threadId: row.threadId };
          const facts = activityCounts(tx, filter, asOf);
          return {
            ...row,
            ...facts,
            recentEvidence: listActivityEvidence(tx, {
              filter,
              asOf,
              order: "recent",
              limit: 3,
            }),
            cursorAfter: cursorAfter(row.threadId),
          };
        });
        response = {
          mode: "summary",
          totalThreads: page.total,
          items,
          coverage,
          budget,
          returned: items.length,
          hasMore: page.rows.length > request.limit,
          truncated: false,
          nextCursor: null,
        };
      } else {
        const through = throughSequence ?? 0;
        const rows = listActivityEvidence(tx, {
          filter: request,
          asOf,
          throughSequence: through,
          limit: request.limit + 1,
          order: "asc",
          ...(cursor !== null && typeof cursor.position === "number"
            ? { afterSequence: cursor.position }
            : {}),
        });
        const items = rows
          .slice(0, request.limit)
          .map((row) => ({ ...row, cursorAfter: cursorAfter(row.sequence) }));
        response = {
          mode: "details",
          totalEvidence: countActivityEvidence(tx, request, asOf, through),
          items,
          coverage,
          budget,
          returned: items.length,
          hasMore: rows.length > request.limit,
          truncated: false,
          nextCursor: null,
        };
      }
      response.nextCursor = response.hasMore
        ? (response.items.at(-1)?.cursorAfter ?? null)
        : null;
      while (
        Buffer.byteLength(JSON.stringify(response), "utf8") > budget.maxBytes
      ) {
        response.items.pop();
        response.returned = response.items.length;
        response.hasMore = true;
        response.truncated = true;
        response.nextCursor = response.items.at(-1)?.cursorAfter ?? null;
        if (response.items.length === 0)
          throw new ApiError(
            413,
            "activity_item_too_large",
            "Activity envelope and one item exceed the wire budget",
          );
      }
      return response;
    },
    { behavior: "deferred" },
  );
}
