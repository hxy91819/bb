import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const script = resolve(
  import.meta.dirname,
  "../../../scripts/provider-recordings/redact.mjs",
);

it.each(["/root", "/Users/alice"])(
  "redacts real and encoded homes without changing prose for %s",
  (home) => {
    const root = mkdtempSync(join(tmpdir(), "bb-recording-redact-"));
    try {
      const input = join(root, "input");
      const output = join(root, "output");
      mkdirSync(input);
      const value = {
        path: `${home}/project`,
        encoded: `/transcripts/${home.replaceAll("/", "-")}-project`,
        description: "multi-root: one shared table; --root option",
      };
      writeFileSync(join(input, "fixture.json"), JSON.stringify(value));
      execFileSync(process.execPath, [script, input, output, "--home", home]);
      expect(
        JSON.parse(readFileSync(join(output, "fixture.json"), "utf8")),
      ).toEqual({
        path: "/home/user/project",
        encoded: "/transcripts/-home-user-project",
        description: value.description,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
