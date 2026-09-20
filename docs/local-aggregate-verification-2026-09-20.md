# Local Aggregate Verification — 2026-09-20

This report applies to the candidate rebuilt from `desktop-v0.43.3` (`e865697f56bea89f3413dd4cc7fae964850d20a0`) using [the frozen train manifest](../config/local-aggregate-trains/2026-09-20-desktop-v0.43.3.json). It is updated only with verification performed against this source combination.

## Focused regression evidence

- Database migration test suite: 590 tests passed, including interrupted Fast staging recovery, Recent value preservation, canonical stable-migration replay, and idempotent second migrations.
- App regression tests: 180 tests passed for the pinned New thread sidebar behavior, touch navigation, and theme contract.
- Server regression tests: 66 tests passed for thread default policy, project attachment accounting, and public-thread banners; 24 passed for plugin-provider registration, official marketplace dates, and plugin tool calls.
- ACP and Pi regression suites passed in their source worktrees: 358 ACP tests; 167 Pi tests passed and one was skipped.

## Package build and typecheck

The serialized `package` resource profile completed `turbo run build typecheck --env-mode=loose --concurrency=1` for `@bb/app`, `@bb/server`, `@bb/cli`, `@bb/provider-bridge-acp`, `bb-plugin-provider-pi`, and `@bb/db`: 14 tasks passed, four from the shared cache. The app, server, and CLI artifacts were built in the candidate checkout. Node was `v24.15.0` and pnpm was `9.15.0`.

## Required final checks

- [x] Candidate app typecheck and pinned-sidebar regression test.
- [x] Candidate package build and typecheck through `scripts/run-resource-isolated --profile package`.
- [x] Frozen candidate autoreview `20260920T103141Z-08815f` completed. Its one ACP fallback-loading P1 was rejected because the common `sessionId === undefined` fallback clears `loading`, `loadingSessionId`, and pending usage before `session/new`; no accepted/actionable candidate finding remains.
- [x] Provider pilot candidate `0f623a18f81511ed080da60369238e21f97675d9` passed the scoped Turbo behavior run: 358 ACP bridge tests and 86 provider-ACP plugin tests. The successful retry is `/tmp/two-tier-pilot-behavior-retry.log`; an earlier native-ABI repair process exited 139 before a fresh check and complete retry succeeded.
- [x] Extracted contribution `1efc7a952f21a6e7340d74cf32d02992686af356` passed the same scoped behavior run after a frozen/offline install: 358 ACP bridge tests and 86 provider-ACP plugin tests. The successful log is `/tmp/two-tier-contribution-behavior.log`; the earlier `/tmp/provider-contribution-check.log` contains only the failed manager-bus attempt.
- [ ] Close out any rebased source tip not covered by an existing source-level autoreview.
- [ ] Publish source branches and the aggregate ref to the personal fork, then record the final aggregate SHA and artifact credential.

## Credential scan limitation

TruffleHog verification did not pass. The binary was initially absent, and two official release downloads were rejected because their SHA-256 values did not match the published checksum. The temporary downloaded file was never executed. This limitation must remain open rather than being reported as a successful scan.

The test and package evidence above belongs to the exact `cc26cca6680fda183b08a7ec8145d060cb27f5f3` product candidate. The later two-tier maintenance-only combination requires structural reconstruction checks and a final package run by the release owner; this report does not treat the old package result as a new package credential.

No production source service was replaced or restarted. This is source and package verification only.
