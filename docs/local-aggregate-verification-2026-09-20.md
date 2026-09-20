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
- [ ] `$autoreview` for every rebased source and the frozen candidate.
- [ ] Publish source branches and the aggregate ref to the personal fork, then record the final aggregate SHA and artifact credential.

No production source service was replaced or restarted. This is source and package verification only.
