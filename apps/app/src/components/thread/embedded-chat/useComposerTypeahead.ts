import { useCallback, useMemo } from "react";
import type { TypeaheadConfig } from "@/components/promptbox/ComposerBox";
import type { PromptMentionLinkResolver } from "@bb/client-core";
import type { PromptBoxAction } from "@/components/promptbox/ComposerBox";
import type { ProviderComposerAction } from "@bb/domain";
import type { ProviderCommand } from "@bb/server-contract";
import {
  buildProviderPromptActionProps,
  type ProviderCommandPanelAction,
} from "@bb/client-core";
import type { CommandSuggestionPanelCommand } from "@/hooks/useCommandSuggestions";
import { usePluginSlots, isThreadTab } from "@/lib/plugin-slots";
import { invokePluginPanelAction } from "@/components/plugin/PluginPanelActions";
import { usePluginThreadPanelOpenHandler } from "@/components/plugin/plugin-thread-panel-navigation";
import {
  SIDE_CHAT_COMMAND_NAME,
  SIDE_CHAT_PLUGIN_ID,
  SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
} from "@/lib/side-chat-plugin";
import { usePromptMentionTriggers } from "@/hooks/usePromptMentions";

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
  const { promptActions, skillsTriggers } = providerPromptActions;
  const mentionSourceProjectId = mentionsProjectId ?? projectId;
  const openThreadPanel = usePluginThreadPanelOpenHandler();
  const { tabs } = usePluginSlots();
  const threadPanelActions = useMemo(
    () =>
      tabs.filter(isThreadTab).filter((tab) => tab.availability === "action"),
    [tabs],
  );
  const panelCommands = useMemo<
    readonly CommandSuggestionPanelCommand[] | undefined
  >(() => {
    if (sideChatCommand?.enabled !== true || openThreadPanel === null)
      return undefined;
    const action = threadPanelActions.find(
      (candidate) =>
        candidate.pluginId === SIDE_CHAT_PLUGIN_ID &&
        candidate.id === SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
    );
    return action
      ? [
          {
            name: SIDE_CHAT_COMMAND_NAME,
            pluginId: action.pluginId,
            actionId: action.id,
            description: action.title,
          },
        ]
      : undefined;
  }, [openThreadPanel, sideChatCommand?.enabled, threadPanelActions]);
  const handlePanelAction = useCallback(
    (target: ProviderCommandPanelAction): boolean => {
      if (openThreadPanel === null) return false;
      const action = threadPanelActions.find(
        (candidate) =>
          candidate.pluginId === target.pluginId &&
          candidate.id === target.actionId,
      );
      if (!action) return false;
      invokePluginPanelAction({
        action,
        context: { kind: "thread", threadId: currentThreadId },
        openPanel: (options) =>
          openThreadPanel({
            pluginId: action.pluginId,
            actionId: action.id,
            title: options?.title,
            params: options?.params,
          }),
      });
      return true;
    },
    [currentThreadId, openThreadPanel, threadPanelActions],
  );

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
        onPanelAction: handlePanelAction,
        source: {
          projectId,
          providerId,
          commandScope,
          skillsTriggers,
          promptActions,
          panelCommands,
          threadProviderCommands: threadProviderCommands ?? null,
          environmentId,
        },
      },
    }),
    [
      commandScope,
      handlePanelAction,
      panelCommands,
      currentThreadId,
      environmentId,
      mentionSourceProjectId,
      mentionTriggers,
      projectId,
      promptActions,
      providerId,
      resolveMentionLink,
      skillsTriggers,
      threadProviderCommands,
    ],
  );

  return { typeaheadConfig, promptActions };
}
