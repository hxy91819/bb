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
