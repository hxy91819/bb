# Local Aggregate Upstream Feedback

This document records the upstream feedback associated with independently maintained and pending local-aggregate changes. It is a contribution log, not the authoritative specification backlog: new specifications belong in the personal fork at `hxy91819/bb`.

## Vite 6.4.1 CVE remediation

- **Upstream feedback:** [get-bb/bb#1780](https://github.com/get-bb/bb/issues/1780#issuecomment-5612021454)
- **Feature worktree:** `fix/vite-cve-2026-39363` at [`f56c75c97`](https://github.com/hxy91819/bb/commit/f56c75c9796cb686da4f5adb88262736a11fc0f9); packaged locally as `6bfd3db10e4114d5fb127b3469f6ba09d73cc901`.
- **Background:** the lockfile resolves Vite 6.4.1 through `@ladle/react` and Vitest 3, while CVE-2026-39363 affects Vite 6.0.0 through 6.4.1 when its dev-server WebSocket is network-exposed.
- **Proposal:** add scoped pnpm overrides for `@ladle/react>vite` and `vitest@3>vite` at 6.4.3, retaining the direct Vite 8 dependency and package major versions.
- **Validation:** dependency-path commands on current upstream confirm the Vite 6.4.1 resolutions; the rebased lockfile patch resolves those paths to Vite 6.4.3. No network-exposed exploit was run.
- **Screenshot:** not applicable; this is a dependency-resolution change.

## Shared recent explicit work ordering

- **Upstream feedback:** [get-bb/bb#1614](https://github.com/get-bb/bb/issues/1614#issuecomment-5611939177)
- **Fork specification:** [hxy91819/bb#1](https://github.com/hxy91819/bb/issues/1)
- **Fork implementation:** [feature/recent-explicit-work-sequence](https://github.com/hxy91819/bb/tree/feature/recent-explicit-work-sequence) at [`e403439e5`](https://github.com/hxy91819/bb/commit/e403439e53f30d7763b52e92ee299eee6ab9cd80)
- **Background:** the previous browser-local promotion sequence kept Recent activity stable, but connected clients of the same server could disagree. Thread lifecycle churn should still not reshuffle project sections.
- **Change:** store a server-owned monotonic sequence on the project when BB accepts eligible user-originated work. Recent activity orders pinned content first, then promoted projects by descending sequence, then unpromoted projects by the existing shared drag order.
- **Replacement:** this supersedes `feature/recent-project-activity-main` (`8e97b5048`). That browser-local implementation is retired from the aggregate.
- **Screenshot:** no product screenshot is published. The behavior is temporal and covered by observable ordering tests.

## Mermaid ELK layout

- **Upstream feedback:** [get-bb/bb#3382](https://github.com/get-bb/bb/issues/3382)
- **Fork implementation:** [feature/mermaid-elk-layout](https://github.com/hxy91819/bb/tree/feature/mermaid-elk-layout) at [`19b1cdecd`](https://github.com/hxy91819/bb/commit/19b1cdecd345f35ed64d9322385c6e92b49d814c)
- **Background:** dense Mermaid flowcharts can be difficult to scan with the default layout engine.
- **Proposal:** register Mermaid's official ELK layout loader once and select ELK as the default while preserving bb's strict Mermaid security configuration, existing theme, and lazy loading.
- **Screenshot:** no product screenshot is published. The available local comparison is a non-product proof of concept with non-English annotations, so it is intentionally not presented as upstream evidence.

## Mobile project display options

- **Upstream feedback:** [get-bb/bb#3330](https://github.com/get-bb/bb/issues/3330#issuecomment-5611939327)
- **Upstream adoption:** [get-bb/bb#3352](https://github.com/get-bb/bb/pull/3352) merged as `8ac123f3551e7502a91c93e87329797f34ee626b`. The production change is the same `data-sidebar-hover-actions-mobile="always"` marker; the upstream test also covers the open header-actions state.
- **Retirement:** `fix/mobile-display-options` (`30f71b335`) is no longer packaged. The rebuilt aggregate uses the upstream fix from `origin/main`.

## Codex Fast mode persistence

- **Upstream feedback:** [get-bb/bb#3403](https://github.com/get-bb/bb/issues/3403) is the primary bug tracker. [get-bb/bb#3401](https://github.com/get-bb/bb/issues/3401#issuecomment-5617155199) is retained only as historical context: it is a closed, not-planned SDK feature request rather than the bug's tracking issue.
- **Fork implementation:** [fix/codex-fast-mode-toggle](https://github.com/hxy91819/bb/tree/fix/codex-fast-mode-toggle) at [`65ad5dc0b`](https://github.com/hxy91819/bb/commit/65ad5dc0b2e8c9793a9cc018ab7c928f65d33571), rebased onto current `origin/main` with migration `0117_charming_avengers`.
- **Background:** disabling Fast without sending another message only changed the main composer's local selection. Returning to the thread restored the saved fast tier. The Codex adapter also omitted the explicit reset for the default tier.
- **Change:** persist the toggle through the thread-update API, SDK and CLI; refresh execution-option subscribers; keep the selected Fast value as the new-thread default. `fix/codex-fast-mode-toggle-aggregate-compat` is retired because this rebuild no longer needs a separate migration-number adapter.
- **Screenshot:** browser screenshots and raw bridge recordings remain local because they include machine paths and model-catalog details; the upstream comment includes sanitized wire evidence.
- **Integration status:** this pass does not create an upstream PR.

## Local Fast migration compatibility

- **Tracking context:** [get-bb/bb#3403](https://github.com/get-bb/bb/issues/3403) remains the primary Fast-mode bug tracker. This is a local deployment compatibility repair, not a second upstream product report.
- **Fork implementation:** [fix/local-aggregate-service-tier-migration](https://github.com/hxy91819/bb/tree/fix/local-aggregate-service-tier-migration) at [`c6a69e157`](https://github.com/hxy91819/bb/commit/c6a69e157b4adcb341599bd507da1f1d0e6547c4), packaged as `9f460e6bb`.
- **Background:** a previously deployed branch-local Fast migration could leave `threads.service_tier_override` in the local schema without the rebuilt aggregate's canonical `0117_charming_avengers` journal row. Replaying the canonical migration then attempted to add the existing column and prevented startup.
- **Change:** stage the existing value before Drizzle replays the canonical sequence, then restore it after the canonical column exists. This preserves Fast settings while allowing `0116`, `0117`, and `0118` to be recorded normally; no data-directory or migration-ledger edit is required.
- **Integration status:** packaged as a local deployment repair only; no upstream PR was opened.

## Local aggregate startup sequencing repair

- **Tracking context:** [get-bb/bb#3403](https://github.com/get-bb/bb/issues/3403) remains the Fast-mode bug's primary tracker. No separate upstream issue was created for this deployment-only follow-up, and this entry must not be read as a second product report for #3403.
- **Fork implementation:** [fix/local-aggregate-server-startup](https://github.com/hxy91819/bb/tree/fix/local-aggregate-server-startup) at [`58d86555c`](https://github.com/hxy91819/bb/commit/58d86555c05be5c62f752856ce0645623f770060).
- **Background:** a retained `starting` thread caused startup recovery to wait for a host-backed provision before the server could become healthy; the daemon that satisfies that provision is started only after server health succeeds.
- **Change:** bind the HTTP listener first, then run the same recovery sweep in the background with its existing error reporting.
- **Integration status:** packaged as a deployment compatibility repair only; no upstream PR was opened.

## ACP grouped models, session/resume, and DeepSeek Harness

- **Fork specification:** [hxy91819/bb#2](https://github.com/hxy91819/bb/issues/2)
- **Fork implementation:** [feature/dsh-acp-provider](https://github.com/hxy91819/bb/tree/feature/dsh-acp-provider) at [`2f638b8b2`](https://github.com/hxy91819/bb/commit/2f638b8b2626326c774132e3b3c29196b2521bde)
- **Background:** ACP v1 allows grouped model select options and optional `session/resume`. BB flattened neither grouped catalogs nor resume-before-load, and DeepSeek Harness was not a known installed-only ACP agent.
- **Change:** flatten grouped ACP model lists, restore via `session/resume` before `session/load`, and ship `acp-dsh` for `dsh --profile acp`.
- **Integration status:** no get-bb/bb issue was filed in this pass.
