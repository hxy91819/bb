import { describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { SplitLayout } from "@/lib/split-layout";
import { openThread } from "./thread-navigation";

function initialLayout(threadId = "thread-origin"): SplitLayout {
  return {
    root: {
      type: "pane",
      paneId: "pane-1",
      content: { kind: "thread", projectId: "project-1", threadId },
    },
    focusedPaneId: "pane-1",
  };
}

describe("openThread navigation contract", () => {
  const contractTable = [
    {
      label: "non-split without targeting",
      split: false,
      target: undefined,
      expectedPath: "/projects/project-1/threads/thread-1",
      expectedOptions: undefined,
    },
    {
      label: "non-split with message targeting",
      split: false,
      target: { match: "message" as const, seq: 42 },
      expectedPath: "/projects/project-1/threads/thread-1#msg=42",
      expectedOptions: undefined,
    },
    {
      label: "non-split with search sequence targeting",
      split: false,
      target: { match: "sequence" as const, seq: 42 },
      expectedPath: "/projects/project-1/threads/thread-1",
      expectedOptions: {
        state: { searchMessageSeq: 42, searchThreadId: "thread-1" },
      },
    },
    {
      label: "non-split with search thread targeting without message",
      split: false,
      target: { match: "sequence" as const, seq: null },
      expectedPath: "/projects/project-1/threads/thread-1",
      expectedOptions: {
        state: undefined,
      },
    },
    {
      label: "split without targeting",
      split: true,
      target: undefined,
      expectedPath: "/projects/project-1/threads/thread-1",
      expectedOptions: undefined,
    },
    {
      label: "split with message targeting",
      split: true,
      target: { match: "message" as const, seq: 42 },
      expectedPath: "/projects/project-1/threads/thread-1#msg=42",
      expectedOptions: undefined,
    },
    {
      label: "split with search sequence targeting",
      split: true,
      target: { match: "sequence" as const, seq: 42 },
      expectedPath: "/projects/project-1/threads/thread-1",
      expectedOptions: {
        state: { searchMessageSeq: 42, searchThreadId: "thread-1" },
      },
    },
  ];

  it.each(contractTable)(
    "navigates to expected path and state for $label",
    ({ split, target, expectedPath, expectedOptions }) => {
      const atomValues = new Map<unknown, unknown>();
      if (split) {
        atomValues.set(splitLayoutAtom, initialLayout("thread-origin"));
      }
      const store = {
        get: (atom: unknown) => atomValues.get(atom) ?? null,
        set: (atom: unknown, value: unknown) => {
          atomValues.set(atom, value);
        },
      };
      const navigate = vi.fn();

      openThread({
        store,
        navigate,
        projectId: "project-1",
        threadId: "thread-1",
        isCompact: false,
        split,
        target,
      });

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(expectedPath, expectedOptions);
      expect(
        atomValues.get(getThreadConversationCollapsedAtom("thread-1")),
      ).toBe(false);
    },
  );

  it.each([
    {
      label: "split message targeting when pane is already open",
      target: { match: "message" as const, seq: 7 },
      expectedPath: "/projects/project-1/threads/thread-1#msg=7",
      expectedOptions: { replace: true },
    },
    {
      label: "split search targeting when pane is already open",
      target: { match: "sequence" as const, seq: 7 },
      expectedPath: "/projects/project-1/threads/thread-1",
      expectedOptions: {
        replace: true,
        state: { searchMessageSeq: 7, searchThreadId: "thread-1" },
      },
    },
  ])(
    "preserves replace semantics and targeting for $label",
    ({ target, expectedPath, expectedOptions }) => {
      const atomValues = new Map<unknown, unknown>();
      atomValues.set(splitLayoutAtom, initialLayout("thread-1"));
      const store = {
        get: (atom: unknown) => atomValues.get(atom) ?? null,
        set: (atom: unknown, value: unknown) => {
          atomValues.set(atom, value);
        },
      };
      const navigate = vi.fn();

      openThread({
        store,
        navigate,
        projectId: "project-1",
        threadId: "thread-1",
        isCompact: false,
        split: true,
        target,
      });

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(expectedPath, expectedOptions);
    },
  );

  it.each([
    {
      split: false,
      target: undefined,
      expectedPath: "/threads/thread-1",
      expectedOptions: undefined,
    },
    {
      split: false,
      target: { match: "message" as const, seq: 99 },
      expectedPath: "/threads/thread-1#msg=99",
      expectedOptions: undefined,
    },
    {
      split: true,
      target: { match: "message" as const, seq: 99 },
      expectedPath: "/threads/thread-1#msg=99",
      expectedOptions: undefined,
    },
  ])(
    "navigates projectless threads correctly (split=$split)",
    ({ split, target, expectedPath, expectedOptions }) => {
      const atomValues = new Map<unknown, unknown>();
      if (split) {
        atomValues.set(splitLayoutAtom, {
          root: {
            type: "pane",
            paneId: "pane-1",
            content: {
              kind: "thread",
              projectId: PERSONAL_PROJECT_ID,
              threadId: "thread-origin",
            },
          },
          focusedPaneId: "pane-1",
        });
      }
      const store = {
        get: (atom: unknown) => atomValues.get(atom) ?? null,
        set: (atom: unknown, value: unknown) => {
          atomValues.set(atom, value);
        },
      };
      const navigate = vi.fn();

      openThread({
        store,
        navigate,
        projectId: PERSONAL_PROJECT_ID,
        threadId: "thread-1",
        isCompact: false,
        split,
        target,
      });

      expect(navigate).toHaveBeenCalledWith(expectedPath, expectedOptions);
    },
  );
});
