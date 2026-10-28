import { describe, expect, it } from "vitest";
import {
  createConnection,
  createProject,
  createThread,
  getThreadPluginMetadata,
  migrate,
  noopNotifier,
  upsertHost,
} from "../src/index.js";

describe("initial thread metadata transaction", () => {
  it.each([false, true])(
    "publishes complete metadata only after commit; second insert failure=%s",
    (fail) => {
      const db = createConnection(":memory:");
      try {
        migrate(db);
        const host = upsertHost(db, noopNotifier, { name: "Test" });
        const { project } = createProject(db, noopNotifier, {
          name: "Test",
          source: {
            type: "local_path",
            hostId: host.id,
            path: "/tmp/creation-metadata",
          },
        });
        if (fail)
          db.$client.exec(
            "CREATE TRIGGER reject_second_namespace BEFORE INSERT ON thread_plugin_metadata WHEN NEW.plugin_id = 'second' BEGIN SELECT RAISE(ABORT, 'second namespace failed'); END",
          );
        const observations: object[] = [];
        const create = () =>
          createThread(
            db,
            {
              ...noopNotifier,
              notifyThread(id) {
                observations.push({
                  first: getThreadPluginMetadata(db, id, "first").metadata,
                  second: getThreadPluginMetadata(db, id, "second").metadata,
                });
              },
            },
            {
              projectId: project.id,
              providerId: "codex",
              initialPluginMetadata: [
                { pluginId: "first", metadata: { memberId: "A" } },
                { pluginId: "second", metadata: { issue: "42" } },
              ],
            },
          );
        if (fail) {
          expect(create).toThrow("second namespace failed");
          expect(
            db.$client.prepare("SELECT COUNT(*) AS count FROM threads").get(),
          ).toEqual({ count: 0 });
          expect(
            db.$client
              .prepare("SELECT COUNT(*) AS count FROM thread_plugin_metadata")
              .get(),
          ).toEqual({ count: 0 });
          expect(observations).toEqual([]);
        } else {
          create();
          expect(observations).toEqual([
            { first: { memberId: "A" }, second: { issue: "42" } },
          ]);
        }
      } finally {
        db.$client.close();
      }
    },
  );
});
