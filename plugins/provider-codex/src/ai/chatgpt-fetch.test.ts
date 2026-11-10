import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { fetchChatGpt } from "./chatgpt-fetch.js";
import { disposeCodexAiTransport } from "./fetch.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await disposeCodexAiTransport();
  while (cleanups.length > 0) await cleanups.pop()?.();
  vi.unstubAllEnvs();
});

async function listen(server: http.Server): Promise<number> {
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a listening TCP server");
  }
  return address.port;
}

it.each([false, true])(
  "routes AI requests through HTTP_PROXY unless NO_PROXY bypasses it (%s)",
  async (bypass) => {
    const origin = http.createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.end(`${request.method} ${request.url}: ${body}`);
    });
    const originPort = await listen(origin);
    let tunnels = 0;
    const proxy = http.createServer();
    proxy.on("connect", (_request, socket, head) => {
      tunnels++;
      const upstream = net.connect(originPort, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      socket.on("close", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
    });
    const proxyPort = await listen(proxy);
    vi.stubEnv("http_proxy", undefined);
    vi.stubEnv("no_proxy", undefined);
    vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`);
    vi.stubEnv("NO_PROXY", bypass ? "127.0.0.1" : "");
    const response = await fetchChatGpt({
      url: `http://127.0.0.1:${originPort}/responses`,
      init: () => ({
        method: "POST",
        body: "Generate a thread title",
        signal: AbortSignal.timeout(1000),
      }),
    });
    expect(await response.text()).toBe(
      "POST /responses: Generate a thread title",
    );
    expect(tunnels).toBe(bypass ? 0 : 1);
  },
);
