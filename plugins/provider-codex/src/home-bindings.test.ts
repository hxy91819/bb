import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";

const hosts: FakePluginHost[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function load() {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-codex-bindings-"));
  directories.push(dataDir);
  const host = createFakePluginHost({
    pluginId: "provider-codex",
    dataDir,
    experimental_declaredIconNames: ["./icons/codex.svg"],
  });
  hosts.push(host);
  await plugin(host.bb);
  return host;
}

const binding = { id: "work", displayName: "Work", codexHome: "~/work-codex" };

it("persists a binding, permits rename, and preserves its directory identity after removal and reload", async () => {
  let host = await load();
  await host.harness.behavior.setSettings({
    homeBindings: JSON.stringify([binding]),
  });
  host = await host.harness.lifecycle.reload(plugin);
  hosts.push(host);
  const bound = host.harness.registrations.providerRegistrations.find(
    (provider) => provider.id === "codex-work",
  );
  expect(
    bound?.experimental_deriveHostOptions?.({ hostId: "host", settings: {} }),
  ).toEqual({
    codexExecution: {
      kind: "home",
      providerId: "codex-work",
      codexHome: binding.codexHome,
    },
  });
  await host.harness.behavior.setSettings({
    homeBindings: JSON.stringify([{ ...binding, displayName: "Renamed" }]),
  });
  expect(
    host.harness.registrations.providerRegistrations.find(
      (provider) => provider.id === "codex-work",
    )?.displayName,
  ).toBe("Codex · Renamed");
  await host.harness.behavior.setSettings({ homeBindings: "[]" });
  host = await host.harness.lifecycle.reload(plugin);
  hosts.push(host);
  await expect(
    host.harness.behavior.setSettings({
      homeBindings: JSON.stringify([{ ...binding, codexHome: "~/another" }]),
    }),
  ).rejects.toThrow("new binding ID");
  await host.harness.behavior.setSettings({
    homeBindings: JSON.stringify([binding]),
  });
  expect(
    host.harness.registrations.providerRegistrations.map(
      (provider) => provider.id,
    ),
  ).toEqual(["codex", "codex-work"]);
});

it.each([
  JSON.stringify([binding, binding]),
  JSON.stringify([{ ...binding, codexHome: "relative-home" }]),
  JSON.stringify([{ ...binding, id: "INVALID" }]),
  "{bad-json",
])(
  "rejects invalid settings without replacing the current identities: %s",
  async (homeBindings) => {
    const host = await load();
    await host.harness.behavior.setSettings({
      homeBindings: JSON.stringify([binding]),
    });
    await expect(
      host.harness.behavior.setSettings({ homeBindings }),
    ).rejects.toThrow();
    expect(
      host.harness.registrations.providerRegistrations.map(
        (provider) => provider.id,
      ),
    ).toEqual(["codex", "codex-work"]);
  },
);

it("applies the memory opt-out to both default and bound native providers", async () => {
  const host = await load();
  await host.harness.behavior.setSettings({
    memoryEnabled: false,
    homeBindings: JSON.stringify([binding]),
  });
  const providers = host.harness.registrations.providerRegistrations;
  expect(providers.map((provider) => provider.id)).toEqual([
    "codex",
    "codex-work",
  ]);
  for (const provider of providers) {
    expect(
      provider.deriveProviderOptions?.({
        threadId: "memory-disabled",
        projectId: "project",
        model: "gpt-5",
        permissionMode: "full",
        settings: { memoryEnabled: false },
      }),
    ).toMatchObject({ memoryEnabled: false });
  }
});

it("opens bound-provider questions, returns answers to that thread, and stops handling removed bindings", async () => {
  const host = await load();
  await host.harness.behavior.setSettings({
    homeBindings: JSON.stringify([binding]),
  });
  host.harness.sdk.stub(
    "threads.events.list",
    async (args: { threadId: string; afterSeq: string }) =>
      Number(args.afterSeq) > 0
        ? []
        : [
            {
              id: "bound-question",
              threadId: args.threadId,
              seq: 1,
              createdAt: 1,
              scope: { kind: "thread" },
              type: "thread/extensionState/updated",
              data: {
                kind: "provider-codex/async-question",
                payload: {
                  itemId: "call-bound",
                  questions: [{ title: "Continue?", options: ["Yes", "No"] }],
                },
              },
            },
          ],
  );
  host.harness.sdk.stub("threads.send", async () => ({}));
  await host.harness.emitThreadEvent("experimental_thread.events", {
    thread: makeThreadResponse({
      id: "thr_bound_question",
      providerId: "codex-work",
    }),
    sequence: 1,
  });
  await vi.waitFor(() =>
    expect(host.harness.pendingInteractions).toHaveLength(1),
  );
  const pending = host.harness.pendingInteractions[0]!;
  expect(pending.threadId).toBe("thr_bound_question");
  host.harness.submitInteraction(pending.id, {
    answers: { "question-1": { selected: ["option-1"] } },
  });
  await vi.waitFor(() =>
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([
      [
        {
          threadId: "thr_bound_question",
          mode: "auto",
          input: [{ type: "text", text: "> Continue?\n\nYes", mentions: [] }],
        },
      ],
    ]),
  );
  await host.harness.behavior.setSettings({ homeBindings: "[]" });
  await host.harness.emitThreadEvent("experimental_thread.events", {
    thread: makeThreadResponse({
      id: "thr_removed_question",
      providerId: "codex-work",
    }),
    sequence: 1,
  });
  expect(host.harness.sdk.callsTo("threads.events.list")).toHaveLength(1);
  expect(host.harness.pendingInteractions).toHaveLength(0);
});
