import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  createConnection,
  createThread,
  getThread,
  migrate,
  noopNotifier,
} from "../src/index.js";

const migrationTimestamp = 1792125643686;

describe("thread completion notice migration", () => {
  it("keeps existing children linked and notifying, and persists opt-outs on new children", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      const parent = createThread(db, noopNotifier, {
        projectId: PERSONAL_PROJECT_ID,
        providerId: "test-provider",
      });
      const child = createThread(db, noopNotifier, {
        projectId: PERSONAL_PROJECT_ID,
        providerId: "test-provider",
        parentThreadId: parent.id,
      });
      db.$client.exec("ALTER TABLE threads DROP COLUMN completion_notice");
      db.$client
        .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
        .run(migrationTimestamp);
      expect(
        db.$client
          .prepare<[], { createdAt: number }>(
            "SELECT MAX(created_at) AS createdAt FROM __drizzle_migrations",
          )
          .get()?.createdAt,
      ).toBe(1791953791435);

      migrate(db);
      expect(getThread(db, child.id)).toMatchObject({
        completionNotice: true,
        parentThreadId: parent.id,
      });
      const quietChild = createThread(db, noopNotifier, {
        projectId: PERSONAL_PROJECT_ID,
        providerId: "test-provider",
        parentThreadId: parent.id,
        completionNotice: false,
      });
      migrate(db);
      expect(getThread(db, quietChild.id)).toMatchObject({
        completionNotice: false,
        parentThreadId: parent.id,
      });
    } finally {
      db.$client.close();
    }
  });
});
