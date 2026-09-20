import { z } from "zod";

export function isGoalExtensionKind(kind: string): boolean {
  return kind.endsWith("/goal");
}

export const threadTimelineGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "budgetLimited",
  "complete",
]);

export const threadTimelineGoalSchema = z.object({
  sourceSeq: z.number().int().nonnegative(),
  updatedAt: z.number(),
  objective: z.string(),
  status: threadTimelineGoalStatusSchema,
  tokenBudget: z.number().nullable(),
  tokensUsed: z.number(),
  timeUsedSeconds: z.number(),
});
export type ThreadTimelineGoal = z.infer<typeof threadTimelineGoalSchema>;
