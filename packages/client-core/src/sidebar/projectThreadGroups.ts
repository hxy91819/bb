import type { ThreadListEntry } from "@bb/domain";
import { compareCodepoint } from "../codepoint-compare.js";

export interface ProjectThreadNode {
  thread: ThreadListEntry;
  children: ProjectThreadItem[];
  depth: number;
}

export type ProjectThreadItem = { kind: "thread"; node: ProjectThreadNode };

export type ThreadComparator = (
  left: ThreadListEntry,
  right: ThreadListEntry,
) => number;

type SidebarProjectThreadShape = Pick<
  ThreadListEntry,
  "originKind" | "visibility"
>;

interface BuildThreadNodeArgs {
  ancestorThreadIds: ReadonlySet<string>;
  childrenByParentId: ReadonlyMap<string, readonly ThreadListEntry[]>;
  compareThreads: ThreadComparator;
  depth: number;
  thread: ThreadListEntry;
  visitedThreadIds: Set<string>;
}

export type StandardThreadSortFields = Pick<
  ThreadListEntry,
  "id" | "status" | "createdAt" | "latestAttentionAt"
>;

export function compareByCreatedAtDescending(
  left: StandardThreadSortFields,
  right: StandardThreadSortFields,
): number {
  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return compareCodepoint(left.id, right.id);
}

function compareByLatestAttentionAtDescending(
  left: StandardThreadSortFields,
  right: StandardThreadSortFields,
): number {
  const latestAttentionAtDelta =
    right.latestAttentionAt - left.latestAttentionAt;
  if (latestAttentionAtDelta !== 0) {
    return latestAttentionAtDelta;
  }

  return compareByCreatedAtDescending(left, right);
}

export function compareStandardThreads(
  left: StandardThreadSortFields,
  right: StandardThreadSortFields,
): number {
  const leftIsActive = left.status === "active";
  const rightIsActive = right.status === "active";

  if (leftIsActive !== rightIsActive) {
    return leftIsActive ? -1 : 1;
  }

  if (leftIsActive) {
    return compareByCreatedAtDescending(left, right);
  }

  return compareByLatestAttentionAtDescending(left, right);
}

function getNodeAndDescendantThreads(
  node: ProjectThreadNode,
): ThreadListEntry[] {
  return [node.thread, ...getProjectThreadItemDescendants(node.children)];
}

export function getProjectThreadItemDescendants(
  items: readonly ProjectThreadItem[],
): ThreadListEntry[] {
  return items.flatMap((item) => getNodeAndDescendantThreads(item.node));
}

function buildThreadItem(node: ProjectThreadNode): ProjectThreadItem {
  return { kind: "thread", node };
}

function buildSortedItems(
  nodes: ProjectThreadNode[],
  compareThreads: ThreadComparator,
): ProjectThreadItem[] {
  nodes.sort((left, right) => compareThreads(left.thread, right.thread));
  return nodes.map(buildThreadItem);
}

function buildThreadNode({
  ancestorThreadIds,
  childrenByParentId,
  compareThreads,
  depth,
  thread,
  visitedThreadIds,
}: BuildThreadNodeArgs): ProjectThreadNode {
  visitedThreadIds.add(thread.id);
  const nextAncestorThreadIds = new Set(ancestorThreadIds);
  nextAncestorThreadIds.add(thread.id);
  const childNodes: ProjectThreadNode[] = [];

  for (const childThread of childrenByParentId.get(thread.id) ?? []) {
    if (nextAncestorThreadIds.has(childThread.id)) continue;
    if (visitedThreadIds.has(childThread.id)) continue;

    childNodes.push(
      buildThreadNode({
        ancestorThreadIds: nextAncestorThreadIds,
        childrenByParentId,
        compareThreads,
        depth: depth + 1,
        thread: childThread,
        visitedThreadIds,
      }),
    );
  }

  const children = buildSortedItems(childNodes, compareThreads);
  return { thread, children, depth };
}

function isRootThread(
  thread: ThreadListEntry,
  projectThreadIds: ReadonlySet<string>,
): boolean {
  return (
    thread.parentThreadId === null ||
    !projectThreadIds.has(thread.parentThreadId)
  );
}

export function buildChronologicalThreadList(
  allThreads: readonly ThreadListEntry[],
  compareThreads: ThreadComparator,
): ProjectThreadItem[] {
  const projectThreads = allThreads.filter(isSidebarProjectThread);
  const projectThreadIds = new Set(projectThreads.map((thread) => thread.id));
  const childrenByParentId = new Map<string, ThreadListEntry[]>();

  for (const thread of projectThreads) {
    if (thread.parentThreadId === null) continue;
    if (!projectThreadIds.has(thread.parentThreadId)) continue;

    const children = childrenByParentId.get(thread.parentThreadId);
    if (children) {
      children.push(thread);
    } else {
      childrenByParentId.set(thread.parentThreadId, [thread]);
    }
  }

  const visitedThreadIds = new Set<string>();
  const rootNodes: ProjectThreadNode[] = [];

  for (const thread of projectThreads) {
    if (!isRootThread(thread, projectThreadIds)) continue;
    if (visitedThreadIds.has(thread.id)) continue;

    rootNodes.push(
      buildThreadNode({
        ancestorThreadIds: new Set(),
        childrenByParentId,
        compareThreads,
        depth: 0,
        thread,
        visitedThreadIds,
      }),
    );
  }

  for (const thread of projectThreads) {
    if (visitedThreadIds.has(thread.id)) continue;

    rootNodes.push(
      buildThreadNode({
        ancestorThreadIds: new Set(),
        childrenByParentId,
        compareThreads,
        depth: 0,
        thread,
        visitedThreadIds,
      }),
    );
  }

  return buildSortedItems(rootNodes, compareThreads);
}

export function isSidebarProjectThread(
  thread: SidebarProjectThreadShape,
): boolean {
  return thread.visibility !== "hidden";
}
