import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runtimeBuildOptions, runtimeEntries } from "./runtime-entries.mjs";

const run = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const {
  exports: packageExports,
  dependencies,
  peerDependencies,
} = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const libraryEntries = runtimeEntries(packageExports).filter(
  (entry) => entry.subpath !== undefined,
);

describe("published runtime entries", () => {
  let outDir;
  const outputs = new Map();

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(packageRoot, ".runtime-test-"));
    for (const entry of libraryEntries) {
      const outfile = path.join(outDir, path.relative("dist", entry.output));
      await build({
        ...runtimeBuildOptions(packageRoot, entry, outfile),
        logLevel: "silent",
      });
      outputs.set(entry.subpath, outfile);
    }
  }, 120_000);

  afterAll(async () => {
    if (outDir) await rm(outDir, { force: true, recursive: true });
  });

  it("inline no CommonJS module that would need a require shim", async () => {
    const shimmed = [];
    for (const [subpath, outfile] of outputs) {
      if ((await readFile(outfile, "utf8")).includes("Dynamic require of")) {
        shimmed.push(subpath);
      }
    }

    expect(shimmed).toEqual([]);
  });

  it("declare the packages they leave external as dependencies", () => {
    const externals = new Set(
      libraryEntries
        .flatMap((entry) => entry.external)
        .filter((name) => !name.endsWith("/*")),
    );

    expect(
      [...externals].filter(
        (name) =>
          dependencies[name] === undefined &&
          peerDependencies[name] === undefined,
      ),
    ).toEqual([]);
  });

  it.each(["./host", "./provider-bridge"])(
    "%s imports under plain Node, as a plugin's own tests load it",
    async (subpath) => {
      const { stdout } = await run(process.execPath, [
        "--input-type=module",
        "-e",
        "const mod = await import(process.argv[1]); console.log(Object.keys(mod).length > 0);",
        pathToFileURL(outputs.get(subpath)).href,
      ]);

      expect(stdout.trim()).toBe("true");
    },
  );
  it("renders public grouping and row hooks through the built facade and harness using one React runtime", async () => {
    const { stdout } = await run(process.execPath, [
      "--input-type=module",
      "-e",
      `
        import { JSDOM } from "jsdom";
        const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
        globalThis.window = dom.window;
        globalThis.document = dom.window.document;
        globalThis.HTMLElement = dom.window.HTMLElement;
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        const React = await import("react");
        const app = await import(process.argv[1]);
        const testing = await import(process.argv[2]);
        testing.installTestPluginRuntime();
        let version;
        const registrations = await testing.loadPluginApp(app.definePluginApp((host) => {
          version = host.experimental_threadListContributionVersion;
          host.slots.experimental_threadListGrouping({ id: "groups", title: "Groups",
            useData: () => app.experimental_usePluginId(),
            projection: ({ data }) => ({ status: "ready", group: { key: data, label: data } }) });
          host.slots.experimental_threadRowDecoration({ id: "label", title: "Label",
            useData: () => app.experimental_usePluginId(),
            item: ({ data, groupingKey }) => ({ avatar: {src: "/avatar.svg", alt: data}, placement: "leading", accessibleLabel: data + ":" + groupingKey }) });
        }));
        function Probe() {
          const groups = app.experimental_useThreadListContributions({ rootThreadIds: ["root"], groupingKey: "fixture/groups" });
          const row = app.experimental_useThreadRowDecorations({ id: "root" }, { groupingKey: "fixture/groups" });
          const group = groups.grouping?.({ id: "root" });
          return React.createElement("output", null, group?.status === "ready" ? group.group?.label + "/" + row[0]?.decoration.accessibleLabel + "/" + row[0]?.decoration.placement + "/" + row[0]?.decoration.text + "/" + version : "loading");
        }
        const slot = testing.renderSlot({ component: Probe }, {}, { experimental_threadListPlugins: [{ pluginId: "fixture", registrations }] });
        await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
        console.log(slot.container.textContent);
        slot.lifecycle.unmount();
        dom.window.close();
      `,
      pathToFileURL(outputs.get("./app")).href,
      pathToFileURL(outputs.get("./testing/app")).href,
    ]);
    expect(stdout.trim()).toBe("fixture/fixture:fixture/groups/leading/null/2");
  });
});
