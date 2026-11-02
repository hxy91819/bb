import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
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
  const dataDir = await mkdtemp(join(tmpdir(), "bb-claude-bindings-"));
  directories.push(dataDir);
  const host = createFakePluginHost({
    pluginId: "provider-claude-code",
    dataDir,
    experimental_declaredIconNames: ["./icons/claude-code.svg"],
  });
  hosts.push(host);
  await plugin(host.bb);
  return host;
}
const binding = {
  id: "ollama",
  displayName: "Ollama",
  claudeConfigDir: "~/.claude-ollama",
  reasoningLevels: ["low", "high", "max"],
  defaultReasoningLevel: "max",
  supportsFastMode: false,
};
it("registers a durable independent home, capabilities and directory identity", async () => {
  let host = await load();
  await host.harness.behavior.setSettings({
    homeBindings: JSON.stringify([binding]),
  });
  host = await host.harness.lifecycle.reload(plugin);
  hosts.push(host);
  const bound = host.harness.registrations.providerRegistrations.find(
    (provider) => provider.id === "claude-code-ollama",
  );
  expect(bound?.displayName).toBe("Claude Code · Ollama");
  expect(bound?.capabilities.reasoningLevels).toEqual(["low", "high", "max"]);
  expect(bound?.capabilities.supportsServiceTier).toBe(false);
  expect(
    bound?.experimental_deriveHostOptions?.({ hostId: "host", settings: {} }),
  ).toEqual({ claudeExecution: binding });
  await host.harness.behavior.setSettings({
    homeBindings: JSON.stringify([{ ...binding, displayName: "Renamed" }]),
  });
  expect(
    host.harness.registrations.providerRegistrations.find(
      (provider) => provider.id === "claude-code-ollama",
    )?.displayName,
  ).toBe("Claude Code · Renamed");
  await host.harness.behavior.setSettings({ homeBindings: "[]" });
  host = await host.harness.lifecycle.reload(plugin);
  hosts.push(host);
  await expect(
    host.harness.behavior.setSettings({
      homeBindings: JSON.stringify([
        { ...binding, claudeConfigDir: "~/another" },
      ]),
    }),
  ).rejects.toThrow("new binding ID");
  await host.harness.behavior.setSettings({
    homeBindings: JSON.stringify([binding]),
  });
  expect(
    host.harness.registrations.providerRegistrations.map(
      (provider) => provider.id,
    ),
  ).toEqual(["claude-code", "claude-code-ollama"]);
});
it.each([
  JSON.stringify([binding, binding]),
  JSON.stringify([{ ...binding, claudeConfigDir: "relative" }]),
  JSON.stringify([{ ...binding, defaultReasoningLevel: "medium" }]),
  JSON.stringify([{ ...binding, id: "INVALID" }]),
  "{bad-json",
])(
  "rejects invalid profiles without removing a working provider: %s",
  async (homeBindings) => {
    const host = await load();
    await host.harness.behavior.setSettings({
      homeBindings: JSON.stringify([binding]),
    });
    await expect(
      host.harness.behavior.setSettings({ homeBindings }),
    ).rejects.toThrow();
    expect(
      host.harness.registrations.providerRegistrations.some(
        (provider) => provider.id === "claude-code-ollama",
      ),
    ).toBe(true);
  },
);

it("creates durable binding storage only after the first home is configured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-claude-lazy-storage-"));
  directories.push(directory);
  const databasePath = join(directory, "data.db");
  const host = createFakePluginHost({
    pluginId: "provider-claude-code",
    experimental_declaredIconNames: ["./icons/claude-code.svg"],
  });
  hosts.push(host);
  let connection: Database.Database | undefined;
  const storage = vi
    .spyOn(host.bb.storage, "database")
    .mockImplementation(() => {
      connection ??= new Database(databasePath);
      return connection;
    });
  try {
    await plugin(host.bb);
    expect(existsSync(databasePath)).toBe(false);
    await host.harness.behavior.setSettings({
      homeBindings: JSON.stringify([binding]),
    });
    expect(existsSync(databasePath)).toBe(true);
  } finally {
    storage.mockRestore();
    connection?.close();
  }
});
