# ACP mid-turn steering design

Status: agreed design direction; no product implementation or provider compatibility claim from tests yet. The user accepts next-iteration semantics and narrowed the visibility change: retain the existing send action and automatic fallback behavior, but label interrupt delivery as “降级为中断并发送” instead of Steer. The oracle review thread ended in an error after this narrowing; the label mechanism below is the concrete form of that decision.

Reviewed source: local aggregate `a4923f542`. This document lives on the independent `fix/acp-mid-turn-steering-design` worktree, based on `desktop-v0.43.1` (`267938526`). The aggregate includes additional ACP service-tier, goal, and DSH work beyond that tag; an implementation must account for those dependencies explicitly rather than use the aggregate as an upstream PR base.

## Decision and guarantee

Use hybrid gating (C). Send concurrent `session/prompt` only when the live agent positively advertises the supported steering extension, a tested dialect supplies that contract, or an explicit provider setting asserts it. All other agents retain cancel-and-reprompt, visibly labeled “降级为中断并发送”. Never learn support by submitting a user steer to an unknown agent and observing success.

There is no portable ACP v1 acknowledgment proving that the running inference consumed a concurrent prompt. Response order or elapsed time, an echoed user message, and matching vendor message IDs do not establish that fact. A queueing agent can accept immediately and emit similar observations. A real steering agent can defer consumption until another model iteration. Consequently B cannot meet the no-silent-queueing requirement. A misses Devin.

The achievable guarantee is delivery to a provider's documented next-iteration steering path, without BB cancelling that path. It is not preemption of a streaming inference or a running tool. The user's Devin v3000.10.31 probe establishes next-iteration consumption, but also shows that a final inference with no subsequent iteration may leave the input for a later turn. ACP v1 cannot detect or repair that case generically without risking duplicate delivery. If acceptance instead requires consumption before the current turn ends in every case, Devin cannot satisfy it over this interface.

The reviewed [ACP v1 lifecycle](https://agentclientprotocol.com/protocol/v1/prompt-turn) specifies prompt completion and cancellation, not a normative concurrent-prompt steering acknowledgment. [The inject RFD](https://github.com/agentclientprotocol/agent-client-protocol/pull/1261) must not be treated as an available v1 method.

## Delivery label

Keep the existing send action, queue action, and automatic fallback rules. Do not add a third send mode, a confirmation dialog, saved delivery preferences, strict-native command semantics, or a separate retry workflow.

Where BB currently labels a delivered input Steer, show **Steer** for the native injection path and **降级为中断并发送** for the cancel-and-reprompt path. The label must describe this input's actual delivery, not just the provider's usual capability. A runtime busy rejection that safely falls back must update that same input to the degradation label; future inputs in the downgraded session receive it as well. Tier- or command-driven interruption receives the same label. Do not claim an interruption happened if the original turn ended naturally before any cancellation was sent. A failed input must not be labeled as successfully delivered.

Mechanism: a new thread delta `input.delivery` carrying `{ clientRequestId, delivery: "steer" | "interrupted" | "queued" }`, emitted only for inputs admitted through `turn/steer`, at the moment the carrying `session/prompt` write determines actual delivery:

- `steer` — the input was written as a concurrent `session/prompt` while the turn's prompt group was in flight. This asserts delivery through the native path, not model consumption.
- `interrupted` — the input was written as a continuation after a `session/cancel` was actually sent to deliver it. Covers incapable agents, explicit `interrupt` mode, tier/command-driven exceptions, and proven-rejection fallback replays.
- `queued` — the input was written as a continuation after the in-flight group ended naturally with no `session/cancel` sent. Covers steers admitted during drain and rejected injections replayed after the group already ended. Render as a queued/downgraded delivery, not as interruption.

An input emits at most two `input.delivery` deltas: a later emission corrects the earlier label (injected then fallback-replayed: `steer` → `interrupted` or `queued`). Plain `turn/start` inputs emit nothing. The delta assembles to a stored per-input event joined to the message by `clientRequestId`; the timeline label and CLI/SDK rendering read that stored fact. `appliedAs` and the `turn/steer` result stay unchanged so no response enum breaks.

The new stored event type crosses the daemon→server wire: increment `HOST_DAEMON_PROTOCOL_VERSION` rather than rely on an old daemon silently dropping or misreading it. The bridge↔runtime delta grammar stays at the negotiated version — this bridge and runtime ship in one build, and out-of-tree bridges never emit the kind. Report mixed-acceptance ordering violations through the existing `provider.warning` delta. Do not build a new per-session capability product surface or a general delivery-state system for this change; do not replace the visible label with a log-only warning.

## Gates

Introduce a typed provider option `acpSteeringMode: "auto" | "interrupt" | "prompt"`, normalized once when constructing the session. `prompt` is an operator assertion of steering semantics, not a discovery mode. Resolve a concrete session mode and record its source for diagnostics.

1. A session that has received a recognized concurrent-prompt rejection stays on interrupt until a fresh connection/initialize. This overrides positive configuration for the remainder of that connection.
2. Explicit `interrupt` always wins.
3. Explicit `prompt` selects injection as an operator assertion. It should visibly diagnose conflicting negative metadata; reject a contradictory configuration rather than silently overriding an explicit false declaration. A queueing capability by itself never supplies the assertion.
4. In `auto`, literal top-level initialize `_meta.midTurnSteering === true` selects injection. Literal false overrides a dialect default. Absent or malformed metadata is not a positive declaration.
5. Otherwise select injection for a narrow Devin dialect backed by the supplied live probe; all remaining dialects select interrupt. An explicit dialect setting keeps its existing precedence over executable-name inference. Wrappers such as `npx`, `uvx`, or shell scripts require an explicit dialect/setting; do not search arbitrary arguments for a vendor name.

Do not interpret `agentCapabilities._meta.claudeCode.promptQueueing` as steering. The [Claude issue](https://github.com/agentclientprotocol/claude-agent-acp/issues/871) specifically describes a next-turn queue. A future genuine steering declaration can coexist with a queue capability; queueing is not itself a permanent vendor denylist.

The historical [codex-acp PR #314](https://github.com/zed-industries/codex-acp/pull/314) describes the proposed extension, but was closed unmerged on June 23, 2026. Do not enable all binaries named `codex-acp` from that PR. Enable a running build only when it actually advertises the extension or is explicitly configured. The PR also excludes turn-starting slash commands from its injection path.

| Agent/configuration | Default result |
| --- | --- |
| Devin dialect, no contradictory metadata | Concurrent prompt, next-iteration semantics |
| Live agent advertising `midTurnSteering: true` | Concurrent prompt for supported ordinary inputs |
| Claude with only `promptQueueing` | Existing cancel-and-reprompt |
| DSH | Existing cancel-and-reprompt |
| User's Amp fork | Existing cancel-and-reprompt, preserving its `steerNextPrompt` behavior |
| Cursor, OpenCode, OMP, Grok, Hermes, unknown/custom agents without affirmative evidence | Existing cancel-and-reprompt |

Gate by input as well as agent. Until specifically verified, turn-starting commands such as `/compact`, `/init`, and `/review*` use the existing interrupt path. A text item whose mentions include a `command`-kind resource marks the input command-carrying; such inputs are ineligible for injection. Do not let an agent silently serialize such a request merely because its normal-text steering gate passed. The Devin dialect contract injects text-only inputs until attachment steering is probed; inputs carrying images or files use the interrupt path. An advertised `midTurnSteering` declaration or explicit `prompt` assertion may inject any non-command input.

## Turn ownership and request lifecycle

Use one turn context per BB turn, with an identity/generation, a phase, the current primary prompt, tracked injected requests, an ordered collection of unsent inputs, terminal outcome, and a settlement promise. Keep active compaction separate. Each input carries an arrival sequence, client request ID, and acceptance-emitted state. Bind every asynchronous callback to the originating session object and turn context.

The context separates two independent facts: whether an underlying ACP prompt is still running, and whether outstanding requests/bookkeeping still keep the BB turn open. Replace the single `promptRequestPending` boolean with explicit primary/injection request ownership; one request settling cannot clear another request's pending state.

### Admission and acknowledgment

- Keep the existing short-lived BB `turn/steer` response: it means the bridge has admitted responsibility for the input into the current BB turn. Never wait for the injected ACP prompt's terminal response. Devin and dissolve implementations can keep that response pending for the whole turn. Runtime awaits the BB response, even though `runThreadOperation` is an operation counter, not a mutex.
- Admission records the input against a live context and responds promptly. On the normal native path, admission, synchronous content preparation, request registration, write, and acknowledgment occur without awaiting a previous prompt. Legacy mode retains its immediate acknowledgment before its queued input is sent.
- `input.accepted` continues to mean the prompt carrying the input was submitted to the ACP transport, not model consumption. Emit it once per client request ID when that write succeeds. An admitted but unsent input must never produce this delta. Replaying a proven rejected injection through the legacy path must not emit a second acceptance.
- The current `connection.request()` returns a Promise even when the connection is already closed, and `writeLine()` cannot report successful submission. Add a narrow transport submission callback/result so bridge acceptance is tied to an actual writable-stream submission. A `stdin.write()` return value of false is backpressure, not failure. Neither a successful write nor its callback is agent-level acceptance.
- Validate/build content before mutating ownership that cannot be recovered. `buildPromptContentBlocks()` consumes `pendingInstructions`; retain the built payload for an admissible retry instead of rebuilding it and duplicating or losing one-time instructions.

### Scheduling and finishing

Use a FIFO dispatcher for admission/write ordering, separate from response settlement. Write S1 and S2 in arrival order without awaiting S1's response. Attach a rejection handler to every response immediately. A Promise chain that waits for complete prompt responses would reproduce queue-next delivery.

Native inputs already written are never also stored in `queuedInputs`. That collection is for inputs not yet written, including legacy continuation and turn-start preparation. Steers arriving while the initial prompt is being prepared may be staged; after the primary is submitted, dispatch them promptly according to the selected mode.

The primary terminal result closes admission to that particular ACP prompt, not the entire BB turn. Already-admitted unsent work remains owned by the same BB turn. Once the current request group drains, it becomes a normal sequential continuation, as today's loop already permits. A steer arriving while that BB turn is draining follows this same explicit continuation rule; do not classify it as an in-flight injection. Do not start that continuation while old injected requests are outstanding.

If the BB turn was already closed when a request is admitted, return the existing `NO_ACTIVE_TURN` plus `staleTurn` before writing any payload. There must be no await between the native send's final local liveness check and transport submission. Recheck session/turn identity after any awaited preparation. A remote turn can still end between local check and receipt; accept the single agent response and never resend solely because its timing suggests that race.

Finish only when the primary and all submitted injections have settled, there is no admission/preparation work, and no owned unsent continuation remains. This must be a live barrier, not a one-time `Promise.all` snapshot taken before later steers arrive. Emit exactly one BB completion. The primary is authoritative for a successful shared prompt group's stop reason; injection errors cannot be hidden by a successful primary. Conflicting terminal results are diagnosed as a contract violation. A deliberate interrupt-and-continue group does not complete the BB turn; the final continuation supplies its terminal result.

`finishTurn(context)` must be idempotent and identity-checked. Stopping invalidates admission first, drops unsent work, cancels permissions, sends cancellation, and uses the existing bounded stop/kill behavior. Session release/replacement invalidates old contexts; callbacks from them must not clear state or emit completion for a new turn. `turnSettled` includes injected requests. Do not wait indefinitely after explicit stop just because an injected responder never resolves.

## Fallback and errors

Fallback is permitted only for a known error contract establishing that the concurrent prompt was rejected before acceptance, such as the exact DSH busy rejection (error type/code plus narrowly recognized message). Generic `invalidParams` is insufficient: malformed content can produce the same code. Preserve structured error data at the connection boundary if classification needs it.

On a recognized rejection, disable injection for this connection, stop further native dispatch, retain the rejected input exactly once, and request legacy cancellation if an active prompt remains. Record the interruption for this input so its label becomes “降级为中断并发送”. Cancel pending permissions on that legacy transition. Drain all previously submitted requests, then replay only inputs conclusively rejected before acceptance and inputs never sent, in sequence order. If the original prompt already ended, no cancel is needed before the continuation.

With several concurrent steers, responses may arrive in arbitrary order. Track each independently; never put the entire batch back into the queue. If an earlier steer is rejected while a later steer was accepted, automatic replay would reverse their causal order. Report that inconsistent contract visibly instead of silently replaying the earlier input after the later one; disable injection for future turns. Uniform busy rejection supports ordinary ordered fallback.

Do not replay on transport loss, timeout, malformed response, arbitrary provider errors, or missing/delayed echoes. Those do not prove nonacceptance. Errors after the BB RPC was acknowledged go through a visible terminal error path; do not attempt a second RPC response. Coordinate a single failed terminal outcome with cancellation/drain so `emitSessionError` does not close the runtime turn while old requests are allowed to keep emitting into a new one. A process exit must settle the group once, despite rejecting every pending Promise.

Avoid a timing heuristic that cancels an apparently slow injection. It would cancel valid long-running steers and still could not distinguish a fast queueing agent.

## Service tier and permissions

Use the effective native config value, not merely the requested tier in `construction`, to decide whether a setter is necessary. Skip redundant `session/set_config_option` calls when no setting change is needed.

For a steer with a real tier change, use interrupt-and-reprompt for that input in the initial implementation: stop admission to the current native group, cancel/drain it, call `applyAcpServiceTierForTurn`, then submit the continuation. Keep later inputs ordered behind that transition. Do not globally downgrade the agent's steering capability. This preserves explicit setting semantics without assuming that agents support mid-turn config mutation or that setters respond before prompt completion. An agent with no native tier mapping retains the existing no-op behavior; do not claim native application there.

For ordinary native injection, do not call `cancelPendingPermissions` and do not set `cancelRequested`. Existing permissions belong to the continuing turn. The current permission handler otherwise rejects subsequent requests whenever that flag is true. A steer does not grant an approval or abort a running tool. If the provider cannot advance until an approval is answered, the steer waits for that boundary; preserve the interaction and test it. BB's normal server submission path already queues new messages while an interaction is pending, so review that separately from direct bridge/runtime tests. Real cancellation, fallback, stop, and release retain permission cancellation. These semantics align with the [ACP cancellation contract](https://agentclientprotocol.com/protocol/v1/prompt-turn).

## Runtime and translation implications

`packages/agent-runtime/src/runtime.ts:steerTurn` converts `staleTurn`/`NO_ACTIVE_TURN` to stale and clears its turn state. `apps/host-daemon/src/command-handlers/thread.ts:steerSubmittedTurn` can then submit the same input as a new turn. Never return stale after an injection was submitted or after the bridge admitted responsibility and acknowledged it. Otherwise recovery can execute the same input twice.

Do not introduce delayed stale responses from background injection callbacks. Test late admission and successful injection followed by turn completion through the real runtime/daemon path. If asynchronous admission checks are introduced, also guard runtime state clearing against erasing a newer active turn and recheck the expected turn immediately before dispatch; `runThreadOperation` does not provide serialization.

Maintain one translator context through the entire BB turn. Do not synthesize turn-open/turn-close or reset tool tracking per injected response. Usage notifications remain session-scoped updates; do not count the same shared result once per responder. User-message echoes and vendor IDs are optional diagnostics, not consumption acknowledgments or identities for deduplicating BB input.

Leave bridge-wide initialize `steerMode: "queue"` unchanged for this scoped change. Its present field is process-wide and unconsumed, while actual policy is per live ACP session and may downgrade. Advertising global `inject` before agent initialization would overstate capability. Adding useful per-session product capability reporting would be a separate contract change, not a prerequisite for correct dispatch.

## Change map and verification

| File/function | Intended work |
| --- | --- |
| `packages/provider-bridge-acp/src/wire.ts`, `wire.test.ts` | Parse the actual steering metadata location tolerantly; require literal true; distinguish malformed/absent metadata and explicit false. Preserve unknown vendor metadata. |
| `packages/provider-bridge-acp/src/dialect.ts`, `dialect.test.ts` | Add the narrow Devin steering contract and input eligibility; preserve existing dialect resolution and defaults. |
| `packages/provider-bridge-acp/src/session-params.ts`, tests | Carry the normalized mode into session construction and reconstruction. |
| `packages/provider-bridge-acp/src/bridge/bridge.ts` | Update `AcpThreadSession`, `startAgentSession`, provider-option parsing, `turn/steer`, `runTurn`, `requestSteerCancel`, acceptance/drop handling, `finishTurn`, stop/release, and tier-transition dispatch. |
| `packages/provider-bridge-acp/src/bridge/agent-connection.ts`, tests | Report local submission separately from terminal response; retain typed error details when needed. |
| `packages/provider-bridge-acp/src/bridge/fake-acp-agent.mjs`, `bridge.test.ts` | Controllable dissolve, queue-only, reject-busy, response-order, permission, config, and failure modes; assert externally visible behavior. |
| `packages/provider-bridge-acp/src/delta-translation.test.ts` | Verify one continuous turn/tool stream and no duplicated acceptance or usage from multiple responders. Production translator changes only where needed for delivery metadata. |
| `packages/provider-bridge-protocol/src/thread-delta.ts` + assembler/grammar tests | Add the `input.delivery` delta kind; keep it inside the negotiated grammar version. |
| `packages/domain/src/provider-event.ts`, `thread-event-scope.ts` | Add the stored `turn/input/delivery` event type joined by `clientRequestId`. |
| `packages/agent-runtime` delta assembly, `apps/host-daemon` event forwarding | Map the new delta to the new event; verify the daemon forwards it unchanged. |
| `apps/server` event persistence + timeline, `apps/app` message label, CLI/SDK event rendering | Persist actual delivery on the input, render Steer / “降级为中断并发送” / queued on the message; no new send actions or settings workflow. |
| `plugins/provider-acp/src/agents.ts`, `declaration.ts`, `agents.test.ts` | Add `steeringMode` to the strict custom-agent schema and pass it through `experimental_bridgeOptions` as `acpSteeringMode`. |
| `HOST_DAEMON_PROTOCOL_VERSION` | Increment for the new daemon→server event type; an old pair must not silently lose the delivery fact. `PROVIDER_BRIDGE_PROTOCOL_VERSION` unchanged — bridge and runtime ship in one build. |

For user-configurable opt-in, changes cannot stop inside the bridge. `plugins/provider-acp/src/agents.ts` has a strict custom-agent schema, and `declaration.ts` builds the bridge options. Add a `steeringMode` field there and pass it through to `acpSteeringMode`; test real settings-to-session propagation. Update the owning ACP skill, provider guide template, `docs/configuration.md`, and the existing Plugin Guide surface/SDK audit documentation as applicable. Keep the option available through existing plugin config CLI and SDK surfaces. The delivery label rides the existing delta/event pipeline; the only daemon wire change is the new event type, covered by the version bump above.

Required behavioral coverage:

1. Native steer is observed during a multi-iteration prompt with zero cancels, one BB start/completion, and prompt writes in arrival order.
2. Queue-only and unadvertised agents never receive an overlapping prompt. Parameterize existing provider dialects, generic/custom, DSH, and Amp behavior.
3. Declaration, Devin, explicit mode, false/malformed metadata, wrapper commands, and command-input exceptions resolve as designed.
4. Multiple injected responders resolve before/after the primary in every relevant order; completion waits for the group; accepting another input during drain is not lost.
5. Proven busy rejection falls back once, permanently disables native injection for that connection, and preserves input/acceptance order. A fresh connection can negotiate again.
6. Arbitrary invalid parameters, disconnect after write, malformed responses, and timeouts never trigger replay. Mixed acceptance/rejection is visible and does not duplicate an accepted input.
7. Steer during initial preparation, final response, tier transition, stop, release, session replacement, and compaction cannot target the wrong turn or be resurrected by an old callback.
8. Tier unchanged emits no setter; real tier changes are applied before the sequential continuation; stacked tier changes preserve arrival order.
9. Native steer preserves pending approval; explicit cancellation cancels it; late approval responses are ignored after teardown.
10. Prompt-write failure emits no false acceptance; retry emits at most one acceptance; instruction prefixes, images, slash commands, and partial streaming output remain correct.
11. Runtime/daemon stale recovery submits an unsent late input once, and never resubmits a native input already written.
12. Keep the supplied Devin single-inference counterexample in the acceptance notes. Do not label a matching response ID as proof that the model consumed the steer.
13. Native inputs show Steer; actual cancel-and-reprompt inputs show “降级为中断并发送”, including runtime fallback and tier/command exceptions; inputs delivered after natural completion show the queued label, not interruption. Failures must not claim interruption or success. Existing send, queue, keyboard, CLI, and SDK action semantics remain unchanged.

Run relevant Turbo typecheck/tests through the repository's resource isolation wrapper, one scoped job at a time, once implementation exists. Use controllable fake-agent barriers for races rather than elapsed-time guesses. Reprobe Devin with a multi-iteration task for live acceptance. Product commits still require the independent-branch autoreview, fork publication, and registered cherry-pick workflow before aggregation. This design document alone does not mark a feature as verified or request deployment.
