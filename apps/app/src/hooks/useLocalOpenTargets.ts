import { useCallback, useMemo } from "react";
import type {
  OpenInTargetContext,
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { buildVsCodeRemoteUrl } from "@bb/sdk/browser";
import { appToast } from "@/components/ui/app-toast";
import { useBrowserSshHosts } from "@/lib/browser-ssh-hosts";
import {
  resolvePreferredWorkspaceOpenFileTarget,
  resolvePreferredWorkspaceOpenTarget,
  supportsWorkspaceOpenTargetCapability,
  type StoredWorkspaceOpenTargetPreference,
  type WorkspaceOpenTargetContextKind,
  useFileOpenTargetPreference,
  useWorkspaceOpenTargetPreference,
} from "@/lib/workspace-open-target-preference";
import { useHostDaemon } from "./useHostDaemon";
import { useWorkspaceOpenTargets } from "./useWorkspaceOpenTargets";

const LOCAL_OPEN_FAILURE_TITLE = "Failed to open file locally";
const LOCAL_DAEMON_UNAVAILABLE_OPEN_DESCRIPTION =
  "Local host daemon is unavailable.";
const LOCAL_NO_FILE_OPEN_TARGETS_DESCRIPTION = "No local app can open files.";
const LOCAL_NO_DIRECTORY_OPEN_TARGETS_DESCRIPTION =
  "No local app can open directories.";
const BROWSER_VSCODE_TARGET: WorkspaceOpenTarget = {
  id: "vscode",
  label: "VS Code",
  kind: "editor",
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
    openFileAtColumn: true,
  },
  remoteSshCapabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
    openFileAtColumn: true,
  },
};

interface UseLocalOpenTargetsArgs {
  enabled: boolean;
  openContext?: OpenInTargetContext;
}

interface OpenLocalPathRequest {
  columnNumber?: number | null;
  lineNumber: number | null;
  path: string;
}

interface OpenPathInDirectoryTargetArgs extends OpenLocalPathRequest {
  rememberTarget: boolean;
  targetId: WorkspaceOpenTargetId;
}

interface OpenPathInFileTargetArgs extends OpenLocalPathRequest {
  rememberTarget: boolean;
  targetId: WorkspaceOpenTargetId;
}

interface OpenPathInAvailableTargetArgs extends OpenLocalPathRequest {
  rememberTarget: boolean;
  target: WorkspaceOpenTarget;
  targetKind: OpenUnavailableTargetKind;
}

interface UseLocalOpenTargetsResult {
  canOpenPreferredDirectoryTarget: boolean;
  canOpenPreferredFileTarget: boolean;
  directoryOpenTargets: WorkspaceOpenTarget[];
  fileOpenTargets: WorkspaceOpenTarget[];
  isLoading: boolean;
  openPathInDirectoryTarget: (
    args: OpenPathInDirectoryTargetArgs,
  ) => Promise<boolean>;
  openPathInFileTarget: (args: OpenPathInFileTargetArgs) => Promise<boolean>;
  openPathInPreferredDirectoryTarget: (
    args: OpenLocalPathRequest,
  ) => Promise<boolean>;
  openPathInPreferredFileTarget: (
    args: OpenLocalPathRequest,
  ) => Promise<boolean>;
  preferredDirectoryTarget: WorkspaceOpenTarget | null;
  preferredFileTarget: WorkspaceOpenTarget | null;
}

type OpenUnavailableTargetKind = "file-open-target" | "directory-open-target";

interface OpenUnavailableDescriptionArgs {
  hasDaemon: boolean;
  targetKind: OpenUnavailableTargetKind;
}

interface DispatchOpenFailureToastArgs {
  description?: string;
}

interface SupportedLineNumberArgs {
  columnNumber: number | null;
  contextKind: WorkspaceOpenTargetContextKind;
  lineNumber: number | null;
  target: WorkspaceOpenTarget;
}

interface SupportedLocation {
  columnNumber: number | null;
  lineNumber: number | null;
}

interface UseOpenTargetResolutionArgs {
  contextKind: WorkspaceOpenTargetContextKind;
  preferredDirectoryTargetId: StoredWorkspaceOpenTargetPreference;
  preferredFileTargetId: StoredWorkspaceOpenTargetPreference;
  workspaceOpenTargets: WorkspaceOpenTarget[];
}

interface OpenTargetResolution {
  directoryOpenTargets: WorkspaceOpenTarget[];
  fileOpenTargets: WorkspaceOpenTarget[];
  preferredDirectoryTarget: WorkspaceOpenTarget | null;
  preferredFileTarget: WorkspaceOpenTarget | null;
}

function getOpenUnavailableDescription(
  args: OpenUnavailableDescriptionArgs,
): string {
  if (!args.hasDaemon) {
    return LOCAL_DAEMON_UNAVAILABLE_OPEN_DESCRIPTION;
  }

  if (args.targetKind === "file-open-target") {
    return LOCAL_NO_FILE_OPEN_TARGETS_DESCRIPTION;
  }

  return LOCAL_NO_DIRECTORY_OPEN_TARGETS_DESCRIPTION;
}

function dispatchOpenFailureToast(args: DispatchOpenFailureToastArgs): void {
  appToast.error(LOCAL_OPEN_FAILURE_TITLE, {
    ...(args.description ? { description: args.description } : {}),
  });
}

function getSupportedLocation(
  args: SupportedLineNumberArgs,
): SupportedLocation {
  const lineNumber = supportsWorkspaceOpenTargetCapability({
    capability: "openFileAtLine",
    contextKind: args.contextKind,
    target: args.target,
  })
    ? args.lineNumber
    : null;
  const columnNumber =
    lineNumber !== null &&
    supportsWorkspaceOpenTargetCapability({
      capability: "openFileAtColumn",
      contextKind: args.contextKind,
      target: args.target,
    })
      ? args.columnNumber
      : null;
  return { columnNumber, lineNumber };
}

function useOpenTargetResolution(
  args: UseOpenTargetResolutionArgs,
): OpenTargetResolution {
  const directoryOpenTargets = useMemo(
    () =>
      args.workspaceOpenTargets.filter((target) =>
        supportsWorkspaceOpenTargetCapability({
          capability: "openDirectory",
          contextKind: args.contextKind,
          target,
        }),
      ),
    [args.contextKind, args.workspaceOpenTargets],
  );
  const fileOpenTargets = useMemo(
    () =>
      args.workspaceOpenTargets.filter((target) =>
        supportsWorkspaceOpenTargetCapability({
          capability: "openFile",
          contextKind: args.contextKind,
          target,
        }),
      ),
    [args.contextKind, args.workspaceOpenTargets],
  );
  const preferredDirectoryTarget = useMemo(
    () =>
      resolvePreferredWorkspaceOpenTarget({
        capability: "openDirectory",
        contextKind: args.contextKind,
        preferredTargetId: args.preferredDirectoryTargetId,
        targets: directoryOpenTargets,
      }),
    [args.contextKind, args.preferredDirectoryTargetId, directoryOpenTargets],
  );
  const preferredFileTarget = useMemo(
    () =>
      resolvePreferredWorkspaceOpenTarget({
        capability: "openFile",
        contextKind: args.contextKind,
        preferredTargetId: args.preferredFileTargetId,
        targets: fileOpenTargets,
      }),
    [args.contextKind, args.preferredFileTargetId, fileOpenTargets],
  );

  return {
    directoryOpenTargets,
    fileOpenTargets,
    preferredDirectoryTarget,
    preferredFileTarget,
  };
}

export function useLocalOpenTargets(
  args: UseLocalOpenTargetsArgs,
): UseLocalOpenTargetsResult {
  const openContextKind = args.openContext?.kind ?? "local";
  const openContextHostId =
    args.openContext?.kind === "remote-ssh" ? args.openContext.hostId : null;
  const openContextServerOrigin =
    args.openContext?.kind === "remote-ssh"
      ? args.openContext.serverOrigin
      : null;
  const openContext = useMemo<OpenInTargetContext>(
    () =>
      openContextKind === "remote-ssh" &&
      openContextHostId !== null &&
      openContextServerOrigin !== null
        ? {
            kind: "remote-ssh",
            hostId: openContextHostId,
            serverOrigin: openContextServerOrigin,
          }
        : { kind: "local" },
    [openContextHostId, openContextKind, openContextServerOrigin],
  );
  const contextKind = openContext.kind;
  const [sshHosts] = useBrowserSshHosts();
  const sshHost =
    args.enabled && openContext.kind === "remote-ssh"
      ? sshHosts[openContext.hostId]
      : undefined;
  const { hasDaemon } = useHostDaemon();
  const {
    fetchWorkspaceOpenTargetsForPath,
    isLoading: daemonLoading,
    openWorkspace,
    workspaceOpenTargets: daemonTargets,
  } = useWorkspaceOpenTargets(args);
  const workspaceOpenTargets = useMemo(
    () =>
      sshHost === undefined
        ? daemonTargets
        : [
            BROWSER_VSCODE_TARGET,
            ...daemonTargets.filter((target) => target.id !== "vscode"),
          ],
    [daemonTargets, sshHost],
  );
  const [preferredDirectoryTargetId, setPreferredDirectoryTargetId] =
    useWorkspaceOpenTargetPreference(workspaceOpenTargets);
  const [preferredFileTargetId, setPreferredFileTargetId] =
    useFileOpenTargetPreference(workspaceOpenTargets);
  const {
    directoryOpenTargets,
    fileOpenTargets,
    preferredDirectoryTarget,
    preferredFileTarget,
  } = useOpenTargetResolution({
    contextKind,
    preferredDirectoryTargetId:
      sshHost === undefined ? preferredDirectoryTargetId : "vscode",
    preferredFileTargetId:
      sshHost === undefined ? preferredFileTargetId : "vscode",
    workspaceOpenTargets,
  });
  const rememberPreferredOpenTarget = useCallback(
    (target: WorkspaceOpenTarget) => {
      if (
        supportsWorkspaceOpenTargetCapability({
          capability: "openDirectory",
          contextKind,
          target,
        })
      ) {
        setPreferredDirectoryTargetId(target.id);
      }
      if (
        supportsWorkspaceOpenTargetCapability({
          capability: "openFile",
          contextKind,
          target,
        })
      ) {
        setPreferredFileTargetId(target.id);
      }
    },
    [contextKind, setPreferredDirectoryTargetId, setPreferredFileTargetId],
  );

  const openPathInAvailableTarget = useCallback(
    async (request: OpenPathInAvailableTargetArgs) => {
      if (sshHost !== undefined && request.target.id === "vscode") {
        try {
          const url = buildVsCodeRemoteUrl({
            sshHost,
            path: request.path,
            kind:
              request.targetKind === "file-open-target" ? "file" : "directory",
            lineNumber: request.lineNumber,
            columnNumber: request.columnNumber,
          });
          const link = document.createElement("a");
          link.href = url;
          link.click();
          return true;
        } catch (error) {
          dispatchOpenFailureToast({
            description: error instanceof Error ? error.message : undefined,
          });
          return false;
        }
      }
      if (!openWorkspace) {
        dispatchOpenFailureToast({
          description: getOpenUnavailableDescription({
            hasDaemon,
            targetKind: request.targetKind,
          }),
        });
        return false;
      }

      if (request.rememberTarget) {
        rememberPreferredOpenTarget(request.target);
      }

      try {
        const location = getSupportedLocation({
          columnNumber: request.columnNumber ?? null,
          contextKind,
          lineNumber: request.lineNumber,
          target: request.target,
        });
        await openWorkspace({
          columnNumber: location.columnNumber,
          context: openContext,
          lineNumber: location.lineNumber,
          path: request.path,
          targetId: request.target.id,
        });
        return true;
      } catch (error) {
        const description = error instanceof Error ? error.message : undefined;
        dispatchOpenFailureToast({ ...(description ? { description } : {}) });
        return false;
      }
    },
    [
      hasDaemon,
      contextKind,
      openWorkspace,
      openContext,
      rememberPreferredOpenTarget,
      sshHost,
    ],
  );

  const openPathInDirectoryTarget = useCallback(
    async (request: OpenPathInDirectoryTargetArgs) => {
      const target = directoryOpenTargets.find(
        (candidate) => candidate.id === request.targetId,
      );
      if (!target) {
        dispatchOpenFailureToast({
          description: getOpenUnavailableDescription({
            hasDaemon,
            targetKind: "directory-open-target",
          }),
        });
        return false;
      }

      return openPathInAvailableTarget({
        columnNumber: request.columnNumber ?? null,
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: request.rememberTarget,
        target,
        targetKind: "directory-open-target",
      });
    },
    [directoryOpenTargets, hasDaemon, openPathInAvailableTarget],
  );
  const openPathInFileTarget = useCallback(
    async (request: OpenPathInFileTargetArgs) => {
      const target = fileOpenTargets.find(
        (candidate) => candidate.id === request.targetId,
      );
      if (!target) {
        dispatchOpenFailureToast({
          description: getOpenUnavailableDescription({
            hasDaemon,
            targetKind: "file-open-target",
          }),
        });
        return false;
      }

      return openPathInAvailableTarget({
        columnNumber: request.columnNumber ?? null,
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: request.rememberTarget,
        target,
        targetKind: "file-open-target",
      });
    },
    [fileOpenTargets, hasDaemon, openPathInAvailableTarget],
  );

  const openPathInPreferredDirectoryTarget = useCallback(
    async (request: OpenLocalPathRequest) => {
      if (!preferredDirectoryTarget) {
        dispatchOpenFailureToast({
          description: getOpenUnavailableDescription({
            hasDaemon,
            targetKind: "directory-open-target",
          }),
        });
        return false;
      }

      return openPathInAvailableTarget({
        columnNumber: request.columnNumber ?? null,
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: false,
        target: preferredDirectoryTarget,
        targetKind: "directory-open-target",
      });
    },
    [hasDaemon, openPathInAvailableTarget, preferredDirectoryTarget],
  );
  const openPathInPreferredFileTarget = useCallback(
    async (request: OpenLocalPathRequest) => {
      if (sshHost !== undefined) {
        return openPathInAvailableTarget({
          ...request,
          rememberTarget: false,
          target: BROWSER_VSCODE_TARGET,
          targetKind: "file-open-target",
        });
      }
      const fileTargets =
        contextKind === "local" && fetchWorkspaceOpenTargetsForPath !== null
          ? await fetchWorkspaceOpenTargetsForPath(request.path).catch(
              () => workspaceOpenTargets,
            )
          : workspaceOpenTargets;
      const target = resolvePreferredWorkspaceOpenFileTarget({
        contextKind,
        lineNumber: request.lineNumber,
        path: request.path,
        preferredTargetId: preferredFileTargetId,
        targets: fileTargets,
      });

      if (!target) {
        dispatchOpenFailureToast({
          description: getOpenUnavailableDescription({
            hasDaemon,
            targetKind: "file-open-target",
          }),
        });
        return false;
      }

      return openPathInAvailableTarget({
        columnNumber: request.columnNumber ?? null,
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: false,
        target,
        targetKind: "file-open-target",
      });
    },
    [
      contextKind,
      fetchWorkspaceOpenTargetsForPath,
      hasDaemon,
      openPathInAvailableTarget,
      preferredFileTargetId,
      workspaceOpenTargets,
      sshHost,
    ],
  );

  return {
    canOpenPreferredDirectoryTarget: preferredDirectoryTarget !== null,
    canOpenPreferredFileTarget: preferredFileTarget !== null,
    directoryOpenTargets,
    fileOpenTargets,
    isLoading: sshHost === undefined && daemonLoading,
    openPathInDirectoryTarget,
    openPathInFileTarget,
    openPathInPreferredDirectoryTarget,
    openPathInPreferredFileTarget,
    preferredDirectoryTarget,
    preferredFileTarget,
  };
}
