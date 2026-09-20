import { useMemo } from "react";
import type { TypeaheadConfig } from "@/components/promptbox/ComposerBox";
import type { PromptMentionLinkResolver } from "@bb/client-core";
import type { PromptBoxAction } from "@/components/promptbox/ComposerBox";
import type { ProviderComposerAction } from "@bb/domain";
import type { ProviderCommand } from "@bb/server-contract";
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
  commandScope?: "new-thread" | "thread";
  environmentId: string | null;
  currentThreadId: string;
  selectedProviderComposerActions:
    | readonly ProviderComposerAction[]
    | undefined;
  threadProviderCommands?: readonly ProviderCommand[] | null;
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
  commandScope = "thread",
  environmentId,
  currentThreadId,
  selectedProviderComposerActions,
  threadProviderCommands,
  resolveMentionLink,
  sideChatCommand,
}: UseComposerTypeaheadArgs): UseComposerTypeaheadResult {
  const mentionTriggers = usePromptMentionTriggers();
  const providerPromptActions = useMemo(
    () => buildProviderPromptActionProps(selectedProviderComposerActions ?? []),
    [selectedProviderComposerActions],
  );
  const { promptActions } = providerPromptActions;
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
    commandScope,
    skillsTriggers: providerPromptActions.skillsTriggers,
    activeTrigger: commandState.trigger,
    promptActions,
    threadProviderCommands: threadProviderCommands ?? null,
    panelCommands,
    environmentId,
    query: commandState.query,
    composerFocused: hasComposerFocused,
  });

  const typeaheadConfig = useMemo<TypeaheadConfig>(
    () => ({
      mention: {
        triggers: mentionTriggers,
        source: {
          projectId: mentionSourceProjectId,
          currentThreadId,
          environmentId,
          threadStorageThreadId: currentThreadId,
        },
        resolveLink: resolveMentionLink,
      },
      command: {
        triggers: commandSuggestions.triggers,
        suggestions: commandSuggestions.suggestions,
        isLoading: commandSuggestions.isLoading,
        isError: commandSuggestions.isError,
        hasMore: commandSuggestions.hasMore,
        isLoadingMore: commandSuggestions.isLoadingMore,
        loadMore: commandSuggestions.loadMore,
        onQueryChange: (query, trigger) => setCommandState({ query, trigger }),
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
      commandSuggestions.triggers,
      handleEditorFocus,
      handlePanelAction,
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.isRefreshing,
      promptMentions.setQuery,
      promptMentions.results,
      promptMentions.triggers,
      resolveMentionLink,
      skillsTriggers,
      threadProviderCommands,
    ],
  );

  return { typeaheadConfig, promptActions };
}
