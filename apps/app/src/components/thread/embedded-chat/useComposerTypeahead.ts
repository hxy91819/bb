import { useCallback, useMemo, useState } from "react";
import type { TypeaheadConfig } from "@/components/promptbox/PromptBoxInternal";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { PromptBoxAction } from "@/components/promptbox/PromptBoxActionsMenu";
import { withAppPromptActions } from "@/components/promptbox/PromptBoxActionsMenu";
import type { ProviderComposerAction } from "@bb/domain";
import {
  buildProviderPromptActionProps,
  type ProviderCommandPanelAction,
} from "@bb/client-core";
import {
  useCommandSuggestions,
  type CommandSuggestionPanelCommand,
} from "@/hooks/useCommandSuggestions";
import { usePromptMentions } from "@/hooks/usePromptMentions";
import { usePluginSlots } from "@/lib/plugin-slots";
import { invokePluginThreadPanelAction } from "@/components/plugin/PluginPanelActions";
import { usePluginThreadPanelOpenHandler } from "@/components/plugin/plugin-thread-panel-navigation";
import {
  SIDE_CHAT_COMMAND_NAME,
  SIDE_CHAT_PLUGIN_ID,
  SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
} from "@/lib/side-chat-plugin";

interface UseComposerTypeaheadArgs {
  projectId: string;
  mentionsProjectId?: string;
  providerId: string;
  environmentId: string | null;
  currentThreadId: string;
  selectedProviderComposerActions:
    | readonly ProviderComposerAction[]
    | undefined;
  resolveMentionLink: PromptMentionLinkResolver;
  sideChatCommand?: { enabled: boolean };
}

interface UseComposerTypeaheadResult {
  typeaheadConfig: TypeaheadConfig;
  promptActions: readonly PromptBoxAction[];
}

export function useComposerTypeahead({
  projectId,
  mentionsProjectId,
  providerId,
  environmentId,
  currentThreadId,
  selectedProviderComposerActions,
  resolveMentionLink,
  sideChatCommand,
}: UseComposerTypeaheadArgs): UseComposerTypeaheadResult {
  const promptMentions = usePromptMentions(mentionsProjectId ?? projectId, {
    currentThreadId,
    environmentId,
    threadStorageThreadId: currentThreadId,
  });
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const [hasComposerFocused, setHasComposerFocused] = useState(false);
  const handleEditorFocus = useCallback(() => {
    setHasComposerFocused(true);
  }, []);
  const providerPromptActions = useMemo(
    () => buildProviderPromptActionProps(selectedProviderComposerActions ?? []),
    [selectedProviderComposerActions],
  );
  const promptActions = useMemo(
    () => withAppPromptActions(providerPromptActions.promptActions),
    [providerPromptActions.promptActions],
  );
  const openThreadPanel = usePluginThreadPanelOpenHandler();
  const { threadPanelActions } = usePluginSlots();
  const sideChatPanelCommand =
    useMemo<CommandSuggestionPanelCommand | null>(() => {
      if (sideChatCommand?.enabled !== true || openThreadPanel === null) {
        return null;
      }
      const action = threadPanelActions.find(
        (candidate) =>
          candidate.pluginId === SIDE_CHAT_PLUGIN_ID &&
          candidate.id === SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
      );
      if (action === undefined) return null;
      return {
        name: SIDE_CHAT_COMMAND_NAME,
        pluginId: SIDE_CHAT_PLUGIN_ID,
        actionId: SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
        description: action.title,
      };
    }, [openThreadPanel, sideChatCommand?.enabled, threadPanelActions]);
  const handlePanelAction = useCallback(
    (target: ProviderCommandPanelAction): boolean => {
      if (openThreadPanel === null) return false;
      const action = threadPanelActions.find(
        (candidate) =>
          candidate.pluginId === target.pluginId &&
          candidate.id === target.actionId,
      );
      if (action === undefined) return false;
      invokePluginThreadPanelAction({
        action,
        openPanel: (options) =>
          openThreadPanel({
            pluginId: action.pluginId,
            actionId: action.id,
            title: options?.title,
            params: options?.params,
          }),
        threadId: currentThreadId,
      });
      return true;
    },
    [currentThreadId, openThreadPanel, threadPanelActions],
  );
  const panelCommands = useMemo(
    () => (sideChatPanelCommand === null ? undefined : [sideChatPanelCommand]),
    [sideChatPanelCommand],
  );
  const commandSuggestions = useCommandSuggestions({
    projectId,
    providerId,
    commandScope: "thread",
    skillsTrigger: providerPromptActions.skillsTrigger,
    promptActions,
    panelCommands,
    environmentId,
    query: commandQuery,
    composerFocused: hasComposerFocused,
  });

  const typeaheadConfig = useMemo<TypeaheadConfig>(
    () => ({
      mention: {
        triggers: promptMentions.triggers,
        results: promptMentions.results,
        isLoading: promptMentions.isLoading,
        isError: promptMentions.isError,
        onQueryChange: promptMentions.setQuery,
        resolveLink: resolveMentionLink,
      },
      command: {
        trigger: commandSuggestions.trigger,
        suggestions: commandSuggestions.suggestions,
        isLoading: commandSuggestions.isLoading,
        isError: commandSuggestions.isError,
        hasMore: commandSuggestions.hasMore,
        isLoadingMore: commandSuggestions.isLoadingMore,
        loadMore: commandSuggestions.loadMore,
        onQueryChange: setCommandQuery,
        onEditorFocus: handleEditorFocus,
        onPanelAction: handlePanelAction,
      },
    }),
    [
      commandSuggestions.hasMore,
      commandSuggestions.isError,
      commandSuggestions.isLoading,
      commandSuggestions.isLoadingMore,
      commandSuggestions.loadMore,
      commandSuggestions.suggestions,
      commandSuggestions.trigger,
      handleEditorFocus,
      handlePanelAction,
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.setQuery,
      promptMentions.results,
      promptMentions.triggers,
      resolveMentionLink,
    ],
  );

  return { typeaheadConfig, promptActions };
}
