import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { resolveSidebarNewThreadProjectId } from "../src/sidebar/newThreadProject.js";

const threads = [
  makeThreadListEntry({
    id: "older",
    projectId: "project_older",
    status: "active",
    createdAt: 1,
  }),
  makeThreadListEntry({
    id: "latest",
    projectId: "project_latest",
    status: "active",
    createdAt: 2,
  }),
  makeThreadListEntry({
    id: "personal",
    projectId: PERSONAL_PROJECT_ID,
    status: "active",
    createdAt: 3,
  }),
];

describe("sidebar new-thread project", () => {
  it("uses the current route before recent activity", () => {
    expect(
      resolveSidebarNewThreadProjectId({
        recentThreads: threads,
        rememberedProjectId: "project_remembered",
        routeProjectId: "project_current",
      }),
    ).toBe("project_current");
  });

  it("uses the latest named project when the route has no project", () => {
    expect(
      resolveSidebarNewThreadProjectId({
        recentThreads: threads,
        rememberedProjectId: "project_remembered",
        routeProjectId: null,
      }),
    ).toBe("project_latest");
    expect(threads.map((thread) => thread.id)).toEqual([
      "older",
      "latest",
      "personal",
    ]);
  });

  it("preserves the remembered choice without a named recent thread", () => {
    expect(
      resolveSidebarNewThreadProjectId({
        recentThreads: [threads[2]!],
        rememberedProjectId: "project_remembered",
        routeProjectId: undefined,
      }),
    ).toBe("project_remembered");
  });
});
