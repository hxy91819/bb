import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { Features, transform } from "lightningcss";
import { describe, expect, it } from "vitest";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import { ComposerEditorSlot } from "./ComposerEditorSlot";

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(resolve(appRoot, "package.json"));
const themePath = resolve(appRoot, "src/components/ui/theme.css");

describe("touch input typography", () => {
  it.each([
    ["input", <Input className="text-xs" />],
    ["textarea", <Textarea className="text-xs" />],
    [
      "chat editor",
      <ComposerEditorSlot
        editor={null}
        scrollContainerRef={{ current: null }}
        inputLocked={false}
        isCompactLayout={false}
        minHeight={48}
        layout="thread"
        resolveMentionLink={undefined}
      />,
    ],
  ])(
    "keeps %s at the iOS focus zoom floor despite later plugin utilities",
    async (_, element) => {
      const html = renderToStaticMarkup(element);
      const candidates = [...html.matchAll(/class="([^"]*)"/g)].flatMap(
        (match) => match[1].split(/\s+/),
      );
      const compiler = await compile(await readFile(themePath, "utf8"), {
        base: dirname(themePath),
        loadStylesheet: async (id, base) => {
          const path =
            id === "tailwindcss"
              ? require.resolve("tailwindcss/index.css")
              : id === "tw-animate-css"
                ? resolve(
                    appRoot,
                    "node_modules/tw-animate-css/dist/tw-animate.css",
                  )
                : resolve(base, id);
          return {
            path,
            base: dirname(path),
            content: await readFile(path, "utf8"),
          };
        },
      });
      const css = transform({
        filename: "input.css",
        code: Buffer.from(compiler.build(candidates)),
        include: Features.Nesting,
        minify: true,
      }).code.toString();
      const protectedFont = css.match(
        /@media\s*\(pointer:coarse\)\{[^{}]*\{[^{}]*font-size:var\((--[\w-]+)\)!important/,
      );
      expect(
        protectedFont,
        "touch font protection must apply at every viewport width",
      ).not.toBeNull();
      const fontToken = protectedFont?.[1];
      const remSize = css.match(new RegExp(`${fontToken}:([\\d.]+)rem(?:;|})`));
      expect(
        remSize,
        "the protected font must have an explicit rem size",
      ).not.toBeNull();
      expect(Number(remSize?.[1]) * 16).toBeGreaterThanOrEqual(16);
    },
  );
});
