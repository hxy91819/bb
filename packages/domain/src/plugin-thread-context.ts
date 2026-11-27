import { z } from "zod";
import { jsonValueSchema, type JsonValue } from "./json-value.js";
import { pluginIdSchema } from "./plugin-id.js";

function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || value === null)
    throw new Error("Expected strict JSON data");
  if (ancestors.has(value)) throw new Error("JSON data contains a cycle");
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  )
    throw new Error("Expected plain JSON data");
  ancestors.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === "length") continue;
      if (typeof key !== "string")
        throw new Error("JSON data contains a symbol key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        throw new Error("Expected JSON data properties");
      assertJson(descriptor.value, ancestors);
    }
    if (array) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index))
          throw new Error("JSON data contains a sparse array");
      }
      if (Object.keys(value).length !== value.length)
        throw new Error("JSON array contains extra properties");
    }
  } finally {
    ancestors.delete(value);
  }
}

export const experimental_pluginContextSchema = z
  .record(pluginIdSchema, jsonValueSchema)
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 32)
      ctx.addIssue({
        code: "custom",
        message: "plugin_context_too_large: exceeds 32 namespaces",
      });
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 256 * 1024)
      ctx.addIssue({
        code: "custom",
        message: "plugin_context_too_large: exceeds 256 KiB",
      });
  });

export function experimental_validatePluginContext(
  value: unknown,
): Record<string, JsonValue> {
  assertJson(value);
  return experimental_pluginContextSchema.parse(value);
}

export function experimental_validateStrictJson(value: unknown): JsonValue {
  assertJson(value);
  return jsonValueSchema.parse(value);
}
