import { z } from "zod";

export const codexHomeExpressionSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\0") && /^(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(value),
    "Use an absolute path or a path beginning with ~/.",
  );

export const codexHomeBindingsSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,57}$/),
        displayName: z.string().trim().min(1).max(128),
        codexHome: codexHomeExpressionSchema,
      })
      .strict(),
  )
  .max(64)
  .superRefine((bindings, context) => {
    const ids = new Set<string>();
    for (const [index, binding] of bindings.entries()) {
      if (ids.has(binding.id))
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Binding IDs must be unique.",
        });
      ids.add(binding.id);
    }
  });

export type CodexHomeBinding = z.infer<typeof codexHomeBindingsSchema>[number];

export function parseCodexHomeBindings(value: string): CodexHomeBinding[] {
  return codexHomeBindingsSchema.parse(JSON.parse(value));
}
