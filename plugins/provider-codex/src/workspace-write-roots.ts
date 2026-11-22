import fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";

const configSchema = z.object({
  sandbox_workspace_write: z
    .object({
      writable_roots: z
        .array(z.string().refine(path.isAbsolute, "Expected an absolute path"))
        .default([]),
    })
    .optional(),
});

export function readCodexWorkspaceWriteRoots(codexHome: string): string[] {
  const configPath = path.join(codexHome, "config.toml");
  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
      return [];
    }
    throw new Error(`Unable to read Codex configuration ${configPath}`, {
      cause: error,
    });
  }
  try {
    const config = configSchema.parse(parse(content));
    return [
      ...new Set(
        (config.sandbox_workspace_write?.writable_roots ?? []).map((root) =>
          path.resolve(root),
        ),
      ),
    ];
  } catch (error) {
    throw new Error(
      `Invalid Codex configuration ${configPath}: expected valid TOML with sandbox_workspace_write.writable_roots as an array of absolute paths`,
      {
        cause: error,
      },
    );
  }
}
