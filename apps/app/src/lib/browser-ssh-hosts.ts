import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { buildVsCodeRemoteUrl } from "@bb/sdk/browser";
import { createJsonLocalStorage } from "./browser-storage";

export const BROWSER_SSH_HOSTS_KEY = "bb.browserSshHosts";

function isSshHostMap(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([id, alias]) =>
        id.length > 0 && typeof alias === "string" && isValidSshHost(alias),
    )
  );
}

export function isValidSshHost(alias: string): boolean {
  try {
    buildVsCodeRemoteUrl({ sshHost: alias, path: "/", kind: "directory" });
    return true;
  } catch {
    return false;
  }
}

const sshHostsAtom = atomWithStorage<Record<string, string>>(
  BROWSER_SSH_HOSTS_KEY,
  {},
  createJsonLocalStorage(isSshHostMap),
  { getOnInit: true },
);

export function useBrowserSshHosts() {
  return useAtom(sshHostsAtom);
}
