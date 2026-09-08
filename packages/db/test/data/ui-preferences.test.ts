import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEnvironment,
  createProject,
  createThread,
  createThreadSection,
  getStoredUiPreference,
  listExistingSidebarEntityIds,
  listStoredUiPreferences,
  overwriteStoredUiPreference,
  replaceStoredUiPreference,
  upsertHost,
  type DbConnection,
} from "../../src/index.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

describe("ui preferences data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => {
    db.$client.close();
  });

  it("creates a row at revision 1 only when the expected revision is 0", () => {
    expect(getStoredUiPreference(db, "sidebar.organizationMode")).toBeNull();
    expect(
      replaceStoredUiPreference(db, {
        expectedRevision: 3,
        key: "sidebar.organizationMode",
        valueJson: '"machine"',
      }),
    ).toEqual({ outcome: "conflict", revision: 0 });
    expect(
      replaceStoredUiPreference(db, {
        expectedRevision: 0,
        key: "sidebar.organizationMode",
        valueJson: '"machine"',
      }),
    ).toEqual({ outcome: "updated", revision: 1 });
    expect(getStoredUiPreference(db, "sidebar.organizationMode")).toEqual({
      key: "sidebar.organizationMode",
      revision: 1,
      valueJson: '"machine"',
    });
  });

  it("rejects stale writes and keeps the current value", () => {
    replaceStoredUiPreference(db, {
      expectedRevision: 0,
      key: "sidebar.collapsedProjects",
      valueJson: '["prj_1"]',
    });
    replaceStoredUiPreference(db, {
      expectedRevision: 1,
      key: "sidebar.collapsedProjects",
      valueJson: '["prj_1","prj_2"]',
    });
    expect(
      replaceStoredUiPreference(db, {
        expectedRevision: 1,
        key: "sidebar.collapsedProjects",
        valueJson: "[]",
      }),
    ).toEqual({ outcome: "conflict", revision: 2 });
    expect(getStoredUiPreference(db, "sidebar.collapsedProjects")).toEqual({
      key: "sidebar.collapsedProjects",
      revision: 2,
      valueJson: '["prj_1","prj_2"]',
    });
  });

  it("overwrites without a revision check and still advances the revision", () => {
    expect(
      overwriteStoredUiPreference(db, {
        key: "sidebar.chronologicalSort",
        valueJson: '"alpha"',
      }),
    ).toEqual({ revision: 1 });
    replaceStoredUiPreference(db, {
      expectedRevision: 1,
      key: "sidebar.chronologicalSort",
      valueJson: '"created"',
    });
    expect(
      overwriteStoredUiPreference(db, {
        key: "sidebar.chronologicalSort",
        valueJson: '"updated"',
      }),
    ).toEqual({ revision: 3 });
    expect(listStoredUiPreferences(db)).toEqual([
      {
        key: "sidebar.chronologicalSort",
        revision: 3,
        valueJson: '"updated"',
      },
    ]);
  });

  it("reports only live sidebar entities among the requested ids", () => {
    const host = upsertHost(db, noopNotifier, {
      name: "test-host",
      type: "persistent",
    });
    const { project } = createProject(db, noopNotifier, {
      name: "live",
      source: { type: "local_path", hostId: host.id, path: "/tmp/live" },
    });
    const { project: deletedProject } = createProject(db, noopNotifier, {
      name: "deleted",
      source: { type: "local_path", hostId: host.id, path: "/tmp/deleted" },
    });
    const environment = createEnvironment(db, noopNotifier, {
      hostId: host.id,
      projectId: project.id,
      providerOwnsPath: false,
    });
    const destroyedEnvironment = createEnvironment(db, noopNotifier, {
      hostId: host.id,
      projectId: project.id,
      providerOwnsPath: false,
      path: "/tmp/destroyed",
    });
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const deletedThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const section = createThreadSection(db, noopNotifier, { name: "Alpha" });
    if (section.status !== "created") throw new Error("section not created");
    db.$client
      .prepare("UPDATE projects SET deleted_at = 1 WHERE id = ?")
      .run(deletedProject.id);
    db.$client
      .prepare("UPDATE threads SET deleted_at = 1 WHERE id = ?")
      .run(deletedThread.id);
    db.$client
      .prepare("UPDATE environments SET status = 'destroyed' WHERE id = ?")
      .run(destroyedEnvironment.id);

    expect(
      listExistingSidebarEntityIds(db, {
        environmentIds: [environment.id, destroyedEnvironment.id, "env_nope"],
        projectIds: [project.id, deletedProject.id, "proj_nope"],
        threadIds: [thread.id, deletedThread.id, "thr_nope"],
        threadSectionIds: [section.section.id, "sec_nope"],
      }),
    ).toEqual({
      environmentIds: new Set([environment.id]),
      projectIds: new Set([project.id]),
      threadIds: new Set([thread.id]),
      threadSectionIds: new Set([section.section.id]),
    });
    expect(
      listExistingSidebarEntityIds(db, {
        environmentIds: [],
        projectIds: [],
        threadIds: [],
        threadSectionIds: [],
      }),
    ).toEqual({
      environmentIds: new Set(),
      projectIds: new Set(),
      threadIds: new Set(),
      threadSectionIds: new Set(),
    });
  });
});
