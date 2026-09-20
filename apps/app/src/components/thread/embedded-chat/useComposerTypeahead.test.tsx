// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import type { PluginPanelActionOpenOptions } from "@get-bb/plugin-sdk";
import type { TypeaheadConfig } from "@/components/promptbox/PromptBoxInternal";
import {
  PluginThreadPanelNavigationProvider,
  type PluginThreadPanelOpenHandler,
} from "@/components/plugin/plugin-thread-panel-navigation";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import { useComposerTypeahead } from "./useComposerTypeahead";

const mocks = vi.hoisted(() => ({
  useCommandSuggestions: vi.fn(),
  usePromptMentions: vi.fn(),
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => mocks.usePromptMentions(),
}));

vi.mock("@/hooks/useCommandSuggestions", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/hooks/useCommandSuggestions")>();
  return {
    ...original,
    useCommandSuggestions: (args: unknown) =>
      mocks.useCommandSuggestions(args),
  };
});

let latestTypeahead: TypeaheadConfig | null = null;

function TypeaheadProbe({ enabled }: { enabled?: boolean }) {
  const { typeaheadConfig } = useComposerTypeahead({
    projectId: "proj_1",
    providerId: "pi",
    environmentId: "env_1",
    currentThreadId: "thr_1",
    selectedProviderComposerActions: [],
    resolveMentionLink: () => null,
    sideChatCommand: enabled === undefined ? undefined : { enabled },
  });
  useEffect(() => {
    latestTypeahead = typeaheadConfig;
  }, [typeaheadConfig]);
  return null;
}

function renderProbe({
  enabled,
  openThreadPanel,
}: {
  enabled?: boolean;
  openThreadPanel?: PluginThreadPanelOpenHandler;
}) {
  const probe = <TypeaheadProbe enabled={enabled} />;
  if (openThreadPanel === undefined) {
    return render(probe);
  }
  return render(
    <PluginThreadPanelNavigationProvider openThreadPanel={openThreadPanel}>
      {probe}
    </PluginThreadPanelNavigationProvider>,
  );
}

function lastCommandSuggestionsArgs(): {
  panelCommands?: readonly {
    name: string;
    pluginId: string;
    actionId: string;
    description: string | null;
  }[];
} {
  const calls = mocks.useCommandSuggestions.mock.calls;
  return calls[calls.length - 1]?.[0] ?? {};
}

function registerSideChatAction({
  run,
}: {
  run?: (context: {
    threadId: string;
    openPanel: (options?: PluginPanelActionOpenOptions) => boolean;
  }) => void;
} = {}) {
  setPluginSlotRegistrations(
    "side-chat",
    registrationSet({
      threadPanelActions: [
        {
          id: "side-chat",
          title: "Start side chat",
          component: () => null,
          run,
        },
      ],
    }),
  );
}

describe("useComposerTypeahead /side command", () => {
  beforeEach(() => {
    mocks.usePromptMentions.mockReturnValue({
      query: null,
      triggers: [],
      setQuery: vi.fn(),
      results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
      isLoading: false,
      isError: false,
    });
    mocks.useCommandSuggestions.mockReturnValue({
      trigger: "/",
      suggestions: [],
      isLoading: false,
      isError: false,
      hasMore: false,
      isLoadingMore: false,
      loadMore: () => {},
    });
  });

  afterEach(() => {
    cleanup();
    latestTypeahead = null;
    resetPluginSlotStoreForTest();
    vi.clearAllMocks();
  });

  it("offers the side command when forking is available and the action is registered", () => {
    registerSideChatAction();
    renderProbe({ enabled: true, openThreadPanel: () => true });

    expect(lastCommandSuggestionsArgs().panelCommands).toEqual([
      {
        name: "side",
        pluginId: "side-chat",
        actionId: "side-chat",
        description: "Start side chat",
      },
    ]);
  });

  it("omits the side command when forking is unavailable", () => {
    registerSideChatAction();
    renderProbe({ enabled: false, openThreadPanel: () => true });

    expect(lastCommandSuggestionsArgs().panelCommands).toBeUndefined();
  });

  it("omits the side command when the panel action is not registered", () => {
    renderProbe({ enabled: true, openThreadPanel: () => true });

    expect(lastCommandSuggestionsArgs().panelCommands).toBeUndefined();
  });

  it("omits the side command without a thread panel opener", () => {
    registerSideChatAction();
    renderProbe({ enabled: true });

    expect(lastCommandSuggestionsArgs().panelCommands).toBeUndefined();
  });

  it("runs the panel action and routes openPanel through the thread panel opener", () => {
    const openThreadPanel = vi.fn(() => true);
    const run = vi.fn(
      ({
        openPanel,
      }: {
        threadId: string;
        openPanel: (options?: PluginPanelActionOpenOptions) => boolean;
      }) => {
        openPanel({ title: "Side chat", params: { source: "command" } });
      },
    );
    registerSideChatAction({ run });
    renderProbe({ enabled: true, openThreadPanel });

    const handled = latestTypeahead?.command.onPanelAction?.({
      pluginId: "side-chat",
      actionId: "side-chat",
    });

    expect(handled).toBe(true);
    expect(run).toHaveBeenCalledWith({
      threadId: "thr_1",
      openPanel: expect.any(Function),
    });
    expect(openThreadPanel).toHaveBeenCalledWith({
      pluginId: "side-chat",
      actionId: "side-chat",
      title: "Side chat",
      params: { source: "command" },
    });
  });

  it("returns false for an unregistered panel action", () => {
    renderProbe({ enabled: true, openThreadPanel: () => true });

    expect(
      latestTypeahead?.command.onPanelAction?.({
        pluginId: "side-chat",
        actionId: "side-chat",
      }),
    ).toBe(false);
  });
});
