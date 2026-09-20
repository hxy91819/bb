import { readMigrationFiles } from "drizzle-orm/migrator";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConnection,
  listPublicProjects,
  migrate,
  type DbConnection,
} from "../src/index.js";

function readRecentWorkMigration() {
  const migration = readMigrationFiles({
    migrationsFolder: resolve(import.meta.dirname, "../drizzle"),
  }).find((candidate) =>
    candidate.sql.some((sql) =>
      sql.includes("ADD `recent_explicit_work_sequence`"),
    ),
  );
  if (!migration) throw new Error("Missing recent work migration");
  return migration;
}

const recentWorkMigration = readRecentWorkMigration();

const expectedProjects = [
  { id: "project_null", sequence: null },
  { id: "project_positive", sequence: 42 },
  { id: "project_zero", sequence: 0 },
];

function createLegacyConnection(): DbConnection {
  const db = createConnection(":memory:");
  migrate(db);
  db.$client.exec(`
    INSERT INTO projects (id, name, recent_explicit_work_sequence, created_at, updated_at)
    VALUES ('project_null', 'No activity', NULL, 1, 1),
           ('project_positive', 'Recent activity', 42, 1, 1),
           ('project_zero', 'Zero sequence', 0, 1, 1);
  `);
  db.$client
    .prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?")
    .run(recentWorkMigration.folderMillis);
  db.$client
    .prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    )
    .run(recentWorkMigration.hash, 1789103396292);
  return db;
}

function readProjects(db: DbConnection) {
  return listPublicProjects(db).map((project) => ({
    id: project.id,
    sequence: project.recentExplicitWorkSequence,
  }));
}

describe("recent work migration compatibility", () => {
  it("upgrades the 0.43.0 aggregate without skipping stable plugin metadata", () => {
    const db = createLegacyConnection();
    try {
      db.$client.exec(`
        DROP TABLE thread_plugin_metadata;
        DROP TABLE provider_model_catalogs;
        DROP INDEX threads_lifecycle_owner_idx;
        ALTER TABLE threads DROP COLUMN lifecycle_owner_thread_id;
        ALTER TABLE threads DROP COLUMN storage_deleted_at;
        DROP INDEX project_attachment_threads_thread_idx;
        DROP TABLE project_attachment_threads;
        DROP TABLE project_attachment_backfills;
        DROP TABLE project_attachments;
        DROP INDEX threads_project_id_idx;
        DROP INDEX environment_variables_global_name;
        DROP INDEX environment_variables_project_name;
        DROP TABLE environment_variables;
        DROP TABLE thread_pruning_cursors;
        ALTER TABLE queued_thread_messages DROP COLUMN origin;
        ALTER TABLE queued_thread_messages DROP COLUMN origin_plugin_id;
        ALTER TABLE queued_thread_messages DROP COLUMN requested_by_initiator;
        ALTER TABLE queued_thread_messages DROP COLUMN requested_by_thread_id;
        DELETE FROM __drizzle_migrations WHERE created_at >= 1789175706080;
        INSERT INTO threads (
          id, project_id, provider_id, latest_attention_at,
          service_tier_override, created_at, updated_at
        ) VALUES ('thread_upgrade', 'project_positive', 'codex', 1, 'fast', 1, 1);
      `);
      const migrations = readMigrationFiles({
        migrationsFolder: resolve(import.meta.dirname, "../drizzle"),
      });
      const fastMigration = migrations.find((candidate) =>
        candidate.sql.some((sql) =>
          sql.includes("ADD `service_tier_override`"),
        ),
      );
      if (!fastMigration) throw new Error("Missing Fast migration");
      const insert = db.$client.prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      );
      insert.run(fastMigration.hash, 1789579295571);
      insert.run(recentWorkMigration.hash, 1789579591628);

      migrate(db);
      expect(readProjects(db)).toEqual(expectedProjects);
      expect(
        db.$client
          .prepare(
            "SELECT service_tier_override FROM threads WHERE id = 'thread_upgrade'",
          )
          .get(),
      ).toEqual({ service_tier_override: "fast" });
      db.$client
        .prepare(
          "INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json) VALUES (?, ?, ?)",
        )
        .run("thread_upgrade", "test-plugin", '{"retained":true}');
      migrate(db);
      expect(
        db.$client
          .prepare(
            "SELECT metadata_json FROM thread_plugin_metadata WHERE thread_id = 'thread_upgrade'",
          )
          .get(),
      ).toEqual({ metadata_json: '{"retained":true}' });
    } finally {
      db.$client.close();
    }
  });

  it("preserves project activity when upgrading a previously packaged migration", () => {
    const db = createLegacyConnection();
    try {
      migrate(db);
      expect(readProjects(db)).toEqual(expectedProjects);
      const history = db.$client
        .prepare("SELECT * FROM __drizzle_migrations")
        .all();
      migrate(db);
      expect(readProjects(db)).toEqual(expectedProjects);
      expect(
        db.$client.prepare("SELECT * FROM __drizzle_migrations").all(),
      ).toEqual(history);
    } finally {
      db.$client.close();
    }
  });

  it("restores existing activity after migration failure so startup can retry", () => {
    const db = createLegacyConnection();
    try {
      db.$client.exec(`
        CREATE TRIGGER fail_recent_migration BEFORE INSERT ON __drizzle_migrations
        WHEN NEW.created_at = ${recentWorkMigration.folderMillis}
        BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END;
      `);
      expect(() => migrate(db)).toThrow();
      expect(readProjects(db)).toEqual(expectedProjects);
      db.$client.exec("DROP TRIGGER fail_recent_migration");
      migrate(db);
      expect(readProjects(db)).toEqual(expectedProjects);
    } finally {
      db.$client.close();
    }
  });

  it.each([false, true])(
    "recovers interrupted staging with canonical migration applied=%s",
    (canonicalApplied) => {
      const db = createLegacyConnection();
      try {
        db.$client.exec(`
          ALTER TABLE projects RENAME COLUMN recent_explicit_work_sequence
          TO _bb_recent_explicit_work_sequence_pending;
        `);
        if (canonicalApplied) {
          db.$client.exec(
            "ALTER TABLE projects ADD recent_explicit_work_sequence integer",
          );
          db.$client
            .prepare(
              "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
            )
            .run(recentWorkMigration.hash, recentWorkMigration.folderMillis);
        }
        migrate(db);
        expect(readProjects(db)).toEqual(expectedProjects);
      } finally {
        db.$client.close();
      }
    },
  );
});
