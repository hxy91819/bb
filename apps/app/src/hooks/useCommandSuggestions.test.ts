import { describe, expect, it } from "vitest";
import {
  panelCommandSuggestions,
  promptActionCommandSuggestions,
} from "./useCommandSuggestions";

const promptActions = [
  { kind: "skills", text: "/" },
  {
    kind: "plan",
    command: { trigger: "/", name: "plan", trailingText: " " },
    text: "/plan ",
  },
  {
    kind: "goal",
    command: { trigger: "/", name: "goal", trailingText: " " },
    text: "/goal ",
  },
] as const;

describe("promptActionCommandSuggestions", () => {
  it("turns prompt action commands into slash command suggestions", () => {
    expect(
      promptActionCommandSuggestions({
        promptActions,
        query: "",
        trigger: "/",
      }),
    ).toEqual([
      {
        kind: "command",
        name: "plan",
        source: "command",
        origin: "user",
        description: null,
        argumentHint: null,
      },
      {
        kind: "command",
        name: "goal",
        source: "command",
        origin: "user",
        description: null,
        argumentHint: null,
      },
    ]);
  });

  it("filters prompt action commands by the active query", () => {
    expect(
      promptActionCommandSuggestions({
        promptActions,
        query: "pl",
        trigger: "/",
      }).map((suggestion) => suggestion.name),
    ).toEqual(["plan"]);
  });
});

describe("panelCommandSuggestions", () => {
  const panelCommands = [
    {
      name: "side",
      pluginId: "side-chat",
      actionId: "side-chat",
      description: "Start side chat",
    },
  ];

  it("turns panel commands into suggestions carrying the panel action", () => {
    expect(panelCommandSuggestions({ panelCommands, query: "" })).toEqual([
      {
        kind: "command",
        name: "side",
        source: "command",
        origin: "user",
        description: "Start side chat",
        argumentHint: null,
        pluginId: "side-chat",
        panelAction: {
          pluginId: "side-chat",
          actionId: "side-chat",
        },
      },
    ]);
  });

  it("filters panel commands by the active query", () => {
    expect(
      panelCommandSuggestions({ panelCommands, query: "si" }).map(
        (suggestion) => suggestion.name,
      ),
    ).toEqual(["side"]);
    expect(
      panelCommandSuggestions({ panelCommands, query: "chat" }).map(
        (suggestion) => suggestion.name,
      ),
    ).toEqual(["side"]);
    expect(panelCommandSuggestions({ panelCommands, query: "deploy" })).toEqual(
      [],
    );
  });
});
