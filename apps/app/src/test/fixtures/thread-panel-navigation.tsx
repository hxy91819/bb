import type { ReactNode } from "react";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import { UNAVAILABLE_APP_PANEL_CONTROLLER } from "@/lib/app-fixed-tab-navigation";

export type PluginThreadPanelOpenHandler = (args: {
  pluginId: string;
  actionId: string;
  title?: string;
  params?: JsonValue;
}) => boolean;

export function PluginThreadPanelNavigationProvider({ children, openThreadPanel }: {
  children: ReactNode;
  openThreadPanel: PluginThreadPanelOpenHandler;
}) {
  return <AppNavigationHostProvider capabilities={{ panel: {
    ...UNAVAILABLE_APP_PANEL_CONTROLLER,
    openTab: (intent) => openThreadPanel({
      pluginId: intent.tab.ownerId.replace(/^plugin-thread:/, ""),
      actionId: intent.tab.tabId,
      title: intent.title,
      params: intent.params,
    }),
  } }}>{children}</AppNavigationHostProvider>;
}
