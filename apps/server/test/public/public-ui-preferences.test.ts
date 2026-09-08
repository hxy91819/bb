import { defaultUiPreferences, UI_PREFERENCE_KEYS } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { createThreadSection } from "@bb/db";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function listPreferences(harness: TestAppHarness): Promise<Response> {
  return harness.app.request("/api/v1/preferences/ui");
}

async function putPreference(
  harness: TestAppHarness,
  key: string,
  body: { expectedRevision: number; value: unknown },
): Promise<Response> {
  return harness.app.request(`/api/v1/preferences/ui/${key}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

async function resetPreference(
  harness: TestAppHarness,
  key: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/preferences/ui/${key}`, {
    method: "DELETE",
  });
}

describe("public ui preferences", () => {
  it("lists every registered preference with defaults at revision 0", async () => {
    await withTestHarness(async (harness) => {
      const response = await listPreferences(harness);
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as {
        preferences: Record<string, { revision: number; value: unknown }>;
      };
      expect(Object.keys(body.preferences).sort()).toEqual(
        [...UI_PREFERENCE_KEYS].sort(),
      );
      for (const key of UI_PREFERENCE_KEYS) {
        expect(body.preferences[key]).toEqual({
          revision: 0,
          value: defaultUiPreferences[key],
        });
      }
    });
  });

  it("writes with revision checks, broadcasts, and rejects stale writes", async () => {
    await withTestHarness(async (harness) => {
      const notifySystem = vi.spyOn(harness.hub, "notifySystem");

      const first = await putPreference(harness, "sidebar.organizationMode", {
        expectedRevision: 0,
        value: "machine",
      });
      expect(first.status).toBe(200);
      expect(await readJson(first)).toEqual({
        key: "sidebar.organizationMode",
        revision: 1,
        value: "machine",
      });
      expect(notifySystem).toHaveBeenCalledWith(["ui-preferences-changed"]);

      const stale = await putPreference(harness, "sidebar.organizationMode", {
        expectedRevision: 0,
        value: "chronological",
      });
      expect(stale.status).toBe(409);
      expect(await readJson(stale)).toEqual({
        code: "ui_preference_conflict",
        details: { currentRevision: 1 },
        message: "UI preference changed on another client",
      });
      expect(notifySystem).toHaveBeenCalledTimes(1);

      const listed = (await readJson(await listPreferences(harness))) as {
        preferences: Record<string, { revision: number; value: unknown }>;
      };
      expect(listed.preferences["sidebar.organizationMode"]).toEqual({
        revision: 1,
        value: "machine",
      });
      expect(listed.preferences["sidebar.chronologicalSort"]).toEqual({
        revision: 0,
        value: "updated",
      });
    });
  });

  it("rejects unknown keys and values that fail the preference schema", async () => {
    await withTestHarness(async (harness) => {
      const unknown = await putPreference(harness, "sidebar.nope", {
        expectedRevision: 0,
        value: "x",
      });
      expect(unknown.status).toBe(404);
      expect((await readJson(unknown)) as { code: string }).toMatchObject({
        code: "ui_preference_not_found",
      });

      const invalidEnum = await putPreference(
        harness,
        "sidebar.organizationMode",
        { expectedRevision: 0, value: "by-color" },
      );
      expect(invalidEnum.status).toBe(400);

      const invalidList = await putPreference(
        harness,
        "sidebar.collapsedThreads",
        { expectedRevision: 0, value: ["thr_1", 2] },
      );
      expect(invalidList.status).toBe(400);

      const missingValue = await putPreference(
        harness,
        "sidebar.collapsedThreads",
        { expectedRevision: 0, value: undefined },
      );
      expect(missingValue.status).toBe(400);

      const nullable = await putPreference(
        harness,
        "sidebar.visiblePluginPanels",
        { expectedRevision: 0, value: null },
      );
      expect(nullable.status).toBe(200);

      const unknownReset = await resetPreference(harness, "sidebar.nope");
      expect(unknownReset.status).toBe(404);
    });
  });

  it("resets to the default while advancing the revision", async () => {
    await withTestHarness(async (harness) => {
      await putPreference(harness, "sidebar.sectionOrder", {
        expectedRevision: 0,
        value: ["threads", "pinned", "projects"],
      });
      const reset = await resetPreference(harness, "sidebar.sectionOrder");
      expect(reset.status).toBe(200);
      expect(await readJson(reset)).toEqual({
        key: "sidebar.sectionOrder",
        revision: 2,
        value: ["pinned", "projects", "threads"],
      });

      const stale = await putPreference(harness, "sidebar.sectionOrder", {
        expectedRevision: 1,
        value: ["pinned", "threads", "projects"],
      });
      expect(stale.status).toBe(409);
    });
  });

  it("falls back to the default when a stored value no longer parses", async () => {
    await withTestHarness(async (harness) => {
      harness.db.$client.exec(
        `INSERT INTO ui_preferences (key, value_json, revision, updated_at) VALUES ('sidebar.organizationMode', '"by-color"', 4, 1), ('sidebar.unknownKey', '1', 2, 1)`,
      );
      const listed = (await readJson(await listPreferences(harness))) as {
        preferences: Record<string, { revision: number; value: unknown }>;
      };
      expect(listed.preferences["sidebar.organizationMode"]).toEqual({
        revision: 4,
        value: "project",
      });
      expect(listed.preferences["sidebar.unknownKey"]).toBeUndefined();
    });
  });

  it("drops ids of entities that no longer exist from collapsed lists", async () => {
    await withTestHarness(async (harness) => {
      const { environment, project, thread } = seedThreadFixture(harness);
      const section = createThreadSection(harness.db, harness.hub, {
        name: "Alpha",
      });
      if (section.status !== "created") throw new Error("section not created");
      harness.db.$client
        .prepare("UPDATE threads SET deleted_at = 1 WHERE id = ?")
        .run(thread.id);

      const projects = await putPreference(
        harness,
        "sidebar.collapsedProjects",
        {
          expectedRevision: 0,
          value: [project.id, "proj_gone"],
        },
      );
      expect(await readJson(projects)).toEqual({
        key: "sidebar.collapsedProjects",
        revision: 1,
        value: [project.id],
      });

      const threads = await putPreference(harness, "sidebar.collapsedThreads", {
        expectedRevision: 0,
        value: [thread.id, "thr_gone"],
      });
      expect(await readJson(threads)).toEqual({
        key: "sidebar.collapsedThreads",
        revision: 1,
        value: [],
      });

      const environments = await putPreference(
        harness,
        "sidebar.collapsedEnvironments",
        { expectedRevision: 0, value: ["env_gone", environment.id] },
      );
      expect(await readJson(environments)).toEqual({
        key: "sidebar.collapsedEnvironments",
        revision: 1,
        value: [environment.id],
      });

      const sections = await putPreference(
        harness,
        "sidebar.collapsedThreadSections",
        {
          expectedRevision: 0,
          value: [
            `${project.id}::${section.section.id}`,
            `${project.id}::sec_gone`,
            "legacy-key-without-separator",
          ],
        },
      );
      expect(await readJson(sections)).toEqual({
        key: "sidebar.collapsedThreadSections",
        revision: 1,
        value: [
          `${project.id}::${section.section.id}`,
          "legacy-key-without-separator",
        ],
      });

      const machines = await putPreference(
        harness,
        "sidebar.collapsedMachines",
        {
          expectedRevision: 0,
          value: ["host_gone", "no-machine"],
        },
      );
      expect(await readJson(machines)).toEqual({
        key: "sidebar.collapsedMachines",
        revision: 1,
        value: ["host_gone", "no-machine"],
      });

      const listed = (await readJson(await listPreferences(harness))) as {
        preferences: Record<string, { revision: number; value: unknown }>;
      };
      expect(listed.preferences["sidebar.collapsedProjects"]).toEqual({
        revision: 1,
        value: [project.id],
      });
    });
  });
});
