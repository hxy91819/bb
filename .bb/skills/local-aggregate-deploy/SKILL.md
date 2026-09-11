---
name: local-aggregate-deploy
description: Package a complete BB local/aggregate snapshot and replace a configured local source service, including per-machine configuration and post-cutover worktree cleanup. Use only for requested local aggregate deployment, service replacement, or replacement validation; not for ordinary builds, development servers, or aggregation alone.
---

# Local aggregate deployment

Run from the repository root. This skill owns the service cutover gates and
post-cutover local cleanup; `open-source-fork-maintenance` owns source-branch
selection, cherry-picks, registry updates, and fork publication.

## Preconditions

- Confirm the root checkout is `local/aggregate`; preserve parallel work and
  untracked files. Never stash or autostash.
- Select one local deployment target. The default is the ignored
  `config/local-aggregate-web.json`; when the request names a target, use the
  ignored `config/local-aggregate-web.<target>.json`. Each target has its own
  service unit, repository, data directory, Node executable, bind host, and
  ports. Treat the selected file as authoritative; never copy it, its data, or
  its secrets between targets or into Git. If the requested target file is
  absent, stop after naming the missing local configuration.
- Determine whether the current aggregate is complete before doing source
  maintenance. Run the aggregate status helper and compare every registered
  source branch with `local/aggregate` using `git cherry -v`. When there are no
  unregistered feature/fix branches and no `+` source patches, the published
  aggregate is complete: proceed directly to this skill's build and cutover.
  Do not rebase, rebuild, or repeat an upstream audit merely because upstream
  changed. A pending source patch follows the aggregate-maintenance workflow,
  unless the user explicitly authorizes deploying the present aggregate as-is.
- Before any restart, persist a checkpoint under the configured data directory.
  Include old and candidate commits, service unit, health endpoints, rollback
  owner, and the observed pre-cutover state. Keep it local.
- Install `assets/oom-policy-continue.conf` as an additional drop-in for the
  configured systemd unit and reload systemd before a cutover. Verify
  `OOMPolicy=continue`; this keeps an OOM-killed child from stopping the whole
  running service, while the build scope remains the primary memory boundary.
- Run
  `node .bb/skills/local-aggregate-deploy/scripts/test-resource-isolation.mjs`.
  It must demonstrate the finite scope, serialization, detached-child
  containment, and a bounded 96 MiB OOM probe before a package build starts.

## Build gate

Keep the old service running while preparing the candidate. Use the Node 22
executable from the local JSON, install frozen dependencies when the checkout
does not already have the required dependency state, then run:

```bash
scripts/run-resource-isolated --profile package -- \
  <nodeExecutable> .bb/skills/local-aggregate-deploy/scripts/build-runtime.mjs --repo .
```

The runner gives the serialized package build a separate finite-memory user
scope. The helper limits the runtime build to the SDK, app, server, and host
daemon at one Turbo task at a time. It also prepares bundled plugins. It
supplies a 6 GiB Node heap only when the caller has not already chosen one. Do
not substitute a full-repository build for this gate: broad builds belong to
an idle, adequately provisioned machine, not a live service cutover.

If a build is OOM-killed, leave the working service running, record the signal
in the checkpoint, and reduce competing build load before retrying the same
serialized gate. Do not terminate unrelated user processes to make room.

## Database migration gate

For a candidate that contains database migrations, record its generated
migration identifiers and whether the migration only adds state or rewrites
existing state in the checkpoint. Take a recoverable database backup before a
migration that rewrites or removes persisted data.

Do not run a separate migration command. The replacement service applies its
packaged migrations during startup before it can pass the health gate. If that
startup fails, preserve the data directory, migration ledger, and unit journal;
repair through a new independent worktree. The recovery path must not modify
the migration ledger or apply ad-hoc database repair SQL.

## Cutover and proof

Only after the build gate succeeds:

1. Restart the configured systemd unit. If an old failed unit is looping, stop
   it and reset its failed state before the new start.
2. Poll the configured server `/health` and host-daemon `/health`; both must
   succeed before calling the deployment healthy.
3. Confirm the unit is `active`, its main process works from the configured
   repository, the deployed `local/aggregate` SHA contains the intended
   package commits, and `NRestarts=0` after a short stability interval.
4. Query `/api/v1/system/version` for the running version. Keep Tailscale Serve
   Tailnet-only; inspect it only when the request includes proxy validation.
5. For a change that affects persistence, migrations, or next-turn provider
   parameters, run a real API-level check against the deployed service. Restore
   any user setting used as a reversible probe and record the restoration.

## Failure handling

On a failed health gate, stop the restart loop, retain the data directory, and
record the unit journal plus the last successful checkpoint state. Repair a
product regression in its independent `fix/*` worktree and cherry-pick it back
into the aggregate. Roll back code only when the deployment request authorizes
that rollback; use a recoverable revert or backup ref, rebuild through this
skill, and repeat the health gate. Never run two BB instances against the same
data directory.

The deployment is complete only after the checkpoint, health evidence, running
revision, and any requested product-specific proof agree. Publish to the
personal fork only as required by the aggregate-maintenance rules; never push
the local aggregate to upstream.

## Post-cutover cleanup

After a healthy cutover and fork publication, retain only the root
`local/aggregate` checkout locally.

1. Fetch the personal fork. For every non-root worktree branch, push its exact
   committed tip with an ordinary non-forced push when the remote ref is absent
   or an ancestor, then verify the remote SHA. A branch already reachable from
   the published aggregate needs no separate remote ref.
2. Remove only a worktree whose tracked and untracked status is clean and whose
   live processes do not have that worktree as their current directory. Use
   `git worktree remove` without `--force`; never stop an unrelated Agent or
   host process to make cleanup pass.
3. After its worktree is gone, delete the corresponding local branch only when
   its exact tip is available from the personal fork or the published aggregate.
   Delete local backup, rebuild, and upstream-tracking branches under the same
   condition, leaving only `local/aggregate` checked out locally. Run
   `git worktree prune` and verify the final branch/worktree list.

Report any dirty, active, divergent, or unpublished worktree as a cleanup
blocker. Preserve it for a later run rather than using force, stash, or reset.
