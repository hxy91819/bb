import { compareCodepoint } from "@bb/client-core";
import {
  type SidebarProjectActivityPromotions,
  type SidebarProjectOrder,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";

export interface ProjectActivityGroup {
  id: SidebarSectionId;
  projectId: string;
}

interface GetProjectModeSectionOrderArgs {
  groups: readonly ProjectActivityGroup[];
  manualOrder: readonly SidebarSectionId[];
  orderMode: SidebarProjectOrder;
  promotions: SidebarProjectActivityPromotions["promotions"];
  showPinnedSection: boolean;
}

interface RankedProjectActivityGroup {
  group: ProjectActivityGroup;
  manualPosition: number;
  promotionSequence: number | null;
}

function getPromotionSequence(
  promotions: SidebarProjectActivityPromotions["promotions"],
  projectId: string,
): number | null {
  const sequence = promotions[projectId];
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

export function getProjectModeSectionOrder({
  groups,
  manualOrder,
  orderMode,
  promotions,
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
    promotionSequence: getPromotionSequence(promotions, group.projectId),
  }));

  rankedGroups.sort((left, right) => {
    if (
      left.promotionSequence !== null &&
      right.promotionSequence !== null
    ) {
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
