// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import {
  BROWSER_SSH_HOSTS_KEY,
  useBrowserSshHosts,
} from "@/lib/browser-ssh-hosts";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalOpenTargets } from "./useLocalOpenTargets";

afterEach(() => {
  cleanup();
  localStorage.removeItem(BROWSER_SSH_HOSTS_KEY);
});

const contextCases: Array<{
  createContext: () => OpenInTargetContext;
  kind: OpenInTargetContext["kind"];
}> = [
  {
    kind: "local",
    createContext: () => ({ kind: "local" }),
  },
  {
    kind: "remote-ssh",
    createContext: () => ({
      kind: "remote-ssh",
      hostId: "host-1",
      serverOrigin: "https://bb.example.test",
    }),
  },
];

describe("useLocalOpenTargets", () => {
  it("opens only the configured remote machine from a browser without a helper and reverts on clear", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.href).toBe(
          "vscode://vscode-remote/ssh-remote+devbox/home/user/work%20tree",
        );
      });
    const { result } = renderHook(() => ({
      targets: useLocalOpenTargets({
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
    expect(result.current.targets.canOpenPreferredDirectoryTarget).toBe(false);
    act(() => result.current.setHosts({ "host-a": "devbox" }));
    expect(
      result.current.targets.directoryOpenTargets.map((target) => target.id),
    ).toEqual(["vscode"]);
    expect(result.current.other.canOpenPreferredDirectoryTarget).toBe(false);
    await act(async () => {
      expect(
        await result.current.targets.openPathInPreferredDirectoryTarget({
          path: "/home/user/work tree",
          lineNumber: null,
        }),
      ).toBe(true);
      expect(
        await result.current.targets.openPathInDirectoryTarget({
          path: "/home/user/work tree",
          lineNumber: null,
          rememberTarget: true,
          targetId: "vscode",
        }),
      ).toBe(true);
    });
    expect(click).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("bb.workspaceOpenTarget")).toBeNull();
    act(() => result.current.setHosts({}));
    expect(result.current.targets.canOpenPreferredDirectoryTarget).toBe(false);
    click.mockRestore();
  });

  it.each(contextCases)(
    "keeps file-open callbacks stable for equal $kind contexts",
    ({ createContext }) => {
      const { result, rerender } = renderHook(() =>
        useLocalOpenTargets({
          enabled: false,
          openContext: createContext(),
        }),
      );
      const initialOpenPathInFileTarget = result.current.openPathInFileTarget;

      rerender();

      expect(result.current.openPathInFileTarget).toBe(
        initialOpenPathInFileTarget,
      );
    },
  );
});
