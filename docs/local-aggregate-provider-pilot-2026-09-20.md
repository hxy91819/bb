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
