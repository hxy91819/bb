import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createFakePluginHost,
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
