import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

const require = createRequire(__filename);
const easDirectory = dirname(require.resolve("eas-cli/package.json"));
const projectFiles: {
  generateAppConfigAsync(
    directory: string,
    app: {
      id: string;
      name: string;
      slug: string;
      ownerAccount: { name: string };
    },
  ): Promise<void>;
} = require(join(easDirectory, "build/commandUtils/new/projectFiles.js"));

it("generates EAS app configuration while retaining template settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-eas-project-"));
  const path = join(directory, "app.json");
  try {
    await writeFile(
      path,
      JSON.stringify({
        expo: {
          extra: { preserved: "fixture" },
          ios: { supportsTablet: true },
        },
      }),
    );
    await projectFiles.generateAppConfigAsync(directory, {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Mobile fixture",
      slug: "mobile-app",
      ownerAccount: { name: "example" },
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      expo: {
        name: "Mobile fixture",
        slug: "mobile-app",
        owner: "example",
        extra: {
          preserved: "fixture",
          eas: { projectId: "00000000-0000-4000-8000-000000000001" },
        },
        ios: {
          supportsTablet: true,
          bundleIdentifier: "com.example.mobileapp",
        },
        android: { package: "com.example.mobileapp" },
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
