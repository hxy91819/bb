import {
  getThreadPluginMetadata,
  listThreadPluginMetadataRows,
  type DbConnection,
} from "@bb/db";
import {
  deepFreezePluginMetadata,
  experimental_validatePluginContext,
  experimental_validateStrictJson,
  validatePluginMetadata,
  type JsonObject,
} from "@bb/domain";
import type {
  StandardSchemaV1,
  experimental_ThreadCreationDescriptor,
  experimental_ThreadCreationPrepareArgs,
} from "@get-bb/plugin-sdk";
import { ApiError } from "../../errors.js";
import {
  pluginHookProvider,
  DEFAULT_PLUGIN_HOOK_TIMEOUT_MS,
} from "./plugin-hook-registry.js";

export interface ThreadCreationContextRegistration {
  pluginId: string;
  signal: AbortSignal;
  prepare(
    args: experimental_ThreadCreationPrepareArgs<unknown>,
  ): Promise<JsonObject | null>;
}

export function bindThreadCreationContext<Input, Output>(
  pluginId: string,
  registration: {
    input: StandardSchemaV1<Input, Output>;
    prepare(
      args: experimental_ThreadCreationPrepareArgs<Output>,
    ): JsonObject | null | Promise<JsonObject | null>;
  },
): { record: ThreadCreationContextRegistration; dispose(): void } {
  const controller = new AbortController();
  return {
    record: {
      pluginId,
      signal: controller.signal,
      async prepare(args) {
        if (args.signal.aborted)
          throw new ApiError(
            409,
            "plugin_context_changed",
            "Creation context registration disposed",
          );
        if (!args.context.present)
          return registration.prepare({ ...args, context: { present: false } });
        const parsed = await registration.input["~standard"].validate(
          args.context.value,
        );
        if (parsed.issues)
          throw new ApiError(
            400,
            "plugin_context_invalid_input",
            `Invalid creation context for ${pluginId}`,
          );
        if (args.signal.aborted)
          throw new ApiError(
            409,
            "plugin_context_changed",
            "Creation context registration disposed",
          );
        return registration.prepare({
          ...args,
          context: { present: true, value: parsed.value },
        });
      },
    },
    dispose() {
      controller.abort();
    },
  };
}

function ownMetadata(
  db: DbConnection,
  threadId: string | null,
  pluginId: string,
): JsonObject | null {
  if (
    threadId === null ||
    listThreadPluginMetadataRows(db, threadId, [pluginId]).length === 0
  )
    return null;
  return deepFreezePluginMetadata(
    getThreadPluginMetadata(db, threadId, pluginId).metadata,
  );
}

export async function prepareThreadCreationContext(args: {
  db: DbConnection;
  context: unknown;
  creation: experimental_ThreadCreationDescriptor;
  seed: { pluginId: string; metadata: JsonObject } | null;
}): Promise<{
  metadata: { pluginId: string; metadata: JsonObject }[];
  assertValid(): void;
}> {
  let context;
  try {
    context = experimental_validatePluginContext(
      args.context === undefined ? {} : args.context,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid creation context";
    const tooLarge = message.includes("plugin_context_too_large:");
    throw new ApiError(
      tooLarge ? 413 : 400,
      tooLarge ? "plugin_context_too_large" : "plugin_context_invalid_input",
      message,
    );
  }
  const provider = pluginHookProvider();
  const records = provider?.listThreadCreationContexts?.() ?? [];
  for (const pluginId of Object.keys(context)) {
    if (
      !records.some(
        (record) => record.pluginId === pluginId && !record.signal.aborted,
      )
    )
      throw new ApiError(
        400,
        "plugin_context_unavailable",
        `Creation context handler unavailable: ${pluginId}`,
      );
  }
  const assertValid = () => {
    const current = provider?.listThreadCreationContexts?.() ?? [];
    if (
      records.some(
        (record) => record.signal.aborted || !current.includes(record),
      )
    )
      throw new ApiError(
        409,
        "plugin_context_changed",
        "Creation context registrations changed",
      );
  };
  const controllers = records.map(() => new AbortController());
  const outputs = await Promise.all(
    records.map(async (record, index) => {
      const controller = controllers[index]!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => controller.abort();
      let cancel = () => {};
      record.signal.addEventListener("abort", abort, { once: true });
      try {
        const cancelled = new Promise<never>((_, reject) => {
          cancel = () =>
            reject(
              new ApiError(
                409,
                "plugin_context_changed",
                "Creation context registration disposed",
              ),
            );
          controller.signal.addEventListener("abort", cancel, { once: true });
        });
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new ApiError(
                408,
                "plugin_context_timeout",
                `Creation context timed out: ${record.pluginId}`,
              ),
            );
            controller.abort();
          }, provider?.decisionTimeoutMs ?? DEFAULT_PLUGIN_HOOK_TIMEOUT_MS);
        });
        const run = async () => {
          const work = Promise.resolve().then(() => {
            assertValid();
            return record.prepare({
              context: Object.hasOwn(context, record.pluginId)
                ? { present: true, value: context[record.pluginId] }
                : { present: false },
              creation: Object.freeze(structuredClone(args.creation)),
              legacySeed:
                args.seed?.pluginId === record.pluginId
                  ? deepFreezePluginMetadata(
                      structuredClone(args.seed.metadata),
                    )
                  : null,
              parentMetadata: ownMetadata(
                args.db,
                args.creation.parentThreadId,
                record.pluginId,
              ),
              sourceMetadata: ownMetadata(
                args.db,
                args.creation.sourceThreadId,
                record.pluginId,
              ),
              signal: controller.signal,
            });
          });
          const value = await work;
          if (controller.signal.aborted)
            throw new ApiError(
              409,
              "plugin_context_changed",
              "Creation context preparation cancelled",
            );
          if (value === null) return null;
          try {
            return validatePluginMetadata(
              experimental_validateStrictJson(value),
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Invalid metadata";
            const tooLarge = message.includes("pluginMetadata exceeds 256 KiB");
            throw new ApiError(
              tooLarge ? 413 : 400,
              tooLarge
                ? "plugin_context_metadata_too_large"
                : "plugin_context_invalid_output",
              message,
            );
          }
        };
        let failure: unknown;
        const invocation = provider!.invokeHook(
          record.pluginId,
          "thread creation context",
          async () => {
            try {
              return await run();
            } catch (error) {
              failure = error;
              throw error;
            }
          },
        );
        const outcome = await Promise.race([invocation, timeout, cancelled]);
        assertValid();
        if (!outcome.ok) {
          if (failure instanceof ApiError) throw failure;
          throw new ApiError(
            400,
            "plugin_context_prepare_failed",
            `Creation context failed: ${record.pluginId}`,
          );
        }
        return { pluginId: record.pluginId, metadata: outcome.value };
      } finally {
        clearTimeout(timer);
        record.signal.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", cancel);
      }
    }),
  ).catch((error) => {
    for (const controller of controllers) controller.abort();
    throw error;
  });
  assertValid();
  let total = 0;
  const metadata = new Map<string, JsonObject>();
  if (args.seed !== null) metadata.set(args.seed.pluginId, args.seed.metadata);
  for (const output of outputs) {
    if (output.metadata === null) continue;
    total += new TextEncoder().encode(
      JSON.stringify(output.metadata),
    ).byteLength;
    if (total > 1024 * 1024)
      throw new ApiError(
        413,
        "plugin_context_metadata_too_large",
        "Creation metadata exceeds 1 MiB",
      );
    const seed = metadata.get(output.pluginId);
    if (
      seed &&
      Object.keys(output.metadata).some((key) => Object.hasOwn(seed, key))
    )
      throw new ApiError(
        400,
        "plugin_context_metadata_conflict",
        `Creation metadata conflicts with legacy seed: ${output.pluginId}`,
      );
    const merged = { ...seed, ...output.metadata };
    try {
      validatePluginMetadata(merged);
    } catch {
      throw new ApiError(
        413,
        "plugin_context_metadata_too_large",
        `Creation metadata exceeds 256 KiB: ${output.pluginId}`,
      );
    }
    metadata.set(output.pluginId, merged);
  }
  return {
    metadata: [...metadata].map(([pluginId, metadata]) => ({
      pluginId,
      metadata,
    })),
    assertValid,
  };
}
