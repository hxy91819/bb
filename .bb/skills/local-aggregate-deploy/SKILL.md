---
name: local-aggregate-deploy
description: Build the published BB aggregate and replace a configured local BB source service, with health checks and rollback. Use only for requested local service deployment or replacement validation; not for ordinary builds, development servers, aggregation, or provider/dispatch configuration.
---

# Local aggregate deployment

Aggregation itself belongs to [Fork 维护](../../../docs/fork-maintenance.md) (`scripts/fork-aggregate --promote`). This skill starts from a published `aggregate` and ends with a healthy service and a matching machine CLI. Replacing the running service requires authorization for that target. Reuse authorization already granted in the session.

## 1. Select the target

Use the ignored `config/local-aggregate-web.json`, or `config/local-aggregate-web.<target>.json` when the request names a target. It holds the service unit, repo path, data directory, Node executable, bind host, ports, and the machine CLI account home and existing enrollment data directory (`machineCli.home` and `machineCli.dataDir`). The enrollment directory is separate from the server data directory. Stop if the file is missing. Never copy it, its data, or secrets into Git or between targets. Service model and first-time setup: [docs/local-aggregate-web-maintenance.md](../../../docs/local-aggregate-web-maintenance.md).

Compare the selected config with the actual system unit's ExecStart, WorkingDirectory, environment and drop-ins. The unit is authoritative for the installed target; an old config is a build input, not permission to replace the service with that old checkout. Preserve the unit's data directory, arguments, environment and mount requirements.

Every authorized environment upgrade also follows the [external plugin update checklist](../../../docs/feature-index.md#升级时同步外置插件). Inspect actual sources and remote revisions, including local path plugins that `bb plugin update --all` skips. Prepare compatible updates before cutover and finish deferred updates after the new server is healthy; retain settings, data and enabled states.

## 2. Build (old service keeps running)

`scripts/fork-package` normally leaves a built checkout at `.worktrees/aggregate-deploy-<short sha>` whose HEAD equals `origin/aggregate`; reuse it and skip to the cutover prompt it printed. Otherwise build from a clean checkout at that commit: `git worktree add --detach .worktrees/aggregate-deploy-<short sha> origin/aggregate`. Record the old running SHA and the new SHA for rollback.

```bash
scripts/run-resource-isolated --profile package -- <nodeExecutable> <node-bin>/pnpm install --frozen-lockfile
scripts/run-resource-isolated --profile package -- \
  <nodeExecutable> .bb/skills/local-aggregate-deploy/scripts/build-runtime.mjs --repo .
<nodeExecutable> scripts/ensure-native-modules.mjs --check
```

`build-runtime.mjs` refuses a dirty tree or a HEAD different from `origin/aggregate`, then builds only the SDK, app, server, host daemon, and bundled plugins with one Turbo task at a time. If the build is OOM-killed, leave the service running and retry after reducing competing load; never kill unrelated user processes. Before the first cutover on a machine, install `assets/oom-policy-continue.conf` as a drop-in for the unit and run `node .bb/skills/local-aggregate-deploy/scripts/test-resource-isolation.mjs`.

After a successful build and native-module check, complete the default [tag release steps](../../../docs/fork-maintenance.md#3-发布预编译聚合包) for the recorded new SHA and include the Release link in the handoff. Those steps define authorization, reuse of an existing release, and failure handling; service replacement still requires the authorization above.

If the new aggregate changes the database schema, back up `<dataDir>/bb.db*` before cutover. Migrations run automatically at service start; do not run ad-hoc SQL against the ledger.

## 3. Cutover from BB or an external agent

A BB thread may initiate an authorized service replacement and finish verification after it resumes. The running turn is interrupted during cutover. The installed [upgrade-resume plugin](https://github.com/hxy91819/bb-plugin-upgrade-resume) continues recorded threads after BB starts; it cannot start a stopped server. Give the service manager the complete stop, backup, replacement, start, verification and rollback sequence before stopping BB.

Provider settings, named account bindings and dispatch aliases that take effect without a service restart can be configured and verified directly inside BB within the user's existing authorization. Use the provider's own skill and core CLI for those changes.

### Prepare while BB is running

1. Select the same installation model as the old unit: a built source checkout for a source unit, or a downloaded, checksum-verified and smoke-tested Release package for an installed launcher. Run `node scripts/fork-cutover.mjs <target-config.json> <target-directory> <verified-source-sha>` to generate the read-only replacement and rollback plan. The generator checks the actual unit against the selected drop-in and changes both ExecStart and WorkingDirectory; it does not execute the cutover. Preserve the original drop-in and both source SHAs. Run the plan’s CLI `check` as the configured account before scheduling. Choose an unused absolute `CLI_BACKUP` path under a private directory writable by that account.
2. Keep the `upgrade-resume` source in a persistent directory outside development checkouts and versioned BB packages. Check its compatibility with the target version. For a path install, build the same plugin ID at the new path and install that path over the existing one; verify the batch and settings are retained. Run `bash scripts/check-upgrade-resume.sh check` from the skill directory, on the BB server host, with the service user's filesystem access and an authenticated `bb` targeting that instance. This checks the plugin service and reads its source from disk; a cached `running` status alone can survive a missing directory.
3. Stage the self-contained cutover script, a copy of `check-upgrade-resume.sh`, and paths for logs and results outside checkouts that packaging or cleanup may remove. Have the script run the staged helper's `check` immediately before stopping the old unit. The stop-through-start sequence must finish independently of an agent or a live BB API: stop, back up, apply the replacement, daemon-reload, start, poll health and identity, run the plan's CLI `install` and `verify` as the configured account, and write the outcome. On a failed runtime gate, follow section 4 and record whether the old service started. After the runtime gates pass, run `bash <staged-helper> verify <prepared-batch.json>` with a bounded retry for plugin startup, and save the output or failure separately. Keep the healthy server running if only recovery verification fails; diagnose the plugin or batch there.
4. With everything staged, pause new dispatches and save the output of `bb upgrade-resume prepare --json` to the prepared batch file used by the script. Preparation does not freeze the queue. Check the intended threads are in the batch, including the initiating thread if it relies on resuming; reuse an existing batch only after checking its entries. Record the batch ID, script, logs, result paths, unit, old/new directories and expected SHA in the initiating thread, then schedule immediately.

### Schedule the independent cutover

Launch the prepared script as a separate systemd service. A delayed start leaves time to confirm the job was accepted and record its identity before the initiating thread is interrupted. For the system units used by the target configuration:

```bash
sudo -n systemd-run --unit=bb-cutover-<batch-id> --on-active=10s \
  --property=Type=oneshot --property=RemainAfterExit=yes \
  /bin/bash <absolute-cutover-script>
```

Replace placeholders with the recorded batch ID and script path. Use the manager and privileges matching the target service. The cutover script checks its own `/proc/self/cgroup` against the target unit's `ControlGroup` before stopping it: it must not be the target cgroup or a descendant. A regular `nohup`, `setsid` or background shell remains in the caller's cgroup. Use service mode so systemd launches and owns the cutover process. Keep the stop-through-start and rollback steps in the same independent task; issuing `systemctl stop` in the BB thread and planning to issue `start` afterwards cannot finish.

Confirm the timer/service was accepted and retain its name and journal. If scheduling fails while BB is still up, cancel the unused recovery batch with `bb upgrade-resume cancel` and fix the scheduling failure. An external terminal agent remains a valid execution path when independent scheduling or automatic thread recovery is unavailable.

### Verify after BB returns

Read the saved result and `journalctl -u <cutover-unit>` before taking further action. If cutover is still running, follow that task; do not submit it a second time. A missing result or an `uncertain` recovery entry requires checking the actual unit and thread state before retrying.

1. Poll server `/health` and host-daemon `/health`; check the target unit is `active`, actual ExecStart and WorkingDirectory identify the intended source/package, `/api/v1/system/version` matches the intended version, the plan’s CLI `verify` reports the same version from both the machine entry and `bb --version` in a clean environment with only `HOME` and `PATH=$HOME/.local/bin:/usr/bin:/bin`, and `NRestarts=0` after a short interval. For a Release package, require `release.json.source` to equal the verified aggregate SHA. The independent script uses these same gates before reporting success; health alone cannot distinguish a healthy old package from the new one.
2. Read the saved recovery output. Report resumed, skipped, pending or uncertain threads for the prepared batch; rerun the staged helper's `verify <prepared-batch.json>` to check pending entries. Check the latest messages and queue for uncertain entries before manually continuing them. Resume normal dispatches when the service and recovery plugin are ready. If the task rolled back, verify the old version and report the failed deployment instead of automatically repeating the switch.
3. Finish the external plugin checklist, including path-source builds/reloads and real configuration/data readback. Report per-plugin source revisions and outcomes with the BB release identity. For changes touching persistence or provider parameters, run one real API-level check against the service. Remove the completed transient timer/service and temporary script only after retaining any needed diagnosis and confirming no cutover work remains.

## 4. Failure and rollback

On a failed health or identity gate: stop the new unit, keep the data directory and unit journal, run the plan’s CLI `restore` to reinstate the previous machine entry and shim, restore the saved old drop-in including both pointers, daemon-reload and start it (restore the DB backup only if a migration broke it). Record a failed CLI restore separately and still attempt to bring back the old service. Fix the problem in the owning branch and deploy again. Never run two BB instances on the same data directory.

### Repair the CLI without a cutover

When the CLI has drifted and the service version is already correct, identify the running build from the unit and its source SHA or Release manifest. Run `scripts/fork-machine-cli.mjs` with the configured CLI account and absolute config/target paths: `check <config> <target>`, then `install <config> <target> <backup>`, then `verify <config> <target>`. If verification fails, run `restore <config> <target> <backup>`. These commands do not manage systemd or enroll a machine; verify the unit invocation did not change.

## 5. Cleanup

Afterwards, remove only worktrees that are clean and not used by the running service: superseded `aggregate-deploy-*` checkouts are regenerated artifacts and can go once the service runs elsewhere; feature worktrees must have their branch tip on the fork. Use `git worktree remove` without `--force`; report anything dirty or unpublished instead of forcing it.
