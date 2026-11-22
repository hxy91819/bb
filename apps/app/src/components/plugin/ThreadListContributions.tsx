import type { ReactNode } from "react";
import { ThreadListContributionProvider } from "@get-bb/plugin-sdk/internal/thread-contribution-runtime";
import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginContext } from "./plugin-context";

function wrapCollector(pluginId: string, child: ReactNode): ReactNode {
  return (
    <PluginContext.Provider value={pluginId}>{child}</PluginContext.Provider>
  );
}

export function ThreadListContributions({ children }: { children: ReactNode }) {
  const slots = usePluginSlots();
  return (
    <ThreadListContributionProvider
      groupings={slots.threadListGroupings}
      decorations={slots.threadRowDecorations}
      wrapCollector={wrapCollector}
    >
      {children}
    </ThreadListContributionProvider>
  );
}
