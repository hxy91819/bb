---
name: local-aggregate-deploy
description: Build the published BB local/aggregate and replace a configured local BB source service, with health checks and rollback. Use only for requested local service deployment or replacement validation; not for ordinary builds, development servers, or aggregation.
---

# Local aggregate deployment

Aggregation itself belongs to [Fork 维护](../../../docs/fork-maintenance.md) (`scripts/fork-aggregate --promote`). This skill starts from a published `local/aggregate` and ends with a healthy service. Replacing the running service always needs the user's explicit authorization for this run.

## 1. Select the target

Use the ignored `config/local-aggregate-web.json`, or `config/local-aggregate-web.<target>.json` when the request names a target. It holds the service unit, repo path, data directory, Node executable, bind host, and ports. Stop if the file is missing. Never copy it, its data, or secrets into Git or between targets. Service model and first-time setup: [docs/local-aggregate-web-maintenance.md](../../../docs/local-aggregate-web-maintenance.md).

## 2. Build (old service keeps running)

Build from a clean checkout whose HEAD equals `fork/local/aggregate`: the root checkout when it is clean, otherwise `git worktree add --detach <path> fork/local/aggregate`. Record the old running SHA and the new SHA for rollback.

```bash
scripts/run-resource-isolated --profile package -- <nodeExecutable> <node-bin>/pnpm install --frozen-lockfile
scripts/run-resource-isolated --profile package -- \
  <nodeExecutable> .bb/skills/local-aggregate-deploy/scripts/build-runtime.mjs --repo .
<nodeExecutable> scripts/ensure-native-modules.mjs --check
```

`build-runtime.mjs` refuses a dirty tree or a HEAD different from `fork/local/aggregate`, then builds only the SDK, app, server, host daemon, and bundled plugins with one Turbo task at a time. If the build is OOM-killed, leave the service running and retry after reducing competing load; never kill unrelated user processes. Before the first cutover on a machine, install `assets/oom-policy-continue.conf` as a drop-in for the unit and run `node .bb/skills/local-aggregate-deploy/scripts/test-resource-isolation.mjs`.

If the new aggregate changes the database schema, back up `<dataDir>/bb.db*` before cutover. Migrations run automatically at service start; do not run ad-hoc SQL against the ledger.

## 3. Cutover from outside BB

Restarting the BB service kills any BB thread doing it. A BB thread may do steps 1–2, then stops and gives the user a prompt for an agent started outside BB (terminal). That agent first checks it has no `BB_*` environment and is not inside the service's cgroup, then:

1. Points the unit's `WorkingDirectory` at the built checkout if it changed, `daemon-reload`, restarts the unit.
2. Polls server `/health` and host-daemon `/health`; checks the unit is `active`, runs from the configured repo path at the new SHA, and `NRestarts=0` after a short interval.
3. For changes touching persistence or provider parameters, runs one real API-level check against the service.

## 4. Failure and rollback

On a failed health gate: stop the restart loop, keep the data directory and unit journal, and switch the unit back to the recorded old checkout/SHA (restore the DB backup only if a migration broke it). Fix the problem in the owning `feature/*`/`fix/*` branch, re-aggregate, and deploy again. Never run two BB instances on the same data directory.

## 5. Cleanup

Afterwards, remove only worktrees that are clean, not used by the running service, and whose branch tip is on the fork. Use `git worktree remove` without `--force`; report anything dirty or unpublished instead of forcing it.
