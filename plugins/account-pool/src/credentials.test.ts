import fs from "node:fs/promises";
import path from "node:path";
import { homedir, tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  importCodexCredentials,
  parseCodexCredentials,
} from "./credentials.js";

function token(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("Codex credential import", () => {
  it("reads a linked auth file without changing the link or source", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "bb-pool-credentials-"));
    temporaryDirs.push(dir);
    const source = path.join(dir, "disk-auth.json");
    const link = path.join(dir, "auth.json");
    const raw = JSON.stringify({
      tokens: {
        access_token: token({ exp: 2_000_000_000 }),
        refresh_token: "linked-refresh",
        account_id: "linked-account",
      },
    });
    await fs.writeFile(source, raw);
    await fs.symlink(source, link);
    expect(await importCodexCredentials(link)).toMatchObject({
      accountId: "linked-account",
      refreshToken: "linked-refresh",
    });
    const homeRelativeLink = `~/${path.relative(homedir(), link).split(path.sep).join("/")}`;
    expect(await importCodexCredentials(homeRelativeLink)).toMatchObject({
      accountId: "linked-account",
      refreshToken: "linked-refresh",
    });
    expect(await fs.readlink(link)).toBe(source);
    expect(await fs.readFile(source, "utf8")).toBe(raw);
  });

  it("rejects relative paths rather than resolving against the server working directory", async () => {
    await expect(importCodexCredentials("auth.json")).rejects.toThrow(
      "absolute path or start with ~/",
    );
  });

  it("reports missing, broken-link, and invalid files without exposing their contents", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "bb-pool-credentials-"));
    temporaryDirs.push(dir);
    const missing = path.join(dir, "missing.json");
    const broken = path.join(dir, "broken.json");
    const invalid = path.join(dir, "invalid.json");
    await fs.symlink(missing, broken);
    await fs.writeFile(
      invalid,
      '{"tokens":{"access_token":"private-token","refresh_token":42}}',
    );
    for (const file of [missing, broken, invalid]) {
      await expect(importCodexCredentials(file)).rejects.toThrow(
        "Codex OAuth credentials were not found or usable at the specified auth file on the bb server host.",
      );
    }
  });
  it("reads account identity, email, token material, and access expiry", () => {
    const expiresAtSeconds = 2_000_000_000;
    expect(
      parseCodexCredentials(
        JSON.stringify({
          tokens: {
            access_token: token({ exp: expiresAtSeconds }),
            refresh_token: "refresh-token",
            account_id: "account-123",
            id_token: token({
              "https://api.openai.com/profile": { email: "codex@example.com" },
            }),
          },
          last_refresh: "2026-09-04T00:00:00Z",
        }),
      ),
    ).toEqual({
      accessToken: token({ exp: expiresAtSeconds }),
      refreshToken: "refresh-token",
      idToken: token({
        "https://api.openai.com/profile": { email: "codex@example.com" },
      }),
      accountId: "account-123",
      email: "codex@example.com",
      expiresAt: expiresAtSeconds * 1_000,
    });
  });

  it("rejects credentials that cannot identify the ChatGPT account", () => {
    expect(() =>
      parseCodexCredentials(
        JSON.stringify({
          tokens: {
            access_token: token({ exp: 2_000_000_000 }),
            refresh_token: "refresh-token",
          },
        }),
      ),
    ).toThrow("ChatGPT account id");
  });
});
