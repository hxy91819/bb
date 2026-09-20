# Two-tier stable integration — 2026-09-20

This record combines the two-tier maintenance model from fork specification #14 with the complete `desktop-v0.43.3` stable candidate. It does not replace the Provider-only pilot and does not claim a new package or deployment.

## Inputs and ownership

- Product authority: `cc26cca6680fda183b08a7ec8145d060cb27f5f3`, based on `desktop-v0.43.3` at `e865697f56bea89f3413dd4cc7fae964850d20a0`.
- Maintenance source: `feature/two-tier-fork-maintenance` at `63ed5d2eeb836c437f054de24f262f3971e6f69a`.
- Shared skill: `mason-skills` at `feef03a69891c9f6ec6a317b29fc78d3276a9c41`.
- Provider pilot domain: `1d94cae6d862b2b50f03e611c584a72be43c394b`.
- ACP Fast contribution exercise: `1efc7a952f21a6e7340d74cf32d02992686af356`.

The version 4 registry preserves the stable candidate's 21 product features, latest source/aggregate endpoints, module and dependency fields, and two retired cleanup records. It separately preserves the role-classified specification, upstream-feedback, related-issue, disposition, and reason fields from the maintenance source, including fork specifications #12, #13, and #14.

The frozen full train lists all 58 product commits in their actual candidate order. Each entry binds an aggregate commit to its first-tier source commit and stable logical patch ID. The later `4dd78b8e` environment-continuation fixture is owned by `environment-switch-auto-continue` in the full train rather than being added to the Provider pilot's steering selection. Provider mappings otherwise reuse the 13 patches already present in the stable candidate; they are not reapplied as product changes.

## Reconstruction contract

The composer starts at the locked stable tag, applies the train's 58 candidate commits in order, then binds the committed registry and train manifest in a final maintenance commit. Product-tree comparison excludes only these maintenance surfaces:

- `.bb/skills/open-source-fork-maintenance`
- `AGENTS.md`
- `config/local-aggregate-features.json`
- `config/local-aggregate-trains/`
- `docs/local-aggregate-provider-pilot-2026-09-20.md`
- `docs/local-aggregate-stable-integration-2026-09-20.md`
- `docs/local-aggregate-verification-2026-09-20.md`

The immutable output ref, manifest commit, train SHA-256, reconstructed candidate SHA, and exact comparison result are recorded after the committed manifest is composed. That post-commit evidence avoids embedding a commit's own SHA into itself.

## Verification boundary

The earlier stable candidate's database, app, server, ACP/Pi, package, and autoreview results remain evidence for its exact product input. Parent-owned serialized verification later completed for both maintenance exercises. Provider pilot candidate `0f623a18f81511ed080da60369238e21f97675d9` passed 358 ACP bridge tests and 86 provider-ACP plugin tests. Contribution `1efc7a952f21a6e7340d74cf32d02992686af356` passed 342 ACP bridge tests and 86 provider-ACP plugin tests. Their successful logs are `/tmp/two-tier-pilot-behavior-retry.log` and `/tmp/two-tier-contribution-behavior.log`. Earlier interrupted or manager-bus attempts remain recorded separately and are not presented as successes.

No dependency installation, heavy test, package build, publication, service replacement, or deployment is performed by this integration step.
