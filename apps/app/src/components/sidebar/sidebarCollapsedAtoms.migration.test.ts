// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("sidebar section preference migration", () => {
  it("preserves manual order and collapsed groups from folder-era storage", async () => {
    window.localStorage.setItem(
      "bb.sidebar.folderSectionOrder",
      JSON.stringify(["threads", "folder:release", "folders", "pinned"]),
    );
    window.localStorage.setItem(
      "bb.sidebar.collapsedFolders",
      JSON.stringify(["project-a::fld_release"]),
    );

    const {
      sidebarCollapsedThreadSectionsAtom,
      sidebarManualSectionOrderAtom,
    } = await import("./sidebarCollapsedAtoms");
    const store = createStore();

    expect(store.get(sidebarManualSectionOrderAtom)).toEqual([
      "threads",
      "section:release",
      "sections",
      "pinned",
    ]);
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "project-a::fld_release",
    ]);
    expect(window.localStorage.getItem("bb.sidebar.manualSectionOrder")).toBe(
      JSON.stringify(["threads", "section:release", "sections", "pinned"]),
    );
    expect(
      window.localStorage.getItem("bb.sidebar.collapsedThreadSections"),
    ).toBe(JSON.stringify(["project-a::fld_release"]));
    expect(
      window.localStorage.getItem("bb.sidebar.folderSectionOrder"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("bb.sidebar.collapsedFolders"),
    ).toBeNull();
  });

  it("restores and advances versioned recent-activity promotions", async () => {
    window.localStorage.setItem(
      "bb.sidebar.projectActivityPromotions",
      JSON.stringify({
        promotions: { "project-existing": 4 },
        sequence: 4,
        version: 1,
      }),
    );

    const {
      promoteSidebarProjectActivityAtom,
      sidebarProjectActivityPromotionsAtom,
    } = await import("./sidebarCollapsedAtoms");
    const store = createStore();

    expect(store.get(sidebarProjectActivityPromotionsAtom)).toEqual({
      promotions: { "project-existing": 4 },
      sequence: 4,
      version: 1,
    });

    store.set(promoteSidebarProjectActivityAtom, "project-next");

    expect(store.get(sidebarProjectActivityPromotionsAtom)).toEqual({
      promotions: { "project-existing": 4, "project-next": 5 },
      sequence: 5,
      version: 1,
    });
    expect(
      JSON.parse(
        window.localStorage.getItem("bb.sidebar.projectActivityPromotions") ??
          "",
      ),
    ).toEqual({
      promotions: { "project-existing": 4, "project-next": 5 },
      sequence: 5,
      version: 1,
    });
  });

  it("ignores malformed recent-activity promotions", async () => {
    window.localStorage.setItem(
      "bb.sidebar.projectActivityPromotions",
      JSON.stringify({ promotions: { "project-a": -1 }, sequence: 1 }),
    );

    const { sidebarProjectActivityPromotionsAtom } = await import(
      "./sidebarCollapsedAtoms"
    );
    const store = createStore();

    expect(store.get(sidebarProjectActivityPromotionsAtom)).toEqual({
      promotions: {},
      sequence: 0,
      version: 1,
    });
  });
});
