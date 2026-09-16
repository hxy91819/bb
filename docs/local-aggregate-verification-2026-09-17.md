# Stable aggregate verification — 2026-09-17

## Scope and state

Baseline: `desktop-v0.43.1` / `267938526dfcbc0edb228ce827b5bec202c1af97`.
The audited upstream tip has 118 unreleased commits beyond the stable release; none are integrated.
The rebuild contains 13 source branches and 35 `cherry-pick -x` commits.
The registry and AGENTS overview agree, including the maintenance authorization from `4bfdec0647cc94f66485550b02ce374a8155226e` and the service-only approval boundary from `4f24e79314ee8fc7b7936ac28b90d675f5ef7fa8`.
This is candidate verification, not runtime-package or deployment proof.

The root snapshot being replaced is `4f24e79314ee8fc7b7936ac28b90d675f5ef7fa8`.
Its unrelated untracked work is preserved.
The dirty migration-guard experiment is excluded and preserved; it has no new committed product delta.
The older rebuild worktree is retained. The current temporary candidate may be removed after its exact tip is published and no live process uses its directory; this does not authorize broader source-worktree or backup cleanup.

## Source evidence

Prior targeted checks are reused where the source or affected trees are unchanged.
Earlier source checks that ran without the resource scope are not represented as successful isolation checks.
The new Fast rewind and stable-metadata regression checks ran through the resource runner.
All source worktrees are clean.

| Source branch | Final source SHA | Aggregate SHA | Verification | Autoreview |
| --- | --- | --- | --- | --- |
| `feature/mermaid-elk-layout` | `e3460182b52a69ce9f5ef071b231f52c2aed999f` | `df1d1972f1f972d3740b80d95106bdef25dad879` | 5 Mermaid tests; app typecheck. | `20260916T231522Z-be3365` |
| `fix/vite-cve-2026-39363` | `42097e0e2a18ba697237567ddeb029b33cab3a20` | `52bba2fc32ad5c55cd7312fb98f51fdd38fa1a6c` | pnpm dependency paths: scoped Vite 6.4.3; direct Vite 8.0.12 retained. | `20260916T231831Z-176c93` |
| `fix/local-aggregate-server-startup` | `b11109ea34db7d3f86b6fea684f62f9a374d003a` | `31d189905527f79510d16d200d6ec183a85f7733` | 21 startup-related tests; server typecheck. | `20260916T231833Z-f7cc97` |
| `fix/codex-fast-mode-toggle` | `200adda3e16c78edfe3f8f764aec2a2cb0d372e8` | `2c63d38e010877b7ea002cf5c43a96feefe2b5a2` | 38 app + 83 server tests; app/server/DB typecheck; corrected rewind fixture: 57 migration tests. | `20260916T231834Z-e5d5a2` |
| `feature/recent-explicit-work-sequence` | `0c0cfbe071742a7fff01f258938595a63dd9e325` | `7f977eae2db73c92f7fe4a4b2de917922153fa7e` | 8 app + 10 server tests; app/server typecheck; final rebase tree unchanged. | `20260916T231835Z-24bdeb` |
| `fix/local-aggregate-service-tier-migration` | `934b0800cf5794004a95ba75fe2cd573e31e229c` | `fa690d3ac5183f98022978e72df5aeb805c0a189` | 59 migration tests; DB typecheck; final dependency rebase tree unchanged. | `20260916T231837Z-813b9e` |
| `fix/local-aggregate-recent-sequence-migration` | `c4ba8d541ede23cae2d0e30d524b7a6b94e23b2e` | `f0aff25a876a19f1f899e876e7dfdf4b8db2d79d` | 502 DB tests in 39 files; DB typecheck; reproduced skipped stable plugin metadata before fixing; final dependency rebase tree unchanged. | `20260916T231838Z-ba5d4a` |
| `feature/dsh-acp-provider` | `53471331926ef585037d82259c318931cfa8947a` | `c4aeed2952c94015b61207a0a0b90ba3af73a3f7` | 144 bridge/wire/model + 15 agent tests; ACP bridge typecheck. | `20260916T231840Z-ace261` |
| `fix/acp-fast-mode` | `f82a355069870fc9e40fd19b11c6dea92067393b` | `c9d64614bacc43ec55a44aca7fdfd7296c004973` | 143 focused ACP tests; ACP bridge typecheck. | `20260916T231841Z-c83d92` |
| `fix/acp-codex-goal` | `3f755edd4ebfbd2d63a2f8e00be67e608f5ce35e` | `52fc78e04737ba54453bf7729af72b26c449889d` | 182 bridge/delta + 5 goal-snapshot tests; ACP bridge typecheck. | `20260916T231843Z-d87d53` |
| `fix/markdown-table-breakout` | `b14e93e3d85d015908a115402ed8b34800efec1b` | `19b1104a47477a49b495439051df196c7f28d2b7` | 17 table tests; app typecheck. | `20260916T231844Z-72e987` |
| `fix/environment-switch-auto-continue` | `4edc380015496d22ee64d93c85294f8d5726ee8a` | `9ec663a50405a4e80d4cfb4d26b8eda51d5210bc` | 157 server + 12 Pi bridge tests; both package typechecks. | `20260916T155556Z-1e3e67` |
| `feature/thread-project-label` | `a268b26c7be5da45b6c79e0254adfa4a4a053fa2` | `4da88e8daa19929b16680c9cba7838b5f6b2c7dc` | 93 app tests; app typecheck; lint: 0 errors (191 existing warnings). | `20260916T161748Z-3d411f` |

The 11 rebased branches received host self-review through the autoreview structured-result helper, with no accepted/actionable findings. No other agent or thread was created. The unchanged environment-switch and project-label branches retain their previous clean reviews.
Reviewer independence: none (subagent shares the author model/context).
The helper's engine label describes the handoff format; the current host performed these reviews itself under the no-delegation instruction.
Maintenance closeout: `20260916T233256Z-29ba31`, no accepted/actionable findings. A suspected build-environment issue from `20260916T233200Z-2670ad` was rejected after checking that the heavy app build explicitly permits `NODE_OPTIONS`; the observed native typecheck failures do not justify broadening all runtime build environments.

## Combined verification

The serialized candidate build and typechecks passed: 14 Turbo tasks, 10 cached. The scope used the existing `package` profile and `--concurrency=1`; app/server/CLI/ACP/Pi/DB typechecks all completed. App, server and CLI artifacts were built only in the candidate checkout.

Combined checks ran serially through the root resource runner, with Turbo executing in the candidate checkout:

- App interactions: 114 tests in 7 files, covering project ordering, labels, pinned thread trees, header controls and Fast mutations.
- Server interactions: 230 tests in 8 files, covering explicit-work eligibility/promotion, environment switches, queued dispatch, stop/retry, public thread state and tool-call completion.
- CLI thread-update behavior: 10 tests, including Fast service-tier updates.
- App lint: 0 errors; 191 existing warnings.
- Shell and Node syntax checks passed for the retained maintenance scripts.
Already checked: 35 source trailers, all 13 registry/AGENTS mappings, and generated migration snapshot structure.
The generated snapshots add only `threads.service_tier_override` in `0119_military_taskmaster` and `projects.recent_explicit_work_sequence` in `0120_stale_chamber`.
ACP bridge and Pi source trees exactly match their individually verified final source branches.
The DB migration files and implementation exactly match the 502-test source tree; environment continuation adds only queued-message data operations and exports.

Three aggregate typecheck attempts were terminated by systemd-oomd; another was cancelled after identifying that the actual compiler is native TypeScript 7, not the Node compiler. Neither Node heap limits nor a 2 GiB Go soft limit kept compilation below the verification profile's 3 GiB pressure threshold. These attempts are failed checks, not successful validation.
The successful serialized candidate build used `scripts/run-resource-isolated --profile package --`, `GOMEMLIMIT=4GiB`, `NODE_OPTIONS=--max-old-space-size=4096`, and Turbo `run build typecheck --env-mode=loose --concurrency=1`, with filters for `@bb/app`, `@bb/server`, `@bb/cli`, `@bb/provider-bridge-acp`, `bb-plugin-provider-pi`, and `@bb/db`.
The deployment resource-isolation preflight passed its finite verification/package limits, serialization, nested-scope refusal, detached-child containment, exit-code propagation, and bounded 96 MiB OOM probe. This candidate build does not replace the post-confirmation root runtime-build gate, including bundled plugins and host daemon.
The affected user service bus was recovered after checking that its child services were already gone; the BB source service was never restarted.

## Public release checks

The selected files received a targeted credential/path scan and manual diff review.
Matches were generic test paths and documented placeholders; no concrete credentials or local service configuration are included.
Gitleaks/TruffleHog are unavailable, so this is not a dedicated secret-scanner pass.
All new source and cherry-pick authors/committers use the approved public identity.
The full-history identity helper flags 112 pre-existing upstream identity mismatches and zero prohibited identities; upstream contributor history is intentionally not rewritten.

## Authorized handoff and deferred deployment

The user's resumed instruction authorizes root replacement and fork publication without another confirmation. Maintenance skill revision `6847f1fe04c32955895911e435131a572e2f4fda` and the equivalent AGENTS rule from `4f24e79314ee8fc7b7936ac28b90d675f5ef7fa8` establish that standing authorization. The previous second-confirmation requirement is superseded.
The verified product snapshot is unchanged from candidate `57b6c9da1becbf0b1b2c7fe259a8061dea7d0c49`; this handoff update changes only policy and records, so the completed product checks and source reviews are reused.
Preserve the old root with a recoverable backup ref, replace it without stash, destructive reset, or untracked-file removal, then publish to the personal fork. Re-read each remote SHA immediately before a rewritten push and use an explicit lease; verify every remote result.

The latest instruction explicitly excludes replacing or restarting the running production service. Earlier deployment authorization must not be reused. Root source replacement and publication are not proof of a deployed revision; keep existing dependencies and runtime artifacts untouched in this pass.
After separate service-cutover authorization, use the deployment skill for the resource probe, frozen dependency installation, serialized root runtime build, local checkpoint and migration backup, then health, running-revision, version and persistence checks. Resume outside the target service's cgroup before restarting it.
Broader post-cutover cleanup remains deferred; dirty or active worktrees stay protected.
