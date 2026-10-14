export interface VsCodeRemoteUrlArgs {
  sshHost: string;
  path: string;
  kind: "file" | "directory";
  lineNumber?: number | null;
  columnNumber?: number | null;
}

export function buildVsCodeRemoteUrl(args: VsCodeRemoteUrlArgs): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(args.sshHost)) {
    throw new Error("SSH Host must be a single SSH config alias.");
  }
  if (
    !args.path.startsWith("/") ||
    args.path.startsWith("//") ||
    /[\r\n\0]/u.test(args.path)
  ) {
    throw new Error("Remote path must be an absolute Unix path.");
  }
  if (
    args.kind === "directory" &&
    (args.lineNumber != null || args.columnNumber != null)
  ) {
    throw new Error("Line and column require a file path.");
  }
  for (const value of [args.lineNumber, args.columnNumber]) {
    if (value != null && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error("Line and column must be positive integers.");
    }
  }
  const location =
    args.kind === "file"
      ? `:${args.lineNumber ?? 1}${args.columnNumber == null ? "" : `:${args.columnNumber}`}`
      : "";
  return `vscode://vscode-remote/ssh-remote+${args.sshHost}${args.path.split("/").map(encodeURIComponent).join("/")}${location}`;
}
