import { describe, expect, it, vi } from "vitest";
import {
  buildSectionThreadList,
  type ProjectThreadItem,
} from "../model/project-thread-groups.js";
import {
  makeSidebarEnvironment,
  makeSidebarThread,
} from "../model/fixtures.js";
import { getDateGroupLabels } from "./dateGroups.js";

function itemsAt(...dates: Date[]): ProjectThreadItem[] {
  return buildSectionThreadList(
    dates.map((date, index) =>
      makeSidebarThread({
        id: `thr_${index}`,
        createdAt: date.getTime(),
        updatedAt: date.getTime(),
      }),
    ),
    () => 0,
    [],
    new Set(),
    false,
  );
}

describe("date groups", () => {
  it("counts local calendar days across daylight saving transitions", () => {
    vi.stubEnv("TZ", "America/New_York");
    try {
      expect(
        getDateGroupLabels(
          itemsAt(new Date(2026, 10, 1, 0)),
          "updated",
          new Date(2026, 10, 2, 0, 30),
        ),
      ).toEqual(["Yesterday"]);
      expect(
        getDateGroupLabels(
          itemsAt(new Date(2026, 2, 7, 23, 59)),
          "updated",
          new Date(2026, 2, 9, 0, 30),
        ),
      ).toEqual([
        new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
          new Date(2026, 2, 7),
        ),
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses local midnight rather than elapsed 24-hour periods", () => {
    const items = itemsAt(
      new Date(2026, 9, 1, 0),
      new Date(2026, 8, 30, 23, 59, 59, 999),
    );
    expect(
      getDateGroupLabels(items, "updated", new Date(2026, 9, 1, 0, 0, 1)),
    ).toEqual(["Today", "Yesterday"]);
    expect(
      getDateGroupLabels(items, "updated", new Date(2026, 9, 2, 0)),
    ).toEqual([
      "Yesterday",
      new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
        new Date(2026, 8, 30),
      ),
    ]);
  });

  it("labels both sides of the 2, 7, and 30-day boundaries and keeps same-month buckets distinct", () => {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
    const month = new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
    });
    const now = new Date(2026, 9, 31, 12);
    const items = itemsAt(
      new Date(2026, 9, 31),
      new Date(2026, 9, 31, 9),
      new Date(2026, 9, 30),
      new Date(2026, 9, 29),
      new Date(2026, 9, 25),
      new Date(2026, 9, 24),
      new Date(2026, 9, 2),
      new Date(2026, 9, 1),
      new Date(2026, 8, 30),
      new Date(2026, 8, 1),
      new Date(2025, 8, 1),
    );
    expect(getDateGroupLabels(items, "updated", now)).toEqual([
      "Today",
      null,
      "Yesterday",
      weekday.format(new Date(2026, 9, 29)),
      weekday.format(new Date(2026, 9, 25)),
      "Previous 30 days",
      null,
      month.format(new Date(2026, 9, 1)),
      month.format(new Date(2026, 8, 1)),
      null,
      month.format(new Date(2025, 8, 1)),
    ]);
    expect(getDateGroupLabels([...items].reverse(), "updated", now)).toEqual([
      month.format(new Date(2025, 8, 1)),
      month.format(new Date(2026, 8, 1)),
      null,
      month.format(new Date(2026, 9, 1)),
      "Previous 30 days",
      null,
      weekday.format(new Date(2026, 9, 25)),
      weekday.format(new Date(2026, 9, 29)),
      "Yesterday",
      "Today",
      null,
    ]);
  });

  it("follows the sort field, not archive status, and omits alphabetical headings", () => {
    const items = buildSectionThreadList(
      [
        makeSidebarThread({
          id: "thr_a",
          createdAt: new Date(2025, 11, 1).getTime(),
          updatedAt: new Date(2026, 0, 10).getTime(),
        }),
        makeSidebarThread({
          id: "thr_b",
          createdAt: new Date(2025, 11, 2).getTime(),
          updatedAt: new Date(2026, 0, 10).getTime(),
          archivedAt: 1,
        }),
      ],
      () => 0,
      [],
      new Set(),
      false,
    );
    const now = new Date(2026, 0, 10, 12);
    expect(getDateGroupLabels(items, "updated", now)).toEqual(["Today", null]);
    expect(getDateGroupLabels(items, "created", now)).toEqual([
      new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric",
      }).format(new Date(2025, 11, 1)),
      null,
    ]);
    expect(getDateGroupLabels(items, "alpha", now)).toEqual([null, null]);
  });

  it("keeps descendants and environment siblings under the root representative's date", () => {
    const old = new Date(2025, 11, 1).getTime();
    const recent = new Date(2026, 0, 10).getTime();
    const items = buildSectionThreadList(
      [
        makeSidebarThread({ id: "thr_parent", updatedAt: old }),
        makeSidebarThread({
          id: "thr_child",
          parentThreadId: "thr_parent",
          updatedAt: recent,
        }),
        makeSidebarThread({
          id: "thr_env_a",
          environment: makeSidebarEnvironment({
            id: "env_a",
            isWorktree: true,
          }),
          updatedAt: old,
        }),
        makeSidebarThread({
          id: "thr_env_b",
          environment: makeSidebarEnvironment({
            id: "env_a",
            isWorktree: true,
          }),
          updatedAt: recent,
        }),
      ],
      () => 0,
      [],
      new Set(),
      true,
    );
    expect(items.map((item) => item.kind)).toEqual(["thread", "environment"]);
    expect(getDateGroupLabels(items, "updated", new Date(2026, 0, 10))).toEqual(
      [
        new Intl.DateTimeFormat(undefined, {
          month: "long",
          year: "numeric",
        }).format(new Date(2025, 11, 1)),
        null,
      ],
    );
  });
});
