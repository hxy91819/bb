import { EnvHttpProxyAgent } from "undici";

let dispatcher: EnvHttpProxyAgent | null = null;

export function fetchCodexAi(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  dispatcher ??= new EnvHttpProxyAgent();
  const options = { ...init, dispatcher };
  return fetch(input, options);
}

export async function disposeCodexAiTransport(): Promise<void> {
  const current = dispatcher;
  dispatcher = null;
  await current?.destroy();
}
