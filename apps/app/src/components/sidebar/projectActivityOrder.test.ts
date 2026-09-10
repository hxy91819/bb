import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { getProjectModeSectionOrder } from "./projectActivityOrder";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";

const groups = [
  { id: "project:alpha" as const, projectId: "alpha" },
  { id: "project:bravo" as const, projectId: "bravo" },
  { id: "project:charlie" as const, projectId: "charlie" },
  { id: "threads" as const, projectId: PERSONAL_PROJECT_ID },
];

function recentOrder({
  manualOrder = groups.map(({ id }) => id),
  promotions = {},
  showPinnedSection = false,
}: {
  manualOrder?: SidebarSectionId[];
  promotions?: Record<string, number>;
  showPinnedSection?: boolean;
} = {}) {
  return getProjectModeSectionOrder({
    groups,
    manualOrder,
    orderMode: "recent",
    promotions,
    showPinnedSection,
  });
}

describe("project activity order", () => {
  it("sorts recently initiated projects by their browser-local promotion sequence", () => {
    expect(
      recentOrder({
        promotions: { alpha: 3, bravo: 7 },
      }),
    ).toEqual([
      "project:bravo",
      "project:alpha",
      "project:charlie",
      "threads",
    ]);
  });

  it("uses saved drag order for every unpromoted project", () => {
    expect(
      recentOrder({
        manualOrder: [
          "threads",
          "project:charlie",
          "project:alpha",
          "project:bravo",
        ],
        promotions: { bravo: 4 },
      }),
    ).toEqual([
      "project:bravo",
      "threads",
      "project:charlie",
      "project:alpha",
    ]);
  });

  it("uses manual order and codepoint order as stable promotion ties", () => {
    expect(
      recentOrder({
        manualOrder: [
          "project:bravo",
          "project:alpha",
          "project:charlie",
          "threads",
        ],
        promotions: { alpha: 5, bravo: 5 },
      }),
    ).toEqual([
      "project:bravo",
      "project:alpha",
      "project:charlie",
      "threads",
    ]);

    expect(
      getProjectModeSectionOrder({
        groups: [
          { id: "project:z" as const, projectId: "z" },
          { id: "project:a" as const, projectId: "a" },
        ],
        manualOrder: [],
        orderMode: "recent",
        promotions: { a: 5, z: 5 },
        showPinnedSection: false,
      }),
    ).toEqual(["project:a", "project:z"]);
  });

  it("keeps pinned content first and promotes the projectless Threads section", () => {
    expect(
      recentOrder({
        promotions: { [PERSONAL_PROJECT_ID]: 8, charlie: 7 },
        showPinnedSection: true,
      }),
    ).toEqual([
      "pinned",
      "threads",
      "project:charlie",
      "project:alpha",
      "project:bravo",
    ]);
  });

  it("preserves drag order unchanged outside Recent activity", () => {
    const manualOrder: SidebarSectionId[] = [
      "threads",
      "project:bravo",
      "pinned",
      "project:alpha",
    ];

    expect(
      getProjectModeSectionOrder({
        groups,
        manualOrder,
        orderMode: "manual",
        promotions: { alpha: 9 },
        showPinnedSection: true,
      }),
    ).toEqual(manualOrder);
  });
});
