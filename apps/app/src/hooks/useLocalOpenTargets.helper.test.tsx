// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  useBrowserSshHosts,
  BROWSER_SSH_HOSTS_KEY,
} from "@/lib/browser-ssh-hosts";
import { useLocalOpenTargets } from "./useLocalOpenTargets";

const openWorkspace = vi.fn(async () => {});

vi.mock("./useWorkspaceOpenTargets", () => ({
  useWorkspaceOpenTargets: () => ({
    fetchWorkspaceOpenTargetsForPath: null,
    isLoading: false,
    openWorkspace,
    workspaceOpenTargets: [
      {
        id: "vscode",
        label: "VS Code",
        kind: "editor",
        capabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtLine: true,
        },
        remoteSshCapabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtLine: true,
        },
      },
    ],
  }),
}));

afterEach(() => {
  cleanup();
  localStorage.removeItem(BROWSER_SSH_HOSTS_KEY);
  vi.restoreAllMocks();
  openWorkspace.mockClear();
});

it("uses one VS Code option and browser dispatch for a mapped host, leaving another host on the helper", async () => {
  const clicked = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe(
        "vscode://vscode-remote/ssh-remote+devbox/src/file.ts:7:2",
      );
    });
  const { result } = renderHook(() => ({
    mapped: useLocalOpenTargets({
      enabled: true,
      openContext: {
        kind: "remote-ssh",
        hostId: "host-a",
        serverOrigin: location.origin,
      },
    }),
    other: useLocalOpenTargets({
      enabled: true,
      openContext: {
        kind: "remote-ssh",
        hostId: "host-b",
        serverOrigin: location.origin,
      },
    }),
    setHosts: useBrowserSshHosts()[1],
  }));
  act(() => result.current.setHosts({ "host-a": "devbox" }));
  expect(
    result.current.mapped.fileOpenTargets.map((target) => target.id),
  ).toEqual(["vscode"]);
  await act(async () => {
    expect(
      await result.current.mapped.openPathInFileTarget({
        path: "/src/file.ts",
        lineNumber: 7,
        columnNumber: 2,
        targetId: "vscode",
        rememberTarget: false,
      }),
    ).toBe(true);
    expect(
      await result.current.other.openPathInFileTarget({
        path: "/src/file.ts",
        lineNumber: 7,
        columnNumber: 2,
        targetId: "vscode",
        rememberTarget: false,
      }),
    ).toBe(true);
  });
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(openWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      context: expect.objectContaining({ hostId: "host-b" }),
    }),
  );
});
