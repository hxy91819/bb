import { matchPath, useLocation } from "react-router-dom";
import { usePluginSlots } from "@/lib/plugin-slots";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import {
  SETTINGS_MACHINE_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PROJECT_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
} from "@/lib/route-paths";
import {
  isSettingsSectionId,
  SETTINGS_NAV_SECTIONS,
  type SettingsNavSection,
  type SettingsSectionId,
} from "./settings-sections";
import {
  buildPluginSettingsEntries,
  type PluginSettingsEntry,
} from "./plugin-settings-entries";

export interface SettingsNavState {
  activeSection: SettingsSectionId | null;
  hasUnknownSection: boolean;
  activePluginId: string | null;
  pluginEntries: readonly PluginSettingsEntry[];
  sections: readonly SettingsNavSection[];
}

export function useSettingsNavSections(): readonly SettingsNavSection[] {
  return SETTINGS_NAV_SECTIONS;
}

export function useSettingsNavState(): SettingsNavState {
  const location = useLocation();
  const { settingsSections } = usePluginSlots();
  const sections = useSettingsNavSections();
  const pluginListQuery = usePluginList({ enabled: true });

  const sectionMatch = matchPath(
    SETTINGS_SECTION_ROUTE_PATH,
    location.pathname,
  );
  const pluginMatch = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, location.pathname);
  const isInstalledDetail =
    new URLSearchParams(location.search).get("view") === "installed";
  const activePluginId = isInstalledDetail
    ? null
    : (pluginMatch?.params.pluginId ?? null);
  const machineMatch = matchPath(
    SETTINGS_MACHINE_ROUTE_PATH,
    location.pathname,
  );
  const activeMachineId = machineMatch?.params.hostId ?? null;
  const projectMatch = matchPath(
    SETTINGS_PROJECT_ROUTE_PATH,
    location.pathname,
  );
  const activeProjectId = projectMatch?.params.projectId ?? null;
  const sectionParam = sectionMatch?.params.section;
  const hasUnknownSection =
    sectionParam !== undefined && !isSettingsSectionId(sectionParam);
  const activeSection: SettingsSectionId | null =
    isInstalledDetail && pluginMatch !== null
      ? "plugins"
      : activeMachineId !== null
        ? "machines"
        : activeProjectId !== null
          ? "projects"
          : activePluginId !== null
            ? null
            : sectionParam !== undefined && isSettingsSectionId(sectionParam)
              ? sectionParam
              : "general";

  const installedPlugins = pluginListQuery.data?.plugins ?? [];
  const pluginEntries = buildPluginSettingsEntries({
    installedPlugins,
    settingsSections,
  });

  return {
    activePluginId,
    activeSection,
    hasUnknownSection,
    pluginEntries,
    sections,
  };
}
