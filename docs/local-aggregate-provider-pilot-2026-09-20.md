# Provider two-tier pilot — 2026-09-20

This report covers the Provider pilot required by [fork specification #14](https://github.com/hxy91819/bb/issues/14). The stable baseline is `desktop-v0.43.3` at `e865697f56bea89f3413dd4cc7fae964850d20a0`. It records source, integration, contribution, verification, packaging, and publication separately; none of these states implies deployment.

## Locked composition

The version 4 [registry](../config/local-aggregate-features.json) assigns stable feature IDs and explicit ordered commits to ACP/DSH (#2), ACP Fast (#5), ACP Goal (#6), and ACP steering (#8). The Provider domain is `integration/provider-desktop-v0.43.3`. The [pilot train](../config/local-aggregate-trains/provider-pilot-desktop-v0.43.3.json) adds `mermaid-elk-layout` directly to prove that the domain and legacy direct modes coexist.

The Provider domain applied 13 selected commits without a compatibility conflict. The source-to-domain mapping is recorded per logical patch in the registry. No extra compatibility commit was necessary because the selected Provider source commits had already been adapted to `desktop-v0.43.3`; this pilot does not claim a measured conflict reduction from that no-conflict application.

The steering source branch contains unrelated aggregate ancestry. Its selection includes the steering design, implementation, failure handling, adapter notes, and label change only. It excludes automation, Mermaid, Vite, startup, Fast preference, Recent, migrations, tables, environment switching, sidebar work, and the later environment-continuation fixture. Those ancestors are not steering-owned patches.

## Contribution extraction

`contribution/acp-fast-mode-provider-pilot` was generated from the locked registry. It contains the four current ACP/DSH dependency patches and the ACP Fast patch. Its changed paths cover ACP provider discovery/configuration, DSH declarations and tests, native service-tier application and tests, and the associated user documentation. It contains neither ACP Goal nor ACP steering commits and does not inherit the Provider domain or aggregate ancestry.

This is an extraction exercise only. No upstream issue, comment, or pull request was created.

## Process acceptance

The shared maintenance skill's real-Git tests cover:

- fixed first-tier refs while domain refs are constructed and later moved;
- source advancement versus rewritten history;
- shared dependency deduplication by logical patch identity across two domains;
- single-feature and cross-feature adaptation mappings;
- contribution extraction with required dependency and without an unrelated feature;
- a train that omits one feature while retaining another domain member;
- immutable release recovery after source and domain branches move;
- failure before output-ref publication for a missing dependency, plus retry protection for an existing immutable ref;
- version 2 and 3 compatibility alongside version 4 feedback-role preservation.

## Verification and package state

The domain and contribution use the repository's existing ACP bridge and provider-plugin behavior tests for grouped model discovery, session/resume, service tiers, Goal extensions, and steering lifecycle. Candidate verification and the complete package build are recorded here only after their resource-isolated commands finish successfully.

The package credential is written after the final candidate source exists so it can bind the exact source SHA and train digest without a self-reference. It records the platform, Node and pnpm versions, ABI, build command, host protocol version, database compatibility, artifact digests, publication state, and deployment state.

## Measured maintenance effect

This pilot centralizes one stable baseline and one 13-patch Provider integration sequence while leaving the four first-tier refs unchanged. It removes the need to infer ownership from the steering branch's accumulated ancestry and creates a deterministic extraction boundary. Cross-feature Provider behavior still requires combined verification, and a future stable tag may still require an owned domain adaptation. Database compatibility, other candidate domains, and old-ledger fixture redesign remain outside this pilot.

## Stable-candidate integration input

The paused stable candidate is `local/rebase-staging-20260920` at `cc26cca6680fda183b08a7ec8145d060cb27f5f3`, also based on `desktop-v0.43.3`. It remains the authority for its 21 active sources, two retired records, database migrations, and the Fast interruption-recovery fix from source `53c14d667` integrated as `8dabee74a`. The Provider-only pilot candidate does not replace or supersede it.

The pilot did not regress to the historical `lastPackaged` values from the old aggregate registry. Its four source versions exactly equal the stable candidate's current packaged source SHAs: DSH `6a115ffd2`, Fast `e186f8f7d`, Goal `3d9900c6f`, and steering `4dd78b8e0`. Stable patch-ID comparison found all 13 selected Provider patches in `cc26cca66`, mapped in order to `b3a22d8d9`, `1f19a13b3`, `5b4d0956f`, `c1f9a555a`, `181af20e3`, `9cd4e45a4`, `750f1cd4d`, `07c9c24a3`, `5dd81f0c6`, `cf66462f8`, `8a6bef633`, `75bd6d4ec`, and `5679086b8`. Reapplying those product patches to that candidate would duplicate them.

Final integration therefore starts from `cc26cca66`, preserves its product tree and verification records, and merges only the two-tier maintenance surfaces. Registry merging is field-aware rather than whole-file replacement: retain the stable candidate's `module`, `status`, dependency, latest `lastPackaged`, retired records, 21-source order, and train evidence; retain the role-separated `specIssue`, `upstreamFeedback`, `relatedIssues`, `disposition`, and `reason` from `de07cd01c`; then add stable feature IDs, explicit source patch selections, Provider domain mappings, and the frozen train contract. Non-Provider sources remain direct entries during this migration.

The stable candidate's existing 590 database tests, 180 app tests, app typecheck, serialized 14-task package build, and combination autoreview remain evidence for their exact recorded input. They are not claimed as proof for a later metadata or product combination. The parent integration must rerun checks affected by the merged registry/train surfaces and execute the final resource-isolated package workflow before publication. Its TruffleHog preflight remains not passed because the binary was absent and downloaded candidates failed official checksum verification.
