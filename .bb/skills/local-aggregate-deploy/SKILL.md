---
name: local-aggregate-deploy
description: Build the published BB local/aggregate and replace a configured local BB source service, with health checks and rollback. Use only for requested local service deployment or replacement validation; not for ordinary builds, development servers, or aggregation.
---

# Local aggregate deployment

Aggregation itself belongs to [Fork 维护](../../../docs/fork-maintenance.md) (`scripts/fork-aggregate --promote`). This skill starts from a published `local/aggregate` and ends with a healthy service. Replacing the running service always needs the user's explicit authorization for this run.

## 1. Select the target

Use the ignored `config/local-aggregate-web.json`, or `config/local-aggregate-web.<target>.json` when the request names a target. It holds the service unit, repo path, data directory, Node executable, bind host, and ports. Stop if the file is missing. Never copy it, its data, or secrets into Git or between targets. Service model and first-time setup: [docs/local-aggregate-web-maintenance.md](../../../docs/local-aggregate-web-maintenance.md).

Compare the selected config with the actual system unit's ExecStart, WorkingDirectory, environment and drop-ins. The unit is authoritative for the installed target; an old config is a build input, not permission to replace the service with that old checkout. Preserve the unit's data directory, arguments, environment and mount requirements.

## 2. Build (old service keeps running)

`scripts/fork-package` normally leaves a built checkout at `.worktrees/aggregate-deploy-<short sha>` whose HEAD equals `fork/local/aggregate`; reuse it and skip to the cutover prompt it printed. Otherwise build from a clean checkout at that commit: `git worktree add --detach .worktrees/aggregate-deploy-<short sha> fork/local/aggregate`. Record the old running SHA and the new SHA for rollback.

```bash
scripts/run-resource-isolated --profile package -- <nodeExecutable> <node-bin>/pnpm install --frozen-lockfile
scripts/run-resource-isolated --profile package -- \
  <nodeExecutable> .bb/skills/local-aggregate-deploy/scripts/build-runtime.mjs --repo .
<nodeExecutable> scripts/ensure-native-modules.mjs --check
```

`build-runtime.mjs` refuses a dirty tree or a HEAD different from `fork/local/aggregate`, then builds only the SDK, app, server, host daemon, and bundled plugins with one Turbo task at a time. If the build is OOM-killed, leave the service running and retry after reducing competing load; never kill unrelated user processes. Before the first cutover on a machine, install `assets/oom-policy-continue.conf` as a drop-in for the unit and run `node .bb/skills/local-aggregate-deploy/scripts/test-resource-isolation.mjs`.

After a successful build and native-module check, complete the default [tag release steps](../../../docs/fork-maintenance.md#3-发布预编译聚合包) for the recorded new SHA and include the Release link in the handoff. Those steps define authorization, reuse of an existing release, and failure handling; service replacement still requires the authorization above.

If the new aggregate changes the database schema, back up `<dataDir>/bb.db*` before cutover. Migrations run automatically at service start; do not run ad-hoc SQL against the ledger.

## 3. Cutover from outside BB

Restarting the BB service kills any BB thread doing it. A BB thread may do steps 1–2, then stops and gives the user a prompt for an agent started outside BB (terminal). That agent first checks it has no `BB_*` environment and is not inside the service's cgroup, then:

1. Selects the same installation model as the old unit: a built source checkout for a source unit, or a downloaded, checksum-verified and smoke-tested Release package for an installed launcher. Runs `node scripts/fork-cutover.mjs <target-config.json> <target-directory> <verified-source-sha>` to generate a read-only replacement and rollback plan. The generator checks the actual unit against the selected drop-in and changes both ExecStart and WorkingDirectory; it refuses mismatched source/package targets. Preserve the saved old drop-in for rollback. Stop the unit, back up data, apply the replacement, daemon-reload and start it.
2. Polls server `/health` and host-daemon `/health`; checks the unit is `active`, actual ExecStart and WorkingDirectory identify the new source/package, `/api/v1/system/version` matches the intended version, and `NRestarts=0` after a short interval. For a Release package, require release.json.source to equal the verified aggregate SHA. Health alone cannot distinguish a healthy old package from the new one.
3. For changes touching persistence or provider parameters, runs one real API-level check against the service.

## 4. Failure and rollback

On a failed health or identity gate: stop the new unit, keep the data directory and unit journal, restore the saved old drop-in including both pointers, daemon-reload and start it (restore the DB backup only if a migration broke it). Fix the problem in the owning `feature/*`/`fix/*` branch, re-aggregate, and deploy again. Never run two BB instances on the same data directory.

## 5. Cleanup

Afterwards, remove only worktrees that are clean and not used by the running service: superseded `aggregate-deploy-*` checkouts are regenerated artifacts and can go once the service runs elsewhere; feature worktrees must have their branch tip on the fork. Use `git worktree remove` without `--force`; report anything dirty or unpublished instead of forcing it.
