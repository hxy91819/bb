# ACP mid-turn steering design

Status: design proposal; no product implementation or provider compatibility claim from tests. Revised after user feedback: the next-iteration limitation is accepted, but an attempted native steer must never silently become cancel-and-reprompt.

Reviewed source: local aggregate `a4923f542`. This document lives on the independent `fix/acp-mid-turn-steering-design` worktree, based on `desktop-v0.43.1` (`267938526`). The aggregate includes additional ACP service-tier, goal, and DSH work beyond that tag; an implementation must account for those dependencies explicitly rather than use the aggregate as an upstream PR base.

## Decision and guarantee

Use hybrid gating (C) to determine native steering availability. Send concurrent `session/prompt` only when the live agent positively advertises the supported steering extension, a tested dialect supplies that contract, or an explicit provider setting asserts it. Other agents retain cancel-and-reprompt as an explicitly named delivery action. Capability detection does not authorize interrupting a running turn. Never learn support by submitting a user steer to an unknown agent and observing success.

There is no portable ACP v1 acknowledgment proving that the running inference consumed a concurrent prompt. Response order or elapsed time, an echoed user message, and matching vendor message IDs do not establish that fact. A queueing agent can accept immediately and emit similar observations. A real steering agent can defer consumption until another model iteration. Consequently B cannot meet the no-silent-queueing requirement. A misses Devin.

The achievable guarantee is delivery to a provider's documented next-iteration steering path, without BB cancelling that path. It is not preemption of a streaming inference or a running tool. The user's Devin v3000.10.31 probe establishes next-iteration consumption, but also shows that a final inference with no subsequent iteration may leave the input for a later turn. ACP v1 cannot detect or repair that case generically without risking duplicate delivery. If acceptance instead requires consumption before the current turn ends in every case, Devin cannot satisfy it over this interface.

The reviewed [ACP v1 lifecycle](https://agentclientprotocol.com/protocol/v1/prompt-turn) specifies prompt completion and cancellation, not a normative concurrent-prompt steering acknowledgment. [The inject RFD](https://github.com/agentclientprotocol/agent-client-protocol/pull/1261) must not be treated as an available v1 method.

## User-visible delivery contract

Expose three distinct actions while an ACP agent is working: **Steer** (send through the native next-iteration path), **Interrupt and send** (cancel current work, then submit the input), and **Queue** (wait for completion). The composer action label and keyboard-action hint must identify the selected behavior before submission. For an agent without verified native support, show native steer as unavailable and offer the other actions by their real names. Do not put interrupt behavior behind a button still labeled Steer.

Selecting Interrupt and send is sufficient authorization; no additional confirmation dialog is needed. A user can deliberately save that delivery preference, and the composer must continue to display it. An automatic capability policy, an old implicit fallback, or merely sending a native steer is not such authorization.

If advertised native support is rejected at runtime, keep the original turn running, mark that input failed, preserve its text, and offer explicit Interrupt and send or Queue actions. Publish the changed capability for subsequent inputs. Do not send `session/cancel`, withdraw permissions, or retry the input automatically. For ambiguous delivery after a transport failure, display an unknown-delivery outcome rather than assert that a retry is safe.

Persist requested and actual delivery with each input so the timeline, CLI, and SDK expose the same facts. Show Native steer submitted, Interrupted and sent, Queued, or Failed/Delivery unknown as applicable. Submitted is not a claim that the model has read the message. A next-turn delivery caused by a natural completion race must also be represented honestly. A tooltip, transient toast, or log-only warning is insufficient to identify a consequential delivery choice.

The server owns the selected delivery policy and persisted outcomes; the bridge reports session-local capability and transport results and enforces the requested action. Native support is per session and can change, so the UI cannot infer it solely from provider name or a static handshake. A stale UI capability must lead to a visible native-steer rejection, never automatic interruption. CLI/SDK requests for native steer have the same strict semantics and an explicit interrupt action. This intentionally changes the old implicit ACP fallback contract; document migration for existing automation instead of silently retaining cancellation behind a native-steer request. Non-ACP provider semantics are outside this change.

## Gates

Introduce a typed provider option `acpSteeringMode: "auto" | "interrupt" | "prompt"`, normalized once when constructing the session. This selects the native-capability policy, not an automatic fallback for individual messages. `prompt` is an operator assertion of steering semantics, not a discovery mode; `interrupt` disables native injection and exposes explicit interrupt delivery. Record the effective capability and its source for product surfaces and diagnostics. Keep any saved user delivery preference separate from this capability policy.

1. A session that has received a recognized concurrent-prompt rejection marks native steering unavailable until a fresh connection/initialize. This overrides positive configuration for the remainder of that connection but does not cancel the current turn.
2. Explicit `interrupt` always disables native injection; a message still needs an explicitly selected interrupt action to cancel current work.
3. Explicit `prompt` selects injection as an operator assertion. It should visibly diagnose conflicting negative metadata; reject a contradictory configuration rather than silently overriding an explicit false declaration. A queueing capability by itself never supplies the assertion.
4. In `auto`, literal top-level initialize `_meta.midTurnSteering === true` selects injection. Literal false overrides a dialect default. Absent or malformed metadata is not a positive declaration.
5. Otherwise enable native injection for a narrow Devin dialect backed by the supplied live probe; all remaining dialects expose native steering as unverified/unavailable. An explicit dialect setting keeps its existing precedence over executable-name inference. Wrappers such as `npx`, `uvx`, or shell scripts require an explicit dialect/setting; do not search arbitrary arguments for a vendor name.

Do not interpret `agentCapabilities._meta.claudeCode.promptQueueing` as steering. The [Claude issue](https://github.com/agentclientprotocol/claude-agent-acp/issues/871) specifically describes a next-turn queue. A future genuine steering declaration can coexist with a queue capability; queueing is not itself a permanent vendor denylist.

The historical [codex-acp PR #314](https://github.com/zed-industries/codex-acp/pull/314) describes the proposed extension, but was closed unmerged on June 23, 2026. Do not enable all binaries named `codex-acp` from that PR. Enable a running build only when it actually advertises the extension or is explicitly configured. The PR also excludes turn-starting slash commands from its injection path.

| Agent/configuration | Available delivery |
| --- | --- |
| Devin dialect, no contradictory metadata | Concurrent prompt, next-iteration semantics |
| Live agent advertising `midTurnSteering: true` | Concurrent prompt for supported ordinary inputs |
| Claude with only `promptQueueing` | Explicit interrupt-and-send or queue |
| DSH | Explicit interrupt-and-send or queue |
| User's Amp fork | Explicit interrupt-and-send preserves its `steerNextPrompt` implementation; a separately verified semantic contract could refine the label later |
| Cursor, OpenCode, OMP, Grok, Hermes, unknown/custom agents without affirmative evidence | Explicit interrupt-and-send or queue |

Gate by input as well as agent. Until specifically verified, turn-starting commands such as `/compact`, `/init`, and `/review*` are ineligible for native steering; explain the required action before submission or reject a strict native request without interrupting the turn. Do not let an agent silently serialize such a request merely because its normal-text steering gate passed. Attachment support must be tested for each asserted contract; do not infer steer attachment support solely from ordinary prompt support.

## Turn ownership and request lifecycle

Use one turn context per BB turn, with an identity/generation, a phase, the current primary prompt, tracked injected requests, an ordered collection of unsent inputs, terminal outcome, and a settlement promise. Keep active compaction separate. Each input carries an arrival sequence, client request ID, and acceptance-emitted state. Bind every asynchronous callback to the originating session object and turn context.

The context separates two independent facts: whether an underlying ACP prompt is still running, and whether outstanding requests/bookkeeping still keep the BB turn open. Replace the single `promptRequestPending` boolean with explicit primary/injection request ownership; one request settling cannot clear another request's pending state.

### Admission and acknowledgment

- Keep the existing short-lived BB `turn/steer` response: it means the bridge has admitted responsibility for the input into the current BB turn. Never wait for the injected ACP prompt's terminal response. Devin and dissolve implementations can keep that response pending for the whole turn. Runtime awaits the BB response, even though `runThreadOperation` is an operation counter, not a mutex.
- Admission records the input and its explicitly requested delivery against a live context and responds promptly. On the normal native path, admission, synchronous content preparation, request registration, write, and acknowledgment occur without awaiting a previous prompt. Explicit interrupt delivery retains the legacy immediate acknowledgment before its queued input is sent.
- `input.accepted` continues to mean the prompt carrying the input was submitted to the ACP transport, not model consumption. Emit it once per client request ID when that write succeeds. An admitted but unsent input must never produce this delta. A later provider rejection needs a correlated per-input failure outcome; it must not disappear merely because transport submission was already recorded. User-requested retry must have explicit request ownership and never duplicate timeline acceptance.
- The current `connection.request()` returns a Promise even when the connection is already closed, and `writeLine()` cannot report successful submission. Add a narrow transport submission callback/result so bridge acceptance is tied to an actual writable-stream submission. A `stdin.write()` return value of false is backpressure, not failure. Neither a successful write nor its callback is agent-level acceptance.
- Validate/build content before mutating ownership that cannot be recovered. `buildPromptContentBlocks()` consumes `pendingInstructions`; retain the built payload for an admissible retry instead of rebuilding it and duplicating or losing one-time instructions.

### Scheduling and finishing

Use a FIFO dispatcher for admission/write ordering, separate from response settlement. Write S1 and S2 in arrival order without awaiting S1's response. Attach a rejection handler to every response immediately. A Promise chain that waits for complete prompt responses would reproduce queue-next delivery.

Native inputs already written are never also stored in `queuedInputs`. That collection is for inputs not yet written, including legacy continuation and turn-start preparation. Steers arriving while the initial prompt is being prepared may be staged; after the primary is submitted, dispatch them promptly according to the selected mode.

The primary terminal result closes admission to that particular ACP prompt, not the entire BB turn. Already-admitted unsent work remains owned by the same BB turn. Once the current request group drains, it becomes a normal sequential continuation, as today's loop already permits. A steer arriving while that BB turn is draining follows this same explicit continuation rule; do not classify it as an in-flight injection. Do not start that continuation while old injected requests are outstanding.

If the BB turn was already closed when a request is admitted, return the existing `NO_ACTIVE_TURN` plus `staleTurn` before writing any payload. There must be no await between the native send's final local liveness check and transport submission. Recheck session/turn identity after any awaited preparation. A remote turn can still end between local check and receipt; accept the single agent response and never resend solely because its timing suggests that race.

Finish only when the primary and all submitted injections have settled, there is no admission/preparation work, and no owned unsent continuation remains. This must be a live barrier, not a one-time `Promise.all` snapshot taken before later steers arrive. Emit exactly one BB completion. The primary is authoritative for a successful shared prompt group's stop reason; injection errors cannot be hidden by a successful primary. Conflicting terminal results are diagnosed as a contract violation. A deliberate interrupt-and-continue group does not complete the BB turn; the final continuation supplies its terminal result.

`finishTurn(context)` must be idempotent and identity-checked. Stopping invalidates admission first, drops unsent work, cancels permissions, sends cancellation, and uses the existing bounded stop/kill behavior. Session release/replacement invalidates old contexts; callbacks from them must not clear state or emit completion for a new turn. `turnSettled` includes injected requests. Do not wait indefinitely after explicit stop just because an injected responder never resolves.

## Native rejection and explicit retry

A native-steer rejection never authorizes automatic cancel-and-reprompt. A known error contract establishing that the concurrent prompt was rejected before acceptance, such as the exact DSH busy rejection (error type/code plus narrowly recognized message), permits disabling native steering and offering a safe explicit retry. Generic `invalidParams` is insufficient: malformed content can produce the same code. Preserve structured error data at the connection boundary if classification needs it.

On a recognized rejection, disable injection for this connection, stop further native dispatch, and report the rejected input plus any affected unsent native inputs as failed with their text preserved. Keep the primary prompt, pending permissions, and already-submitted injections running and track their individual results. Cancel and resend only if the user subsequently chooses Interrupt and send. If the original prompt has already ended by that action, submit a normal new prompt and record that actual delivery instead; there is nothing to cancel.

With several concurrent steers, responses may arrive in arbitrary order. Track each independently; never put the entire batch back into the queue. If an earlier steer is rejected while a later steer was accepted, show their separate outcomes. An explicit later retry is a new user decision, not an automatic restoration of the original order. Capability invalidation must propagate to the composer and CLI/SDK inspection surfaces.

Do not replay on transport loss, timeout, malformed response, arbitrary provider errors, or missing/delayed echoes. Those do not prove nonacceptance. Errors after the BB RPC was acknowledged require a visible correlated input outcome; do not attempt a second RPC response. A rejected steer alone must not invoke `emitSessionError`, which currently settles the original turn. Add/use a per-input failure path that leaves a healthy primary running. Genuine session failure remains terminal and must settle the group once, despite rejecting every pending Promise. Unknown delivery must remain distinguishable from definite rejection.

Avoid a timing heuristic that cancels an apparently slow injection. It would cancel valid long-running steers and still could not distinguish a fast queueing agent.

## Service tier and permissions

Use the effective native config value, not merely the requested tier in `construction`, to decide whether a setter is necessary. Skip redundant `session/set_config_option` calls when no setting change is needed.

For a steer with a real tier change that cannot be applied natively mid-turn, do not silently interrupt or ignore the change. Before sending, offer Interrupt and apply settings, or Steer with current settings and defer the change until the next normal prompt. A strict native request carrying an incompatible immediate tier change is rejected without cancelling current work. Once interrupt delivery is explicitly selected, cancel/drain, call `applyAcpServiceTierForTurn`, and submit the continuation in order. Do not globally downgrade the agent's native capability because this input requires different settings. An agent with no native tier mapping retains the existing no-op behavior; do not claim native application there.

For ordinary native injection, do not call `cancelPendingPermissions` and do not set `cancelRequested`. Existing permissions belong to the continuing turn. The current permission handler otherwise rejects subsequent requests whenever that flag is true. A steer does not grant an approval or abort a running tool. If the provider cannot advance until an approval is answered, the steer waits for that boundary; preserve the interaction and test it. BB's normal server submission path already queues new messages while an interaction is pending, so expose that waiting state separately from native submission. Explicit interruption, stop, and release retain permission cancellation. These semantics align with the [ACP cancellation contract](https://agentclientprotocol.com/protocol/v1/prompt-turn).

## Runtime and translation implications

`packages/agent-runtime/src/runtime.ts:steerTurn` converts `staleTurn`/`NO_ACTIVE_TURN` to stale and clears its turn state. `apps/host-daemon/src/command-handlers/thread.ts:steerSubmittedTurn` can then submit the same input as a new turn. Never return stale after an injection was submitted or after the bridge admitted responsibility and acknowledged it. Otherwise recovery can execute the same input twice.

Do not introduce delayed stale responses from background injection callbacks. Test late admission and successful injection followed by turn completion through the real runtime/daemon path. If asynchronous admission checks are introduced, also guard runtime state clearing against erasing a newer active turn and recheck the expected turn immediately before dispatch; `runThreadOperation` does not provide serialization.

Maintain one translator context through the entire BB turn. Do not synthesize turn-open/turn-close or reset tool tracking per injected response. Usage notifications remain session-scoped updates; do not count the same shared result once per responder. User-message echoes and vendor IDs are optional diagnostics, not consumption acknowledgments or identities for deduplicating BB input.

The bridge-wide initialize `steerMode` is insufficient: its present field is process-wide and unconsumed, while actual native availability is per live ACP session and can be invalidated. Add typed per-session capability reporting and correlated delivery outcomes consumed by runtime, daemon, server, UI, CLI, and SDK. Do not infer native availability from the legacy global field. This reporting is now required by the user-visible contract, not deferred follow-up work.

## Change map and verification

| File/function | Intended work |
| --- | --- |
| `packages/provider-bridge-acp/src/wire.ts`, `wire.test.ts` | Parse the actual steering metadata location tolerantly; require literal true; distinguish malformed/absent metadata and explicit false. Preserve unknown vendor metadata. |
| `packages/provider-bridge-acp/src/dialect.ts`, `dialect.test.ts` | Add the narrow Devin steering contract and input eligibility; preserve existing dialect resolution and defaults. |
| `packages/provider-bridge-acp/src/session-params.ts`, tests | Carry the normalized mode into session construction and reconstruction. |
| `packages/provider-bridge-acp/src/bridge/bridge.ts` | Update `AcpThreadSession`, `startAgentSession`, provider-option parsing, `turn/steer`, `runTurn`, `requestSteerCancel`, acceptance/drop handling, `finishTurn`, stop/release, and tier-transition dispatch. |
| `packages/provider-bridge-acp/src/bridge/agent-connection.ts`, tests | Report local submission separately from terminal response; retain typed error details when needed. |
| `packages/provider-bridge-acp/src/bridge/fake-acp-agent.mjs`, `bridge.test.ts` | Controllable dissolve, queue-only, reject-busy, response-order, permission, config, and failure modes; assert externally visible behavior. |
| `packages/provider-bridge-acp/src/delta-translation.test.ts` | Verify one continuous turn/tool stream and no duplicated acceptance or usage from multiple responders. Production translator changes only if tests expose a need. |
| Bridge protocol, agent-runtime, and host-daemon contracts/dispatch | Carry native availability, explicitly requested delivery, actual outcome, and non-turn-settling per-input rejection. Enforce no implicit cancellation and retain safe stale recovery. |
| Server submission/events and SDK | Own delivery policy and persistence; expose explicit native, interrupt, and queue requests and correlated results. |
| App composer/timeline and CLI | Show the selected action before submission and durable actual outcomes; preserve failed text and offer explicit retry. |

For user-configurable opt-in, changes cannot stop inside the bridge. `plugins/provider-acp/src/agents.ts` has a strict custom-agent schema, and `declaration.ts` builds the bridge options. Add a `steeringMode` field there and pass it through to `acpSteeringMode`; test real settings-to-session propagation. Update the owning ACP skill, provider guide template, `docs/configuration.md`, and the existing Plugin Guide surface/SDK audit documentation as applicable. Keep configuration and message actions available through CLI and SDK. The revised design includes daemon wire changes: increment `HOST_DAEMON_PROTOCOL_VERSION` unless compatibility with the previously shipped daemon is deliberately preserved and tested. An old daemon must not silently reinterpret a new native-steer request as cancellation. This is an ACP delivery feature across the existing layers, not a redesign of non-ACP providers.

Required behavioral coverage:

1. Native steer is observed during a multi-iteration prompt with zero cancels, one BB start/completion, and prompt writes in arrival order.
2. Queue-only and unadvertised agents never receive an overlapping prompt. Strict native requests produce no cancellation; explicitly selected interrupt delivery retains legacy behavior. Parameterize existing provider dialects, generic/custom, DSH, and Amp behavior.
3. Declaration, Devin, explicit mode, false/malformed metadata, wrapper commands, and command-input exceptions resolve as designed.
4. Multiple injected responders resolve before/after the primary in every relevant order; completion waits for the group; accepting another input during drain is not lost.
5. Proven busy rejection invalidates native support, emits a correlated failure, preserves input text, and leaves the primary and permissions running with zero cancels/replays. Explicit retry is a separate request. A fresh connection can negotiate again.
6. Arbitrary invalid parameters, disconnect after write, malformed responses, and timeouts never trigger replay. Mixed acceptance/rejection is visible and does not duplicate an accepted input.
7. Steer during initial preparation, final response, tier transition, stop, release, session replacement, and compaction cannot target the wrong turn or be resurrected by an old callback.
8. Tier unchanged emits no setter; incompatible immediate tier changes never cancel on a native request. Explicit interruption applies the change before continuation; explicitly deferred settings wait for the next normal prompt.
9. Native steer preserves pending approval; explicit cancellation cancels it; late approval responses are ignored after teardown.
10. Prompt-write failure emits no false acceptance; retry emits at most one acceptance; instruction prefixes, images, slash commands, and partial streaming output remain correct.
11. Runtime/daemon stale recovery submits an unsent late input once, and never resubmits a native input already written.
12. Keep the supplied Devin single-inference counterexample in the acceptance notes. Do not label a matching response ID as proof that the model consumed the steer.
13. UI, CLI, and SDK identify native/interrupt/queue before action and expose durable actual outcomes afterward. Runtime capability changes update the composer, and a stale native action cannot trigger cancellation. Verify old-daemon compatibility or rejection, saved explicit preferences, and ACP automation migration.

Run relevant Turbo typecheck/tests through the repository's resource isolation wrapper, one scoped job at a time, once implementation exists. Use controllable fake-agent barriers for races rather than elapsed-time guesses. Reprobe Devin with a multi-iteration task for live acceptance. Product commits still require the independent-branch autoreview, fork publication, and registered cherry-pick workflow before aggregation. This design document alone does not mark a feature as verified or request deployment.
