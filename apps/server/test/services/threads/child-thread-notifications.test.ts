import { describe, expect, it } from "vitest";
import {
  buildChildThreadNeedsAttentionInput,
  buildChildThreadTurnStatusBatchInput,
  summarizeChildThreadTurnAuthor,
  type ChildThreadNotificationSource,
  type ChildThreadTurnNotificationBatchItem,
} from "../../../src/services/threads/child-thread-notifications.js";

interface TestThreadArgs {
  id: string;
  title: string | null;
}

function testThread(args: TestThreadArgs): ChildThreadNotificationSource {
  return {
    id: args.id,
    projectId: "proj_alpha",
    title: args.title,
  };
}

function renderBatchMessage(args: {
  items: ChildThreadTurnNotificationBatchItem[];
}): string {
  const [input] = buildChildThreadTurnStatusBatchInput(args);
  if (!input || input.type !== "text") {
    throw new Error("Expected one text input");
  }
  return input.text;
}

describe("child thread notifications", () => {
  it("treats a spawn as parent input even when its persisted initiator is user", () => {
    expect(
      summarizeChildThreadTurnAuthor(
        [
          {
            source: "spawn",
            initiator: "user",
            senderThreadId: null,
            input: [{ type: "text", text: "Investigate only.", mentions: [] }],
          },
        ],
        "thr_parent",
      ),
    ).toEqual({
      hasDirectUserInput: false,
      hasParentInput: true,
      hasOtherAgentInput: false,
      userInputExcerpt: null,
    });
  });

  it("retains both authors and ordered user text after a parent tell and user steers", () => {
    expect(
      summarizeChildThreadTurnAuthor(
        [
          {
            source: "tell",
            initiator: "agent",
            senderThreadId: "thr_parent",
            input: [{ type: "text", text: "Investigate only.", mentions: [] }],
          },
          {
            source: "tell",
            initiator: "user",
            senderThreadId: null,
            input: [{ type: "text", text: "You may delete.", mentions: [] }],
          },
          {
            source: "tell",
            initiator: "user",
            senderThreadId: null,
            input: [{ type: "text", text: "Include backups.", mentions: [] }],
          },
        ],
        "thr_parent",
      ),
    ).toEqual({
      hasDirectUserInput: true,
      hasParentInput: true,
      hasOtherAgentInput: false,
      userInputExcerpt: "You may delete.\n\nInclude backups.",
    });
  });

  it("explains direct user input before a completed output and guides the parent afterward", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({ id: "thr_child", title: "Cleanup" }),
          terminalOutput: "Deleted the old files.",
          turnStatus: "completed",
          author: {
            hasDirectUserInput: true,
            hasParentInput: true,
            hasOtherAgentInput: false,
            userInputExcerpt: "You may delete the old files.",
          },
        },
      ],
    });

    expect(message).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child completed:",
        "",
        "This turn included input from the user directly in this thread; you did not initiate that input.",
        "",
        "User message:",
        "You may delete the old files.",
        "",
        "Deleted the old files.",
        "",
        "The user's direct instructions to this thread take precedence over your earlier instructions. Review the thread before sending corrective, stop, or reassignment instructions.",
      ].join("\n"),
    );
  });

  it("preserves the original completed text for a parent initiated turn", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({ id: "thr_child", title: "Cleanup" }),
          terminalOutput: "Read the old files.",
          turnStatus: "completed",
          author: {
            hasDirectUserInput: false,
            hasParentInput: true,
            hasOtherAgentInput: false,
            userInputExcerpt: null,
          },
        },
      ],
    });

    expect(message).toBe(
      "[bb system]\n\n@thread:thr_child completed:\n\nRead the old files.",
    );
  });

  it("marks direct user input in a batch and adds one parent instruction", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({ id: "thr_child_one", title: "Cleanup" }),
          terminalOutput: "Deleted the old files.",
          turnStatus: "completed",
          author: {
            hasDirectUserInput: true,
            hasParentInput: false,
            hasOtherAgentInput: false,
            userInputExcerpt: "Delete the old files.",
          },
        },
        {
          activeWorkflowCount: 0,
          childThread: testThread({ id: "thr_child_two", title: "Review" }),
          terminalOutput: "Reviewed.",
          turnStatus: "completed",
          author: null,
        },
      ],
    });

    expect(message).toBe(
      [
        "[bb system]",
        "",
        "Child thread updates:",
        "",
        "- @thread:thr_child_one completed (turn included direct user input).",
        "- @thread:thr_child_two completed.",
        "",
        "The user's direct instructions to those threads take precedence over your earlier instructions. Review each affected thread before sending corrective, stop, or reassignment instructions.",
      ].join("\n"),
    );
  });

  it("leaves author wording out when provenance is unavailable", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({ id: "thr_child", title: "Cleanup" }),
          terminalOutput: null,
          turnStatus: "failed",
          author: null,
        },
      ],
    });
    expect(message).toBe(
      "[bb system]\n\n@thread:thr_child failed.\n\nReview the thread before deciding next steps.",
    );
  });

  it.each(["failed", "interrupted"] as const)(
    "identifies direct user input for a %s turn without repeating the excerpt",
    (turnStatus) => {
      const message = renderBatchMessage({
        items: [
          {
            activeWorkflowCount: 0,
            childThread: testThread({ id: "thr_child", title: "Cleanup" }),
            terminalOutput: null,
            turnStatus,
            author: {
              hasDirectUserInput: true,
              hasParentInput: false,
              hasOtherAgentInput: false,
              userInputExcerpt: "Delete the old files.",
            },
          },
        ],
      });
      expect(message).toContain(
        "This turn included input from the user directly in this thread; you did not initiate that input.",
      );
      expect(message).toContain(
        "Review the thread before sending corrective, stop, or reassignment instructions.",
      );
      expect(message).not.toContain("Delete the old files.");
    },
  );

  it("keeps final output for a single completed outcome", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child",
            title: "Fix checkout flow",
          }),
          terminalOutput: "Implemented the requested change.",
          turnStatus: "completed",
          author: null,
        },
      ],
    });

    expect(message).toContain(
      [
        "@thread:thr_child completed:",
        "",
        "Implemented the requested change.",
      ].join("\n"),
    );
    expect(message).not.toContain("Child thread updates:");
  });

  it("omits output for a single failed outcome", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child",
            title: "Patch deploy script",
          }),
          terminalOutput: "Deploy script failed on preflight.",
          turnStatus: "failed",
          author: null,
        },
      ],
    });

    expect(message).toContain(
      [
        "@thread:thr_child failed.",
        "",
        "Review the thread before deciding next steps.",
      ].join("\n"),
    );
    expect(message).not.toContain("Deploy script failed on preflight.");
  });

  it("omits output and preserves manual-stop safety guidance for a single interrupted outcome", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child",
            title: "Fix checkout flow",
          }),
          terminalOutput: "Stopped after writing the checkout summary.",
          turnStatus: "interrupted",
          author: null,
        },
      ],
    });

    expect(message).toContain(
      [
        "@thread:thr_child was interrupted.",
        "",
        "Review the thread before deciding next steps.",
        "",
        "If the user stopped it manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.",
      ].join("\n"),
    );
    expect(message).not.toContain("Child thread updates:");
    expect(message).not.toContain(
      "Stopped after writing the checkout summary.",
    );
  });

  it("renders multiple child outcomes as status-only bullet lines", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child_one",
            title: "Fix checkout flow",
          }),
          terminalOutput: "Checkout flow is fixed.",
          turnStatus: "completed",
          author: null,
        },
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child_two",
            title: "Patch deploy script",
          }),
          terminalOutput: "Deploy script failed on preflight.",
          turnStatus: "failed",
          author: null,
        },
      ],
    });

    expect(message).toContain(
      [
        "[bb system]",
        "",
        "Child thread updates:",
        "",
        "- @thread:thr_child_one completed.",
        "- @thread:thr_child_two failed.",
      ].join("\n"),
    );
    expect(message).not.toContain("Checkout flow is fixed.");
    expect(message).not.toContain("Deploy script failed on preflight.");
  });

  it("builds mention ranges for batched outcome thread references", () => {
    const input = buildChildThreadTurnStatusBatchInput({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child_one",
            title: "Fix checkout flow",
          }),
          terminalOutput: "Checkout flow is fixed.",
          turnStatus: "completed",
          author: null,
        },
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child_two",
            title: null,
          }),
          terminalOutput: "Deploy script failed.",
          turnStatus: "failed",
          author: null,
        },
      ],
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }
    expect(textInput).toEqual({
      type: "text",
      text: expect.stringContaining("@thread:thr_child_one"),
      mentions: [
        {
          start: expect.any(Number),
          end: expect.any(Number),
          resource: {
            kind: "thread",
            label: "Fix checkout flow",
            projectId: "proj_alpha",
            threadId: "thr_child_one",
          },
        },
        {
          start: expect.any(Number),
          end: expect.any(Number),
          resource: {
            kind: "thread",
            label: "thr_child_two",
            projectId: "proj_alpha",
            threadId: "thr_child_two",
          },
        },
      ],
    });
    expect(textInput.text).toContain("@thread:thr_child_two");
    expect(textInput.text).toContain("Child thread updates:");
    expect(
      textInput.mentions.map((mention) =>
        textInput.text.slice(mention.start, mention.end),
      ),
    ).toEqual(["@thread:thr_child_one", "@thread:thr_child_two"]);
  });

  it("does not render raw title suffixes next to rich thread mentions", () => {
    const nestedToken = "@thread:thr_child_two";
    const input = buildChildThreadTurnStatusBatchInput({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child_one",
            title: `Title mentions ${nestedToken}`,
          }),
          terminalOutput: "Checkout flow is fixed.",
          turnStatus: "completed",
          author: null,
        },
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child_two",
            title: "Second thread",
          }),
          terminalOutput: "Deploy script failed.",
          turnStatus: "failed",
          author: null,
        },
      ],
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }

    const secondLineTokenStart = textInput.text.lastIndexOf(nestedToken);
    expect(textInput.text).not.toContain("Title mentions");
    expect(textInput.mentions.map((mention) => mention.start)).toEqual([
      textInput.text.indexOf("@thread:thr_child_one"),
      secondLineTokenStart,
    ]);
    expect(
      textInput.mentions.map((mention) =>
        textInput.text.slice(mention.start, mention.end),
      ),
    ).toEqual(["@thread:thr_child_one", nestedToken]);
  });

  it("renders a final output fallback for a completed child without output", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child",
            title: "Patch deploy script",
          }),
          terminalOutput: null,
          turnStatus: "completed",
          author: null,
        },
      ],
    });

    expect(message).toContain(
      [
        "@thread:thr_child completed:",
        "",
        "No final output was recorded.",
      ].join("\n"),
    );
  });

  it("flags a still-running workflow on a single completed outcome", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 1,
          childThread: testThread({
            id: "thr_child",
            title: "Rebalance archetypes",
          }),
          terminalOutput: "Kicked off the balance pass.",
          turnStatus: "completed",
          author: null,
        },
      ],
    });

    expect(message).toContain(
      [
        "@thread:thr_child completed, with 1 workflow still running:",
        "",
        "Kicked off the balance pass.",
        "",
        "A workflow it started is still running, so this output is not its final result. The thread will report again when the workflow finishes.",
      ].join("\n"),
    );
  });

  it("pluralizes and flags still-running workflows across batched outcomes", () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 2,
          childThread: testThread({
            id: "thr_child_one",
            title: "Rebalance archetypes",
          }),
          terminalOutput: "Kicked off two workflows.",
          turnStatus: "completed",
          author: null,
        },
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: "thr_child_two",
            title: "Patch deploy script",
          }),
          terminalOutput: "Deploy script failed on preflight.",
          turnStatus: "failed",
          author: null,
        },
      ],
    });

    expect(message).toContain(
      [
        "Child thread updates:",
        "",
        "- @thread:thr_child_one completed, with 2 workflows still running.",
        "- @thread:thr_child_two failed.",
        "",
        "Threads with a workflow still running have not finished; they will report again when their workflow does.",
      ].join("\n"),
    );
  });

  it("builds mention ranges for needs-attention thread references", () => {
    const input = buildChildThreadNeedsAttentionInput({
      blockerSummary: null,
      childThread: testThread({
        id: "thr_child",
        title: "Backend cleanup",
      }),
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }
    const threadMention = "@thread:thr_child";
    const mentionStart = textInput.text.indexOf(threadMention);
    expect(textInput.mentions).toEqual([
      {
        start: mentionStart,
        end: mentionStart + threadMention.length,
        resource: {
          kind: "thread",
          label: "Backend cleanup",
          projectId: "proj_alpha",
          threadId: "thr_child",
        },
      },
    ]);
    expect(textInput.text).toContain(
      "Review the blocker. If you can resolve it from existing context, reply to the thread with guidance.",
    );
  });

  it("renders needs-attention blocker summaries when provided", () => {
    const input = buildChildThreadNeedsAttentionInput({
      blockerSummary: ["Blocked on command approval:", "git push"].join("\n"),
      childThread: testThread({
        id: "thr_child",
        title: "Backend cleanup",
      }),
    });

    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }

    expect(textInput.text).toContain(
      ["Blocked on command approval:", "git push"].join("\n"),
    );
    expect(textInput.text).not.toContain(
      "It is blocked on a pending interaction.",
    );
  });
});
