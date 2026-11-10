import { z } from "zod";

export const claudeConfigDirSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\0") && /^(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(value),
    "Use an absolute path or a path beginning with ~/.",
  );
export const claudeReasoningLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
]);
export const claudeHomeBindingSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,49}$/),
    displayName: z.string().trim().min(1).max(64),
    claudeConfigDir: claudeConfigDirSchema,
    reasoningLevels: z
      .array(claudeReasoningLevelSchema)
      .min(1)
      .max(6)
      .refine(
        (levels) => new Set(levels).size === levels.length,
        "Reasoning levels must be unique.",
      )
      .optional(),
    defaultReasoningLevel: claudeReasoningLevelSchema.optional(),
    supportsFastMode: z.boolean().optional(),
  })
  .strict()
  .refine(
    (binding) =>
      binding.defaultReasoningLevel === undefined ||
      binding.reasoningLevels?.includes(binding.defaultReasoningLevel) === true,
    "A default reasoning level must be included in reasoningLevels.",
  );
export type ClaudeHomeBinding = z.infer<typeof claudeHomeBindingSchema>;
const bindingsSchema = z
  .array(claudeHomeBindingSchema)
  .max(64)
  .refine(
    (bindings) =>
      new Set(bindings.map((binding) => binding.id)).size === bindings.length,
    "Binding IDs must be unique.",
  );
export function parseClaudeHomeBindings(value: string): ClaudeHomeBinding[] {
  return bindingsSchema.parse(JSON.parse(value));
}
