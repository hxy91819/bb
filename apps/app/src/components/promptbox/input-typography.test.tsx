// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import {
  Features,
  transform,
  type Declaration,
  type MediaQuery,
} from "lightningcss";
import { describe, expect, it } from "vitest";
import { Command, CommandInput } from "@bb/shared-ui/command";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import { VoiceInputTextarea } from "@bb/shared-ui/voice-input-textarea";
import { VoiceInputTextarea as HostVoiceInputTextarea } from "./VoiceInputTextarea";
import type { ComponentType } from "react";
import { composerPluginModule } from "@/test/fixtures/composer-plugin";

const { ComposerEditorSlot } = await composerPluginModule<{
  ComposerEditorSlot: ComponentType<{
    editor: null;
    scrollContainerRef: { current: null };
    inputLocked: boolean;
    isCompactLayout: boolean;
    minHeight: number;
    layout: "thread";
    resolveMentionLink: undefined;
  }>;
}>("ComposerEditorSlot.tsx");

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(resolve(appRoot, "package.json"));
const themePath = resolve(appRoot, "src/components/ui/theme.css");

function fontToken(declaration: Declaration): string | undefined {
  if (
    declaration.property !== "unparsed" ||
    declaration.value.propertyId.property !== "font-size"
  )
    return undefined;
  const token = declaration.value.value[0];
  return token?.type === "var" ? token.value.name.ident : undefined;
}

function isCoarsePointer(query: MediaQuery): boolean {
  const condition = query.condition;
  return (
    query.qualifier !== "not" &&
    query.mediaType === "all" &&
    condition?.type === "feature" &&
    condition.value.type === "plain" &&
    condition.value.name === "pointer" &&
    condition.value.value.type === "ident" &&
    condition.value.value.value === "coarse"
  );
}

const otherAnswer = (
  <VoiceInputTextarea className="text-xs" value="" onValueChange={() => {}} />
);

describe("touch input typography", () => {
  it.each([
    ["input", <Input className="text-xs" />, 12],
    ["textarea", <Textarea className="text-xs" />, 12],
    [
      "command input",
      <Command>
        <CommandInput />
      </Command>,
      13,
    ],
    ["question answer", otherAnswer, 12],
    [
      "host question answer",
      <HostVoiceInputTextarea
        className="text-xs"
        value=""
        onValueChange={() => {}}
      />,
      12,
    ],
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
      13,
    ],
  ] as const)(
    "keeps %s at the iOS focus zoom floor despite later plugin utilities",
    async (_, element, desktopSize) => {
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
      }).code;
      const media: MediaQuery[][] = [];
      const sizes = new Map<string, number>();
      const fonts: {
        token: string;
        important: boolean;
        media: MediaQuery[][];
      }[] = [];
      transform({
        filename: "input.css",
        code: css,
        visitor: {
          Rule(rule) {
            if (rule.type === "media")
              media.push(rule.value.query.mediaQueries);
            if (rule.type !== "style") return;
            const declarations = rule.value.declarations;
            if (media.length === 0) {
              for (const declaration of declarations?.declarations ?? []) {
                if (declaration.property !== "custom") continue;
                const value = declaration.value.value[0];
                if (value?.type === "length" && value.value.unit === "rem") {
                  sizes.set(declaration.value.name, value.value.value * 16);
                }
              }
            }
            const matches = rule.value.selectors.some((selector) => {
              const part = selector[0];
              return (
                selector.length === 1 &&
                part.type === "class" &&
                candidates.includes(part.name)
              );
            });
            if (!matches) return;
            for (const important of [false, true]) {
              const values = important
                ? declarations?.importantDeclarations
                : declarations?.declarations;
              for (const declaration of values ?? []) {
                const token = fontToken(declaration);
                if (token) fonts.push({ token, important, media: [...media] });
              }
            }
          },
          RuleExit(rule) {
            if (rule.type === "media") media.pop();
          },
        },
      });
      const protectedFonts = fonts.filter(
        (font) =>
          font.important &&
          font.media.length === 1 &&
          font.media[0].length === 1 &&
          isCoarsePointer(font.media[0][0]),
      );
      expect(
        protectedFonts.length,
        "touch font protection must apply at every viewport width",
      ).toBeGreaterThan(0);
      for (const font of protectedFonts) {
        expect(sizes.get(font.token)).toBeGreaterThanOrEqual(16);
      }
      const desktopFonts = fonts.filter(
        (font) => !font.important && font.media.length === 0,
      );
      expect(desktopFonts.map((font) => sizes.get(font.token))).toEqual([
        desktopSize,
      ]);
    },
  );
});
