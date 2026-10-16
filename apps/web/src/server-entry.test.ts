import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  unavailable: false,
  response: new Response("page"),
  dispose: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler:
    (handler: (context: object) => Promise<{ response: Response }>) =>
    async (request: Request) => {
      const result = await handler({
        request,
        router: {
          state: {
            matches: [
              {
                loaderData: {
                  status: state.unavailable ? "unavailable" : "available",
                },
              },
            ],
          },
        },
      });
      return result.response;
    },
  defaultStreamHandler: async () => ({
    response: state.response,
    serverSsrCleanup: "stream",
    dispose: state.dispose,
  }),
}));

import server from "./server-entry.js";

beforeEach(() => {
  state.unavailable = false;
  state.response = new Response("page", {
    headers: { "content-type": "text/html", "x-rendered": "true" },
  });
});

it("returns an uncached 503 when marketplace data is unavailable", async () => {
  state.unavailable = true;
  const response = await server.fetch(
    new Request("https://web.test/marketplace"),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-rendered")).toBe("true");
  expect(await response.text()).toBe("page");
});

it("caches a healthy marketplace page", async () => {
  const response = await server.fetch(
    new Request("https://web.test/marketplace"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=300, must-revalidate",
  );
});

it("preserves an unrelated response", async () => {
  state.unavailable = true;
  state.response = new Response("missing", { status: 404 });
  const response = await server.fetch(
    new Request("https://web.test/dashboard"),
  );
  expect(response).toBe(state.response);
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBeNull();
});
