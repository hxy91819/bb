import { describe, expect, it } from "vitest";
import {
  isEligibleExplicitWorkAcceptance,
  type ExplicitWorkAcceptance,
} from "../../src/services/projects/recent-explicit-work.js";

function acceptance(
  overrides: Partial<ExplicitWorkAcceptance> = {},
): ExplicitWorkAcceptance {
  return {
    origin: "app",
    parentThreadId: null,
    payloadInputLength: 1,
    retryOf: false,
    sendAt: null,
    sourceKind: "inline",
    startedOnBehalfOfInitiator: null,
    threadStatus: "idle",
    trigger: "user",
    ...overrides,
  };
}

describe("explicit work acceptance eligibility", () => {
  it("accepts user-originated inline sends, creates, and immediate retries", () => {
    expect(isEligibleExplicitWorkAcceptance(acceptance())).toBe(true);
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({ origin: "cli", threadStatus: "pending" }),
      ),
    ).toBe(true);
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({ origin: "sdk", threadStatus: "pending" }),
      ),
    ).toBe(true);
    expect(
      isEligibleExplicitWorkAcceptance(acceptance({ retryOf: true })),
    ).toBe(true);
  });

  it("rejects automatic drains, agent work, and empty or delegated creation", () => {
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({ trigger: "auto-dispatch" }),
      ),
    ).toBe(false);
    expect(
      isEligibleExplicitWorkAcceptance(acceptance({ sourceKind: "drain" })),
    ).toBe(false);
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({ startedOnBehalfOfInitiator: "agent" }),
      ),
    ).toBe(false);
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({
          parentThreadId: "thr_parent",
          threadStatus: "pending",
        }),
      ),
    ).toBe(false);
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({ origin: "plugin", threadStatus: "pending" }),
      ),
    ).toBe(false);
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({ payloadInputLength: 0, threadStatus: "pending" }),
      ),
    ).toBe(false);
  });

  it("rejects scheduled automatic retries and accepts follow-ups on child threads", () => {
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({ retryOf: true, sendAt: 2_000 }),
        1_000,
      ),
    ).toBe(false);
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({ retryOf: true, sendAt: 500 }),
        1_000,
      ),
    ).toBe(true);
    expect(
      isEligibleExplicitWorkAcceptance(
        acceptance({ parentThreadId: "thr_parent", threadStatus: "idle" }),
      ),
    ).toBe(true);
  });
});
