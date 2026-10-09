# Child thread report delivery design

Status: problem analysis and proposed direction. No implementation yet. This document lives on `feature/child-report-delivery`, based on `desktop-v0.45.0`; every file reference below is against that tag.

## Problem

A parent thread that coordinates several child threads receives their reports while it is doing something else, often while the user is talking to it. Today every report, whether it is a server-generated outcome notice or a child running `bb thread tell <parent>`, joins the parent's active turn as a steer. The parent sees it as the newest user-role message in its context.

Current models have no trouble reading an injected message and continuing. What they cannot infer is priority: a user-role message that arrives mid-turn reads as "the newest intent", so the parent pivots to it. The observable effects:

- The answer the user was waiting for gets thinner or merges with a reaction to the report.
- Several reports in one turn fragment the parent's chain of reasoning, which leads to duplicated delegation or a premature "done".
- When the parent is idle waiting for a user decision, a report starts a new turn on its own and the parent proceeds without that decision.

The missing signal is "this is information from a subordinate, finish what you are doing first". The steer channel cannot carry it because steer means the opposite.

## Current behavior

Two channels deliver child information to a parent. Neither distinguishes a status report from an instruction.

### Server-generated outcome notices

`apps/server/src/services/threads/child-thread-notifications.ts` queues a notice when a child turn completes, fails, or is interrupted, and a separate `child-needs-attention` notice when a child blocks on an interaction. Facts that matter here:

- Outcomes for one parent are batched for 2 seconds (`CHILD_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS`) into one `child-outcome-batch` notice. The batch window only covers near-simultaneous completions; it does not hold reports for the parent's turn boundary.
- A completion notice embeds the child's final output, up to 4,000 characters per child.
- `queueParentSystemMessage` in `parent-system-messages.ts` dispatches with `mode: "auto"`: join the active turn if the parent is active, otherwise start a new turn. The turn is `initiator: "system"` and the text is prefixed `[bb system]` by the templates in `packages/templates/src/templates/system-message-*.md`.
- If the parent is waiting on an interaction the notice queues with `waitingOn.kind: "interaction"` and dispatches when the interaction settles.

### Agent-to-agent tells

`bb thread tell` defaults to `--mode steer`, which the CLI sends as `steer-if-active` (`apps/cli/src/commands/thread/actions.ts`). `resolveSendMode` in `apps/server/src/services/threads/thread-send.ts` turns that into a steer when the target is active and a fresh turn when it is idle. The text is wrapped by `agent-thread-message.md` as `[bb message from thread:<id>]` and the turn request records `source: "tell"` with `senderThreadId`.

The bb-guide tells agents to use `tell` "when requirements change, a blocker needs clarification, or follow-up work is needed" and to use `--mode queue` for non-urgent messages (`plugins/bb-guide/skills/bb-cli/references/thread-operation.md`). In practice child agents also use it for progress reports, and nothing in the guide or the CLI distinguishes the two.

### What a steer means per provider

- Claude Code: `handleTurnSteer` in `plugins/provider-claude-code/src/bridge/bridge.ts` runs the input with intent `steer`; the SDK injects it as a user message at the next tool-result boundary.
- Codex: `steerMode: "inject"` in `plugins/provider-codex/src/bridge/bridge.ts`, same effect.
- ACP: depends on the agent; agents without concurrent prompt support fall back to interrupt-and-resend, which is worse than a steer for an informational message (see [acp-mid-turn-steering-design.md](acp-mid-turn-steering-design.md)).

In every case the report lands with user-message weight and with no structural hint that it is subordinate to the work in progress.

## Goals

1. A parent that is answering the user finishes that answer before it processes child reports, unless a report is an escalation.
2. A parent that is idle because it is waiting for the user does not start a turn on a status report alone.
3. Reports that arrive close together reach the parent as one message, not one steer each.
4. The parent can tell, from the message itself, that it is a report from a subordinate thread and what kind of report it is.
5. Escalations (blocked, needs decision, wrong direction) keep the steer path, because that is what steer is for.
6. The behavior is reachable from the UI, SDK, and `bb` CLI, and the bb-guide explains it to agents.

Non-goals: changing how a user's own messages are delivered; changing child-to-child messaging; rewriting the queue.

## Design

### Report kinds

Introduce a message kind on agent-to-agent sends, separate from delivery mode:

| Kind | Meaning | Default delivery |
| --- | --- | --- |
| `report` | Progress, partial result, completion detail from a subordinate. Informational. | Wait for the parent's turn boundary. Coalesce. |
| `escalate` | Blocked, needs a decision, discovered the plan is wrong. Requires the parent to act. | Steer, as today. |
| `message` | Anything else, including existing callers. | Current `steer` default, unchanged. |

The kind is an authored fact at the boundary: the child picks it, the CLI validates it, the server stores it on the turn request event alongside `source` and `senderThreadId`. The existing `--mode` flag stays as an override so a caller who wants a steered report can still ask for one.

Server-generated outcome notices map onto the same kinds without a flag: `child-completed`, `child-failed`, `child-interrupted` and their batch are `report`; `child-needs-attention` is `escalate`.

### Delivery policy for `report`

A `report` is dispatched with a new mode `report-if-active`:

- Parent active: queue with `waitingOn.kind: "thread-busy"` so it dispatches when the turn ends. This is the existing `queue-if-active` wait; nothing new in the queue.
- Parent idle because its last turn ended normally: start a turn, as today. A coordinator with nothing else to do should process reports.
- Parent idle because it is waiting on the user: hold. See the open question below on how the server knows this.
- Parent awaiting an interaction: queue on `interaction`, as today.

Reports held for the same parent coalesce into one message when they dispatch. The outcome batch already renders multiple children into one body; the same renderer takes agent-authored `report` texts as items. One parent turn then receives one `[bb report]` block listing every child that reported since the last boundary, instead of N steers.

### Envelope and guidance

Rendered reports get their own prefix instead of `[bb message from thread:...]`:

```
[bb report from thread:thr_abc123]

<text>
```

and the bb-guide agent configuration adds one rule: a `[bb report ...]` block is information from a subordinate thread, it does not change the current task, and the parent should finish the step it is on before deciding whether the report needs a response. Escalations keep the existing `[bb message ...]` envelope plus a `needs help` style sentence, mirroring `child-needs-attention`.

This is the part that targets the actual failure. A model treats a prefix and a stated rule as priority information; it cannot treat delivery timing as such.

### Surfaces

- CLI: `bb thread tell --kind report|escalate` (default `message`). `bb thread spawn` prompt text and the bb-guide tell children to use `--kind report` for progress and `--kind escalate` for blockers.
- SDK: `threads.send({ kind })` with the same values; `delivery` in the response reports `queued` with `waitingOn` as today.
- Server contract: `SendThreadMessageMode` gains `report-if-active`; `TurnRequestEventData` gains `kind`. Timeline projection renders `report` turns with the report label so the user can see in the parent's thread what was a report and what was an instruction.
- Host daemon protocol: no wire change if the server resolves `report-if-active` into the existing `start`/`steer` dispatch before the command leaves the server. If the rendered envelope changes the prompt text only, `HOST_DAEMON_PROTOCOL_VERSION` stays at its current value.
- Templates: `agent-thread-report.md` for the envelope; `bb-guide-agent-configuration.md` for the rule.
- Docs: `cli-guide-and-skill.md` surfaces per the CLI change rule.

### Compatibility

Existing callers that run `bb thread tell` with no `--kind` keep today's behavior. Only the server-generated outcome notices change default delivery, from `auto` to `report-if-active`. Users who rely on a parent reacting mid-turn to a child's completion will see it react at the turn boundary instead; the `child-needs-attention` path is unchanged, so blocked children still interrupt.

## Why not the alternatives

- **Change the `tell` default to `queue` globally.** Fixes reports, breaks the documented reason steer is the default: a wrong-direction correction must land now. Kind, not mode, is the right axis.
- **Mailbox with explicit pull (`bb thread inbox`).** Cheapest per report and the most scalable, but it makes report reading depend on the parent remembering to pull, and the parent's system prompt would have to explain the inbox. Coalesced push at the turn boundary gives the same single-interruption property without a new command. If report volume grows past what one message can hold, an inbox is the next step and this design does not block it.
- **Only fix the prompt text and keep steer.** Would help the pivot problem but not the "parent waiting on the user starts a turn" problem, and still costs one injection per report.

## Open questions

1. How should the server tell "idle because waiting for the user" from "idle because done"? The thread status is `idle` in both. Candidates: the last assistant message ended with a question to the user (not reliable), or an explicit per-thread setting such as `reportsStartTurns: boolean` that a coordinator thread opts into. The setting is simpler and honest about being a policy.
2. Should the completion output excerpt move from the outcome notice into the coalesced report body, or stay as is? Keeping it means a batch of five completions can be 20,000 characters; the renderer may need a per-batch cap.
3. Should `report` kind be visible in the sidebar or thread list as an unread count on the parent, the way blocked children are surfaced today? Useful for the user, not needed for the agent behavior.
4. ACP agents without concurrent prompt support currently fall back to interrupt for a steer. For `escalate` that may still be right; for `report` the queued path avoids it entirely. Confirm the ACP bridge never sees a `report` as a steer.
