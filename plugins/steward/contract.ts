import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const absolute = (s: string) => s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => absolute(s) && !s.includes("\0"), "请使用完整文件路径");
export const relativePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (s) =>
      !absolute(s) &&
      !/^[A-Za-z]:/.test(s) &&
      !s.includes("\\") &&
      !s.includes("\0") &&
      !s.split("/").some((p) => !p || p === "." || p === ".."),
    "请使用仓库内规范相对路径",
  );
export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }).strict(),
  z
    .object({
      kind: z.literal("git"),
      repo: path,
      ref: z
        .string()
        .max(1024)
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_./-]*$/)
        .refine(
          (s) => !s.includes("..") && !s.endsWith("/") && !s.includes("//"),
        ),
    })
    .strict(),
]);
export const threadInput = z.object({ threadId: z.string().min(1) }).strict();
export const registerInput = threadInput
  .extend({
    topic: z.string().trim().min(1).max(200),
    workbook: z.string().min(1).max(4096),
    ledger: z.string().min(1).max(4096),
    checker: path,
    source: sourceSchema.default({ kind: "local" }),
    ledgerKind: z.enum(["standard", "history"]).default("standard"),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ["workbook", "ledger"] as const) {
      const parsed = (
        value.source.kind === "git" ? relativePath : path
      ).safeParse(value[key]);
      if (!parsed.success)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: parsed.error.message,
        });
    }
  });
export const registrationSchema = registerInput.safeExtend({
  schemaVersion: z.literal(1),
  projectId: z.string(),
  hostId: z.string(),
  repoRoot: path,
  workbookRelativePath: z.string(),
  registeredAt: z.string(),
});
export type Registration = z.infer<typeof registrationSchema>;
export const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const snapshotSchema = z.object({
  repo: path,
  ref: z.string(),
  sha: revisionSchema,
});
export const checkResultSchema = z.object({
  ok: z.boolean(),
  applicable: z.boolean().default(true),
  errors: z.array(z.string()),
  summary: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export const checksSchema = z.object({
  checkedAt: z.string(),
  snapshot: snapshotSchema.optional(),
  workbook: checkResultSchema,
  ledger: checkResultSchema,
});
export type Checks = z.infer<typeof checksSchema>;
export const documentPath = z.union([relativePath, z.literal(".")]);
export const documentCursor = z
  .object({
    path: documentPath,
    sha: revisionSchema,
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const documentRequest = z.object({
  document: z.enum(["workbook", "ledger"]),
  link: z
    .object({
      from: z
        .string()
        .min(1)
        .max(4096)
        .refine((s) => documentPath.safeParse(s.replace(/\/$/, "")).success),
      target: z.string().min(1).max(4096),
      sha: revisionSchema,
    })
    .strict()
    .optional(),
  cursor: documentCursor.optional(),
  limit: z.number().int().min(256).max(65536).optional(),
});
export const documentResult = z.object({
  available: z.boolean(),
  message: z.string(),
  kind: z.enum(["file", "directory"]).optional(),
  content: z.string().optional(),
  entries: z
    .array(
      z.object({
        name: z.string(),
        path: documentPath,
        kind: z.enum(["file", "directory", "unsupported"]),
      }),
    )
    .optional(),
  offset: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
  next: documentCursor.nullable().optional(),
  path: documentPath.optional(),
  snapshot: snapshotSchema.optional(),
});
export type DocumentResult = z.infer<typeof documentResult>;
export const rpcContract = defineRpcContract({
  register: { input: registerInput, output: registrationSchema },
  show: { input: threadInput, output: registrationSchema.nullable() },
  unregister: {
    input: threadInput,
    output: z.object({ removed: z.boolean() }),
  },
  refresh: { input: threadInput, output: checksSchema },
  document: {
    input: threadInput.extend(documentRequest.shape),
    output: documentResult,
  },
});
export const hostContract = defineRpcContract({
  document: {
    input: z.object({ registration: registerInput, ...documentRequest.shape }),
    output: documentResult,
  },
  identity: {
    input: z.object({ workbook: z.string(), source: sourceSchema }),
    output: z.object({ repoRoot: path, workbookRelativePath: z.string() }),
  },
  check: { input: registerInput, output: checksSchema },
});
