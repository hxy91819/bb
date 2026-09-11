import { describe, expect, it } from "vitest";
import {
  getProjectModeSectionOrder,
  type ProjectActivityGroup,
} from "./projectActivityOrder";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";

const groups: ProjectActivityGroup[] = [
  { id: "project:alpha", recentExplicitWorkSequence: null },
  { id: "project:bravo", recentExplicitWorkSequence: null },
  { id: "project:charlie", recentExplicitWorkSequence: null },
  { id: "threads", recentExplicitWorkSequence: null },
];

function recentOrder({
  activityGroups = groups,
  manualOrder = groups.map(({ id }) => id),
  showPinnedSection = false,
}: {
  activityGroups?: ProjectActivityGroup[];
  manualOrder?: SidebarSectionId[];
  showPinnedSection?: boolean;
} = {}) {
  return getProjectModeSectionOrder({
    groups: activityGroups,
    manualOrder,
    orderMode: "recent",
    showPinnedSection,
  });
}

describe("project activity order", () => {
  it("sorts projects by their server promotion sequence", () => {
    expect(
      recentOrder({
        activityGroups: [
          { id: "project:alpha", recentExplicitWorkSequence: 3 },
          { id: "project:bravo", recentExplicitWorkSequence: 7 },
          { id: "project:charlie", recentExplicitWorkSequence: null },
          { id: "threads", recentExplicitWorkSequence: null },
        ],
      }),
    ).toEqual(["project:bravo", "project:alpha", "project:charlie", "threads"]);
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
        activityGroups: [
          { id: "project:alpha", recentExplicitWorkSequence: null },
          { id: "project:bravo", recentExplicitWorkSequence: 4 },
          { id: "project:charlie", recentExplicitWorkSequence: null },
          { id: "threads", recentExplicitWorkSequence: null },
        ],
      }),
    ).toEqual(["project:bravo", "threads", "project:charlie", "project:alpha"]);
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
        activityGroups: [
          { id: "project:alpha", recentExplicitWorkSequence: 5 },
          { id: "project:bravo", recentExplicitWorkSequence: 5 },
          { id: "project:charlie", recentExplicitWorkSequence: null },
          { id: "threads", recentExplicitWorkSequence: null },
        ],
      }),
    ).toEqual(["project:bravo", "project:alpha", "project:charlie", "threads"]);

    expect(
      getProjectModeSectionOrder({
        groups: [
          { id: "project:z", recentExplicitWorkSequence: 5 },
          { id: "project:a", recentExplicitWorkSequence: 5 },
        ],
        manualOrder: [],
        orderMode: "recent",
        showPinnedSection: false,
      }),
    ).toEqual(["project:a", "project:z"]);
  });

  it("keeps pinned content first and promotes the projectless Threads section", () => {
    expect(
      recentOrder({
        activityGroups: [
          { id: "project:alpha", recentExplicitWorkSequence: null },
          { id: "project:bravo", recentExplicitWorkSequence: null },
          { id: "project:charlie", recentExplicitWorkSequence: 7 },
          {
            id: "threads",
            recentExplicitWorkSequence: 8,
          },
        ],
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
        showPinnedSection: true,
      }),
    ).toEqual(manualOrder);
  });

  it("ignores non-positive promotion sequences", () => {
    expect(
      recentOrder({
        activityGroups: [
          { id: "project:alpha", recentExplicitWorkSequence: 0 },
          { id: "project:bravo", recentExplicitWorkSequence: -1 },
          { id: "project:charlie", recentExplicitWorkSequence: 2 },
          { id: "threads", recentExplicitWorkSequence: null },
        ],
      }),
    ).toEqual(["project:charlie", "project:alpha", "project:bravo", "threads"]);
  });
});
