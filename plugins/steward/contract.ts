import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const path = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (s) => s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s),
    "请使用完整文件路径",
  );
export const threadInput = z.object({ threadId: z.string().min(1) }).strict();
export const registerInput = threadInput
  .extend({
    topic: z.string().trim().min(1).max(200),
    workbook: path,
    ledger: path,
    checker: path,
  })
  .strict();
export const registrationSchema = registerInput.extend({
  schemaVersion: z.literal(1),
  projectId: z.string(),
  hostId: z.string(),
  repoRoot: path,
  workbookRelativePath: z.string(),
  registeredAt: z.string(),
});
export type Registration = z.infer<typeof registrationSchema>;
export const checkResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string()),
  summary: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export const checksSchema = z.object({
  checkedAt: z.string(),
  workbook: checkResultSchema,
  ledger: checkResultSchema,
});
export type Checks = z.infer<typeof checksSchema>;
export const rpcContract = defineRpcContract({
  register: { input: registerInput, output: registrationSchema },
  show: { input: threadInput, output: registrationSchema.nullable() },
  unregister: {
    input: threadInput,
    output: z.object({ removed: z.boolean() }),
  },
  refresh: { input: threadInput, output: checksSchema },
  document: {
    input: threadInput.extend({ document: z.enum(["workbook", "ledger"]) }),
    output: z.object({ available: z.boolean(), message: z.string() }),
  },
});
export const hostContract = defineRpcContract({
  document: {
    input: z.object({ path }),
    output: z.object({ available: z.boolean(), message: z.string() }),
  },
  identity: {
    input: z.object({ workbook: path }),
    output: z.object({ repoRoot: path, workbookRelativePath: z.string() }),
  },
  check: { input: registerInput, output: checksSchema },
});
