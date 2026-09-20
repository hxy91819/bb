import { compareCodepoint } from "@bb/client-core";
import type { SidebarProjectOrder } from "@bb/domain";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";

export interface ProjectActivityGroup {
  id: SidebarSectionId;
  recentExplicitWorkSequence: number | null;
}

interface GetProjectModeSectionOrderArgs {
  groups: readonly ProjectActivityGroup[];
  manualOrder: readonly SidebarSectionId[];
  orderMode: SidebarProjectOrder;
  showPinnedSection: boolean;
}

interface RankedProjectActivityGroup {
  group: ProjectActivityGroup;
  manualPosition: number;
  promotionSequence: number | null;
}

function getPromotionSequence(sequence: number | null): number | null {
  return sequence !== null && Number.isSafeInteger(sequence) && sequence > 0
    ? sequence
    : null;
}

export function getProjectModeSectionOrder({
  groups,
  manualOrder,
  orderMode,
  showPinnedSection,
}: GetProjectModeSectionOrderArgs): SidebarSectionId[] {
  if (orderMode === "manual") {
    return [...manualOrder];
  }

  const manualPositions = new Map(
    manualOrder.map((sectionId, index) => [sectionId, index]),
  );
  const rankedGroups: RankedProjectActivityGroup[] = groups.map((group) => ({
    group,
    manualPosition: manualPositions.get(group.id) ?? Number.POSITIVE_INFINITY,
    promotionSequence: getPromotionSequence(group.recentExplicitWorkSequence),
  }));

  rankedGroups.sort((left, right) => {
    if (left.promotionSequence !== null && right.promotionSequence !== null) {
      if (left.promotionSequence !== right.promotionSequence) {
        return right.promotionSequence - left.promotionSequence;
      }
    } else if (left.promotionSequence !== null) {
      return -1;
    } else if (right.promotionSequence !== null) {
      return 1;
    }

    if (left.manualPosition !== right.manualPosition) {
      return left.manualPosition - right.manualPosition;
    }
    return compareCodepoint(left.group.id, right.group.id);
  });

  return [
    ...(showPinnedSection ? (["pinned"] as const) : []),
    ...rankedGroups.map(({ group }) => group.id),
  ];
}
