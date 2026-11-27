import { z } from "zod";
import { pluginIdSchema } from "@bb/domain";

const boundedId = z.string().min(1).max(128);
const unicodeText = (max: number) =>
  z.string().refine((value) => Array.from(value).length <= max);
const instant = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const activityFields = {
  metadata: z
    .object({
      pluginId: pluginIdSchema.pipe(boundedId),
      key: z.string().min(1).max(128),
      equals: z.union([
        z.string().max(256),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    })
    .strict(),
  from: instant,
  to: instant,
  projectId: boundedId.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(2048).optional(),
};
export const experimentalThreadActivityRequestSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("summary"), ...activityFields }).strict(),
    z
      .object({
        mode: z.literal("details"),
        ...activityFields,
        threadId: boundedId,
      })
      .strict(),
  ])
  .refine((value) => value.from < value.to, {
    message: "from must be less than to",
    path: ["to"],
  });
export type ExperimentalThreadActivityRequest = z.infer<
  typeof experimentalThreadActivityRequestSchema
>;
export type ExperimentalThreadActivityInput = z.input<
  typeof experimentalThreadActivityRequestSchema
>;

export const experimentalActivityKindSchema = z.enum([
  "acceptedInput",
  "completedTurn",
  "agentMessage",
  "commandExecution",
  "fileChange",
  "toolCall",
]);
export const experimentalActivityStatusSchema = z.enum([
  "accepted",
  "statement",
  "pending",
  "completed",
  "failed",
  "interrupted",
  "unknown",
]);
export const experimentalActivityEvidenceSchema = z.object({
  eventId: boundedId,
  threadId: boundedId,
  sequence: instant,
  createdAt: instant,
  type: experimentalActivityKindSchema,
  status: experimentalActivityStatusSchema,
  outcome: z.enum(["exit-zero", "exit-nonzero", "unknown"]),
  excerpt: unicodeText(512),
  excerptTruncated: z.boolean(),
  commandName: unicodeText(128).nullable(),
  exitCode: z.number().nullable(),
  filePath: unicodeText(256).nullable(),
});
export type ExperimentalActivityEvidence = z.infer<
  typeof experimentalActivityEvidenceSchema
>;
const positionedEvidence = experimentalActivityEvidenceSchema.extend({
  cursorAfter: z.string().max(2048),
});
const envelope = {
  returned: z.number(),
  nextCursor: z.string().max(2048).nullable(),
  hasMore: z.boolean(),
  truncated: z.boolean(),
  coverage: z.object({
    source: z.literal("retained-events"),
    pagination: z.literal("live-pagination"),
    from: instant,
    to: instant,
    asOf: instant,
    throughSequence: instant.nullable(),
    includesArchived: z.literal(true),
    includesHidden: z.literal(true),
    incomplete: z.boolean(),
    forkBoundaryGaps: z.object({
      count: z.number(),
      missingIdentityCount: z.number(),
      uncertainPrefixCount: z.number(),
      samples: z.array(
        z.object({
          threadId: boundedId,
          projectId: boundedId,
          reason: z.enum(["missing-local-identity", "prefix-sequence-gap"]),
        }),
      ),
    }),
    limitations: z.array(z.string()),
  }),
  budget: z.object({
    encoding: z.literal("compact-json-utf8"),
    maxBytes: z.literal(262144),
  }),
};
export const experimentalThreadActivityResponseSchema = z.discriminatedUnion(
  "mode",
  [
    z.object({
      mode: z.literal("summary"),
      ...envelope,
      totalThreads: z.number(),
      items: z.array(
        z.object({
          threadId: boundedId,
          projectId: boundedId,
          title: unicodeText(200),
          lastActivityAt: instant,
          acceptedInputs: z.number(),
          completedTurns: z.number(),
          counts: z.array(
            z.object({
              type: experimentalActivityKindSchema,
              status: experimentalActivityStatusSchema,
              count: z.number(),
            }),
          ),
          recentEvidence: z.array(experimentalActivityEvidenceSchema).max(3),
          cursorAfter: z.string().max(2048),
        }),
      ),
    }),
    z.object({
      mode: z.literal("details"),
      ...envelope,
      totalEvidence: z.number(),
      items: z.array(positionedEvidence).max(100),
    }),
  ],
);
export type ExperimentalThreadActivityResponse = z.infer<
  typeof experimentalThreadActivityResponseSchema
>;
