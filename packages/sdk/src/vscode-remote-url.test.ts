import { describe, expect, it } from "vitest";
import { buildVsCodeRemoteUrl } from "./vscode-remote-url.js";

describe("buildVsCodeRemoteUrl", () => {
  it("opens a worktree directory without a file location", () => {
    expect(
      buildVsCodeRemoteUrl({
        sshHost: "devbox",
        path: "/home/人/work tree",
        kind: "directory",
      }),
    ).toBe(
      "vscode://vscode-remote/ssh-remote+devbox/home/%E4%BA%BA/work%20tree",
    );
  });

  it("opens extensionless files at line one and preserves special path characters", () => {
    expect(
      buildVsCodeRemoteUrl({
        sshHost: "dev-box",
        path: "/home/a/%#? file",
        kind: "file",
      }),
    ).toBe(
      "vscode://vscode-remote/ssh-remote+dev-box/home/a/%25%23%3F%20file:1",
    );
    expect(
      buildVsCodeRemoteUrl({
        sshHost: "devbox",
        path: "/src/a.ts",
        kind: "file",
        lineNumber: 12,
        columnNumber: 3,
      }),
    ).toBe("vscode://vscode-remote/ssh-remote+devbox/src/a.ts:12:3");
  });

  it("rejects protocols, unsafe aliases, nonabsolute paths and invalid locations", () => {
    for (const sshHost of [
      "user@host",
      "ssh://devbox",
      "devbox/other",
      "two hosts",
    ]) {
      expect(() =>
        buildVsCodeRemoteUrl({ sshHost, path: "/repo", kind: "directory" }),
      ).toThrow();
    }
    for (const path of ["relative", "//other/repo", "/repo\nother"]) {
      expect(() =>
        buildVsCodeRemoteUrl({ sshHost: "devbox", path, kind: "directory" }),
      ).toThrow();
    }
    expect(() =>
      buildVsCodeRemoteUrl({
        sshHost: "devbox",
        path: "/a",
        kind: "file",
        lineNumber: 0,
      }),
    ).toThrow();
    expect(() =>
      buildVsCodeRemoteUrl({
        sshHost: "devbox",
        path: "/a",
        kind: "directory",
        lineNumber: 3,
      }),
    ).toThrow();
  });
});
