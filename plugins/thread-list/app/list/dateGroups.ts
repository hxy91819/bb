import type { ProjectThreadItem } from "../model/project-thread-groups.js";
import type { ChronologicalSort } from "../../shared/preferences.js";

export function getDateGroupLabels(
  items: readonly ProjectThreadItem[],
  sort: ChronologicalSort,
  now: Date,
): (string | null)[] {
  if (sort === "alpha") return items.map(() => null);
  const field = sort === "created" ? "createdAt" : "updatedAt";
  const calendarDay = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  const today = calendarDay(now);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
  const month = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  });
  let previousBucket: string | null = null;
  return items.map((item) => {
    if (item.kind === "section") return null;
    const thread =
      item.kind === "thread" ? item.node.thread : item.group.nodes[0].thread;
    const date = new Date(thread[field]);
    const daysAgo = today - calendarDay(date);
    const bucket =
      daysAgo <= 0
        ? "today"
        : daysAgo === 1
          ? "yesterday"
          : daysAgo < 7
            ? `day:${calendarDay(date)}`
            : daysAgo < 30
              ? "previous30"
              : `month:${date.getFullYear()}-${date.getMonth()}`;
    const label =
      daysAgo <= 0
        ? "Today"
        : daysAgo === 1
          ? "Yesterday"
          : daysAgo < 7
            ? weekday.format(date)
            : daysAgo < 30
              ? "Previous 30 days"
              : month.format(date);
    if (bucket === previousBucket) return null;
    previousBucket = bucket;
    return label;
  });
}
