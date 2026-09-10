---
name: local-aggregate-deploy
description: Package the BB local/aggregate runtime and replace its configured local source service. Use only for a requested local aggregate build, systemd service switch or restart, or post-replacement health and rollback validation; not for ordinary builds, development servers, or aggregation alone.
---

# Local aggregate deployment

Run from the repository root. This skill owns the service cutover gates; the
existing `open-source-fork-maintenance` skill owns aggregate audit, source
branch selection, cherry-picks, registry updates, and fork publication.

## Preconditions

- Confirm the root checkout is `local/aggregate`; preserve parallel work and
  untracked files. Never stash or autostash.
- Read the ignored `config/local-aggregate-web.json` locally. Treat its service
  unit, repo path, data directory, Node executable, bind host, and ports as
  authoritative. Do not copy its machine-specific values into Git or output
  secrets from it.
- Follow the aggregate-maintenance audit first. An explicit user decision to
  package against the present baseline remains valid for this deployment; do
  not request it again merely because a service replacement follows.
- Before any restart, persist a checkpoint under the configured data directory.
  Include old and candidate commits, service unit, health endpoints, rollback
  owner, and the observed pre-cutover state. Keep it local.

## Build gate

Keep the old service running while preparing the candidate. Use the Node 22
executable from the local JSON, install frozen dependencies when the checkout
does not already have the required dependency state, then run:

```bash
<nodeExecutable> .bb/skills/local-aggregate-deploy/scripts/build-runtime.mjs --repo .
```

The helper limits the runtime build to the SDK, app, server, and host daemon at
one Turbo task at a time. It also prepares bundled plugins. It supplies a 6 GiB
Node heap only when the caller has not already chosen one. Do not substitute a
full-repository build for this gate: broad builds belong to an idle, adequately
provisioned machine, not a live service cutover.

If a build is OOM-killed, leave the working service running, record the signal
in the checkpoint, and reduce competing build load before retrying the same
serialized gate. Do not terminate unrelated user processes to make room.

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
