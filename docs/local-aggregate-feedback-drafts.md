# Pending upstream feedback

These drafts correct the feedback gaps identified on 2026-09-20. They have not been posted. Existing fork issues remain specifications; merely linking an upstream tracker does not mean the implementation has been reported there. Review each scope against its target issue before publication. This document does not claim fresh reproduction on current upstream main.

## Recent ordering — update get-bb/bb#1614

Target: https://github.com/get-bb/bb/issues/1614

The following replaces the description of the implementation in our earlier comment; it does not replace the original issue author's proposal.

---

Implementation update: my earlier comment described a browser-local promotion sequence. That version has been retired in the fork.

The current variant stores a server-owned project promotion sequence and publishes it to connected clients. Accepted explicit user work promotes its project; passive lifecycle changes do not. The optional Recent activity mode preserves pinned content first and falls back to shared manual order for projects without a promotion. Selecting Drag order continues to use the saved manual order.

This changes the scope of the earlier proposal: it adds a nullable database field and covers shared cross-device state and server-side entry points. The earlier statements that there is no database migration or synchronization no longer describe this variant.

- Specification: https://github.com/hxy91819/bb/issues/1
- Implementation: https://github.com/hxy91819/bb/tree/feature/recent-explicit-work-sequence

The fork also has historical database compatibility repairs required by its previously packaged migrations. Those repairs are deployment history, not a proposal to add the fork's migration ledger to upstream.

No fresh upstream-main browser reproduction or upstream integration validation is claimed by this update. The question for this issue is whether server-shared explicit-work recency is a useful direction, or whether the original browser-local scope should remain the upstream target.

> AGENT GENERATED

## ACP steering — supplement get-bb/bb#3151

Target: https://github.com/get-bb/bb/issues/3151

---

We have a fork implementation related to the ACP cancel-and-reprompt behavior described here. It is recorded at https://github.com/hxy91819/bb/issues/8 and implemented on https://github.com/hxy91819/bb/tree/fix/acp-mid-turn-steering.

The proposal enables concurrent prompt injection only when a provider advertises a compatible extension, an explicit configuration selects it, or a verified dialect supports it. It does not assume that standard ACP v1 or every Cursor/Grok session supports native steering. Unsupported inputs or providers retain interruption behavior, and a concurrent-prompt rejection switches that session back to interruption.

The implementation also records actual delivery as steer, interrupted, or queued, so the timeline reflects what happened. This is a cross-layer change involving bridge deltas, persisted events and their projections; it is not a one-line removal of session/cancel.

The original fork verification includes fake-agent lifecycle tests and a live Devin ACP exercise, as recorded in the fork issue. This comment does not claim a fresh reproduction of the Cursor/Grok report on current upstream main. The useful discussion is whether a capability-gated extension and explicit delivery labels fit the intended ACP behavior.

> AGENT GENERATED

## Pi directory relocation — supplement get-bb/bb#3187

Target: https://github.com/get-bb/bb/issues/3187

---

The fork work at https://github.com/hxy91819/bb/issues/7 overlaps the durable Pi session-directory relocation portion of this issue. Implementation: https://github.com/hxy91819/bb/tree/fix/environment-switch-auto-continue.

It relocates compatible persisted Pi sessions when replacing a thread's environment, including the case where the old session-header directory no longer exists. The same fork branch also adds an explicit once-only automatic continuation, superseded by explicit user input; that is a separate product behavior and can be discussed separately from the stale-directory bug.

The fork issue records server and Pi bridge regression coverage. This is not a claim that the branch fixes every original pending-tool-call symptom. An upstream contribution should demonstrate the acceptance cases already stated here: the switching tool settles, subsequent tools execute in the replacement directory while the old one exists, and resume still works after the old directory is removed. Fresh live-provider validation of those cases against the upstream baseline remains to be supplied.

> AGENT GENERATED

## Other pending classifications

DSH/grouped models, ACP Fast, ACP Goal, project labels, /side, pinned New thread navigation, touch title navigation, and UTC catalog dates retain `needs-feedback` in the registry. Their next step is a scope-specific upstream duplicate search and an appropriately evidenced proposal. They are not treated as reported merely because a fork specification exists. The registry remains authoritative for that list.

Fast selection-time persistence and hiding parent-row quick Archive remain `upstream-divergence`: upstream has already selected different behavior. Internal migration repairs do not need unrelated upstream issues. The automation marker retains the owner's existing fork-only decision.
