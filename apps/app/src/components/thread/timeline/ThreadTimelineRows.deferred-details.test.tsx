// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  commandRow,
  conversationRow,
  delegationRow,
  systemRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { appToast } from "@/components/ui/app-toast";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { timelineTurnSummaryDetails: vi.fn() } },
}));

const timelineTurnSummaryDetails = vi.mocked(
  sdk.threads.timelineTurnSummaryDetails,
);

function renderExpandedRow(row: TimelineRow) {
  return renderRow(row, new Set([row.id]));
}

function renderRow(
  row: TimelineRow,
  initialExpanded: ReadonlySet<string>,
  initialEntries = ["/"],
) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Wrapper>
        <ThreadTimelineRows
          initialExpanded={initialExpanded}
          threadId="thr_main"
          timelineRows={[row]}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </Wrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  timelineTurnSummaryDetails.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("deferred timeline details", () => {
  it.each(["turn", "delegation"])(
    "does not page through an unrelated expanded %s when following a message link",
    async (kind) => {
      const child = conversationRow({
        id: "unrelated-detail",
        seq: 150,
        text: "Activity outside the requested message scope.",
        threadId: "thr_main",
        turnId: "turn_2",
      });
      const delegated = (children: TimelineRow[] | null) =>
        delegationRow({
          id: "unrelated-delegation",
          callId: "unrelated-call",
          childRows: children,
          sourceSeqStart: 100,
          sourceSeqEnd: 200,
          threadId: "thr_main",
          turnId: "turn_2",
        });
      const unrelated =
        kind === "turn"
          ? turnRow({
              id: "unrelated-turn",
              children: null,
              sourceSeqStart: 100,
              sourceSeqEnd: 200,
              threadId: "thr_main",
              turnId: "turn_2",
            })
          : delegated(null);
      timelineTurnSummaryDetails.mockResolvedValue({
        olderCursor: "unrelated-older-page",
        rows: kind === "turn" ? [child] : [delegated([child])],
      });
      const { wrapper: Wrapper } = createQueryClientTestHarness();
      render(
        <MemoryRouter initialEntries={["/threads/thr_main#msg=12"]}>
          <Wrapper>
            <ThreadTimelineRows
              initialExpanded={new Set([unrelated.id])}
              threadId="thr_main"
              timelineRows={[
                conversationRow({ seq: 12, text: "The requested message." }),
                unrelated,
              ]}
              threadRuntimeDisplayStatus="idle"
              workspaceRootPath={undefined}
            />
          </Wrapper>
        </MemoryRouter>,
      );
      expect(
        await screen.findByText(
          "Activity outside the requested message scope.",
        ),
      ).toBeTruthy();
      expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(1);
      expect(timelineTurnSummaryDetails.mock.calls[0]?.[0]).not.toHaveProperty(
        "beforeCursor",
      );
    },
  );

  it.each(["turn", "delegation"])(
    "loads earlier %s details until the exact linked message is revealed",
    async (kind) => {
      const message = (seq: number) =>
        conversationRow({
          id: `paged-message-${seq}`,
          seq,
          text: `Historical detail message ${seq}.`,
          threadId: "thr_main",
          turnId: "turn_1",
        });
      const delegation = (children: TimelineRow[] | null) =>
        delegationRow({
          id: "paged-delegation",
          callId: "paged-call",
          childRows: children,
          sourceSeqStart: 10,
          sourceSeqEnd: 40,
          threadId: "thr_main",
          turnId: "turn_1",
        });
      timelineTurnSummaryDetails.mockImplementation(async (input) => {
        const earlier = input.beforeCursor === "older-details";
        const rows = [message(earlier ? 12 : 30)];
        return {
          olderCursor: earlier ? null : "older-details",
          rows: kind === "turn" ? rows : [delegation(rows)],
        };
      });
      const frames = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((callback) => {
          callback(performance.now());
          return 1;
        });
      const cancel = vi
        .spyOn(window, "cancelAnimationFrame")
        .mockImplementation(() => {});
      try {
        const view = renderRow(
          kind === "turn"
            ? turnRow({
                children: null,
                sourceSeqStart: 10,
                sourceSeqEnd: 40,
                threadId: "thr_main",
                turnId: "turn_1",
              })
            : delegation(null),
          new Set(),
          ["/threads/thr_main#msg=12"],
        );
        expect(
          await screen.findByText("Historical detail message 12."),
        ).toBeTruthy();
        await waitFor(() =>
          expect(
            view.container
              .querySelector('[data-timeline-row-id="paged-message-12"]')
              ?.classList.contains("bb-search-flash"),
          ).toBe(true),
        );
        expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(2);
        expect(timelineTurnSummaryDetails.mock.calls[1]?.[0]).toMatchObject({
          beforeCursor: "older-details",
        });
      } finally {
        frames.mockRestore();
        cancel.mockRestore();
      }
    },
  );

  it.each(["initial", "same-thread"])(
    "reveals an exact message link inside an unloaded collapsed turn on %s navigation",
    async (navigation) => {
      const row = turnRow({
        id: "deferred-message-turn",
        children: null,
        sourceSeqStart: 10,
        sourceSeqEnd: 40,
        threadId: "thr_main",
        turnId: "turn_1",
      });
      timelineTurnSummaryDetails.mockResolvedValue({
        olderCursor: null,
        rows: [
          conversationRow({
            id: "exact-deferred-message",
            seq: 12,
            text: "The selected message was inside a collapsed turn.",
            threadId: "thr_main",
            turnId: "turn_1",
          }),
        ],
      });
      const frames = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((callback) => {
          callback(performance.now());
          return 1;
        });
      const cancel = vi
        .spyOn(window, "cancelAnimationFrame")
        .mockImplementation(() => {});
      const messages = vi
        .spyOn(appToast, "message")
        .mockReturnValue("message-link-toast");
      function Harness() {
        const navigate = useNavigate();
        return (
          <>
            <button onClick={() => navigate("/threads/thr_main#msg=12")}>
              Open selected message
            </button>
            <ThreadTimelineRows
              threadId="thr_main"
              timelineRows={[row]}
              threadRuntimeDisplayStatus="idle"
              workspaceRootPath={undefined}
            />
          </>
        );
      }
      const { wrapper: Wrapper } = createQueryClientTestHarness();
      try {
        const view = render(
          <MemoryRouter
            initialEntries={[
              navigation === "initial"
                ? "/threads/thr_main#msg=12"
                : "/threads/thr_main",
            ]}
          >
            <Wrapper>
              <Harness />
            </Wrapper>
          </MemoryRouter>,
        );
        if (navigation === "same-thread") {
          expect(timelineTurnSummaryDetails).not.toHaveBeenCalled();
          fireEvent.click(screen.getByText("Open selected message"));
        }
        expect(
          await screen.findByText(
            "The selected message was inside a collapsed turn.",
          ),
        ).toBeTruthy();
        await waitFor(() =>
          expect(
            view.container
              .querySelector('[data-timeline-row-id="exact-deferred-message"]')
              ?.classList.contains("bb-search-flash"),
          ).toBe(true),
        );
        expect(
          view.container
            .querySelector('[data-timeline-row-id="deferred-message-turn"]')
            ?.classList.contains("bb-search-flash"),
        ).toBe(false);
        expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(1);
        expect(messages).not.toHaveBeenCalledWith(
          "Message not found",
          expect.anything(),
        );
      } finally {
        frames.mockRestore();
        cancel.mockRestore();
        messages.mockRestore();
      }
    },
  );

  it("does not reveal a neighboring message when a deferred exact target is missing", async () => {
    timelineTurnSummaryDetails.mockResolvedValue({
      olderCursor: null,
      rows: [
        conversationRow({
          id: "different-message",
          seq: 13,
          text: "A different message in the same turn.",
          threadId: "thr_main",
          turnId: "turn_1",
        }),
      ],
    });
    const view = renderRow(
      turnRow({
        children: null,
        sourceSeqStart: 10,
        sourceSeqEnd: 40,
        threadId: "thr_main",
        turnId: "turn_1",
      }),
      new Set(),
      ["/threads/thr_main#msg=12"],
    );
    expect(
      await screen.findByText("A different message in the same turn."),
    ).toBeTruthy();
    expect(view.container.querySelector(".bb-search-flash")).toBeNull();
    expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(1);
  });

  it("loads a settled delegation's children by call when it is expanded", async () => {
    const deferred = delegationRow({
      callId: "agent-call",
      childRows: null,
      sourceSeqEnd: 30,
      sourceSeqStart: 12,
      threadId: "thr_main",
      turnId: "turn_1",
    });
    timelineTurnSummaryDetails.mockResolvedValue({
      olderCursor: null,
      rows: [
        delegationRow({
          callId: "agent-call",
          childRows: [
            conversationRow({
              id: "child-message",
              text: "Child mapped the integration.",
              threadId: "thr_main",
              turnId: "turn_1",
            }),
          ],
          sourceSeqEnd: 30,
          sourceSeqStart: 12,
          threadId: "thr_main",
          turnId: "turn_1",
        }),
      ],
    });

    renderExpandedRow(deferred);

    expect(
      await screen.findByText("Child mapped the integration."),
    ).toBeTruthy();
    expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(1);
    expect(timelineTurnSummaryDetails.mock.calls[0]?.[0]).toMatchObject({
      deferContent: "true",
      itemId: "agent-call",
      sourceSeqEnd: "30",
      sourceSeqStart: "12",
      threadId: "thr_main",
      turnId: "turn_1",
    });
    expect(screen.queryByText("Load earlier activity")).toBeNull();
  });

  it("loads earlier turn activity only when asked", async () => {
    timelineTurnSummaryDetails.mockImplementation(async (input) =>
      input.beforeCursor === undefined
        ? {
            olderCursor: "older-page",
            rows: [
              conversationRow({
                id: "latest-message",
                text: "Latest turn activity.",
                threadId: "thr_main",
                turnId: "turn_1",
              }),
            ],
          }
        : {
            olderCursor: null,
            rows: [
              conversationRow({
                id: "earlier-message",
                text: "Earlier turn activity.",
                threadId: "thr_main",
                turnId: "turn_1",
              }),
            ],
          },
    );

    renderExpandedRow(
      turnRow({ sourceSeqEnd: 40, threadId: "thr_main", turnId: "turn_1" }),
    );

    expect(await screen.findByText("Latest turn activity.")).toBeTruthy();
    expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Earlier turn activity.")).toBeNull();

    fireEvent.click(screen.getByText("Load earlier activity"));

    expect(await screen.findByText("Earlier turn activity.")).toBeTruthy();
    expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(2);
    expect(timelineTurnSummaryDetails.mock.calls[1]?.[0]).toMatchObject({
      beforeCursor: "older-page",
      turnId: "turn_1",
    });
    expect(screen.queryByText("Load earlier activity")).toBeNull();
  });

  it("loads a deferred command's output by item when it is expanded", async () => {
    const loaded = commandRow({
      id: "cmd-deferred",
      command: "pnpm test",
      output: "FULL OUTPUT FROM SERVER",
      sourceSeqStart: 4,
      sourceSeqEnd: 7,
      threadId: "thr_main",
      turnId: "turn_1",
    });
    timelineTurnSummaryDetails.mockResolvedValue({
      olderCursor: null,
      rows: [loaded],
    });

    renderExpandedRow({ ...loaded, output: "", contentDeferred: true });

    expect(await screen.findByText(/FULL OUTPUT FROM SERVER/)).toBeTruthy();
    expect(timelineTurnSummaryDetails.mock.calls[0]?.[0]).toMatchObject({
      deferContent: "true",
      itemId: loaded.callId,
      sourceSeqEnd: "7",
      sourceSeqStart: "4",
      turnId: "turn_1",
    });
  });

  it("keeps a deferred reasoning row expandable and loads its text", async () => {
    const reasoning = systemRow({
      detail: "Considered every cursor edge case.",
      id: "reasoning-row",
      operationKind: "reasoning",
      sourceSeqEnd: 3,
      sourceSeqStart: 2,
      threadId: "thr_main",
      title: "Thought",
      turnId: "turn_1",
    });
    if (
      reasoning.systemKind !== "operation" ||
      reasoning.operationKind === "parent-change"
    ) {
      throw new Error("Expected a reasoning operation row");
    }
    const loaded = { ...reasoning, reasoningId: "reasoning-item" };
    timelineTurnSummaryDetails.mockResolvedValue({
      olderCursor: null,
      rows: [loaded],
    });

    renderExpandedRow({ ...loaded, detail: null, contentDeferred: true });

    expect(
      await screen.findByText("Considered every cursor edge case."),
    ).toBeTruthy();
    expect(timelineTurnSummaryDetails.mock.calls[0]?.[0]).toMatchObject({
      itemId: "reasoning-item",
    });
  });

  it("keeps showing streamed output while a settled row loads its deferred content", async () => {
    let resolveDetails: (value: {
      olderCursor: null;
      rows: TimelineRow[];
    }) => void = () => {};
    timelineTurnSummaryDetails.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetails = resolve;
        }),
    );
    const running = commandRow({
      id: "cmd-streaming",
      command: "long-task",
      output: "STREAMED LINE 1",
      sourceSeqStart: 4,
      sourceSeqEnd: 7,
      status: "pending",
      threadId: "thr_main",
      turnId: "turn_1",
    });
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const renderRows = (rows: TimelineRow[]) => (
      <MemoryRouter>
        <Wrapper>
          <ThreadTimelineRows
            initialExpanded={new Set([running.id])}
            threadId="thr_main"
            timelineRows={rows}
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={undefined}
          />
        </Wrapper>
      </MemoryRouter>
    );
    const view = render(renderRows([running]));
    const streamed = await screen.findByText(/STREAMED LINE 1/);

    view.rerender(
      renderRows([
        {
          ...running,
          status: "completed",
          exitCode: 0,
          output: "",
          contentDeferred: true,
        },
      ]),
    );

    expect(screen.queryByText("Loading details...")).toBeNull();
    expect(screen.getByText(/STREAMED LINE 1/)).toBe(streamed);
    await vi.waitFor(() => {
      expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(1);
    });

    resolveDetails({
      olderCursor: null,
      rows: [
        {
          ...running,
          status: "completed",
          exitCode: 0,
          output: "STREAMED LINE 1\nFINAL LINE 2",
        },
      ],
    });
    expect(await screen.findByText(/FINAL LINE 2/)).toBeTruthy();
    expect(screen.queryByText("Loading details...")).toBeNull();
  });

  it("starts loading a collapsed row's deferred content when its header is pressed", async () => {
    const loaded = commandRow({
      id: "cmd-pressed",
      command: "pnpm lint",
      output: "LINT OUTPUT FROM SERVER",
      sourceSeqStart: 4,
      sourceSeqEnd: 7,
      threadId: "thr_main",
      turnId: "turn_1",
    });
    timelineTurnSummaryDetails.mockResolvedValue({
      olderCursor: null,
      rows: [loaded],
    });

    renderRow({ ...loaded, output: "", contentDeferred: true }, new Set());
    fireEvent.pointerDown(screen.getByText(/pnpm lint/));

    expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(1);
    expect(timelineTurnSummaryDetails.mock.calls[0]?.[0]).toMatchObject({
      itemId: loaded.callId,
    });
    expect(screen.queryByText(/LINT OUTPUT FROM SERVER/)).toBeNull();

    fireEvent.click(screen.getByText(/pnpm lint/));

    expect(await screen.findByText(/LINT OUTPUT FROM SERVER/)).toBeTruthy();
    expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(1);
  });
});
