# Local Aggregate Upstream Feedback

This document records the upstream feedback associated with independently maintained and pending local-aggregate changes. It is a contribution log, not the authoritative specification backlog: new specifications belong in the personal fork at `hxy91819/bb`.

## Vite 6.4.1 CVE remediation

- **Upstream feedback:** [get-bb/bb#1780](https://github.com/get-bb/bb/issues/1780#issuecomment-5612021454)
- **Feature worktree:** `fix/vite-cve-2026-39363` at `abe95aefe02d11250060ad81d9a3f74d3494e556`; packaged locally as `acecb1cb2d0c5342277c4b462da7098830d5a4ea` and published to the personal fork.
- **Background:** the lockfile resolves Vite 6.4.1 through `@ladle/react` and Vitest 3, while CVE-2026-39363 affects Vite 6.0.0 through 6.4.1 when its dev-server WebSocket is network-exposed.
- **Proposal:** add scoped pnpm overrides for `@ladle/react>vite` and `vitest@3>vite` at 6.4.3, retaining the direct Vite 8 dependency and package major versions.
- **Validation:** dependency-path commands on current upstream confirm the Vite 6.4.1 resolutions; the local lockfile patch resolves those paths to Vite 6.4.3. A frozen install and root aggregate build passed; the locally installed aggregate service is active and its HTTP health check returned 200. No network-exposed exploit was run.
- **Screenshot:** not applicable; this is a dependency-resolution change.

## Recent project activity ordering

- **Upstream feedback:** [get-bb/bb#1614](https://github.com/get-bb/bb/issues/1614#issuecomment-5611939177)
- **Fork implementation:** [feature/recent-project-activity-main](https://github.com/hxy91819/bb/tree/feature/recent-project-activity-main) at [`8e97b5048`](https://github.com/hxy91819/bb/commit/8e97b50488b6566b25afa8fb8415cc0af2d072b8)
- **Background:** deriving project section order from active-thread status and attention timestamps makes a project move both when user work starts and when it completes or fails.
- **Proposal:** retain the existing dynamic thread order, but store a browser-local, user-initiated project promotion sequence. Promote only after accepted user work; keep project positions stable for lifecycle and metadata updates. Pinned content stays first and unpromoted projects fall back to saved drag order.
- **Validation:** 5 focused app test files / 23 tests and the app build passed on the locally aggregated implementation.
- **Screenshot:** no product screenshot is published. The behavior is temporal and covered by observable ordering tests.

## Mermaid ELK layout

- **Upstream feedback:** [get-bb/bb#3382](https://github.com/get-bb/bb/issues/3382)
- **Fork implementation:** [feature/mermaid-elk-layout](https://github.com/hxy91819/bb/tree/feature/mermaid-elk-layout) at [`dfa62783f`](https://github.com/hxy91819/bb/commit/dfa62783f251e18f327d97cf4ec21b81371a4a3a)
- **Background:** dense Mermaid flowcharts can be difficult to scan with the default layout engine.
- **Proposal:** register Mermaid's official ELK layout loader once and select ELK as the default while preserving bb's strict Mermaid security configuration, existing theme, and lazy loading.
- **Validation:** the two focused Mermaid test files (5 tests) and app typecheck passed.
- **Screenshot:** no product screenshot is published. The available local comparison is a non-product proof of concept with non-English annotations, so it is intentionally not presented as upstream evidence.

## Mobile project display options

- **Upstream feedback:** [get-bb/bb#3330](https://github.com/get-bb/bb/issues/3330#issuecomment-5611939327)
- **Fork implementation:** [fix/mobile-display-options](https://github.com/hxy91819/bb/tree/fix/mobile-display-options) at [`30f71b335`](https://github.com/hxy91819/bb/commit/30f71b335d8a1df518025bf665022f1cc036f446)
- **Background:** the project-header Display options trigger exists on touch mobile sidebars but is hidden by the hover-actions CSS, leaving it invisible and untappable.
- **Proposal:** apply the existing coarse-mobile visibility marker to the project-header hover-actions wrapper. This is a minimal bug fix that preserves desktop behavior and the existing control.
- **Validation:** the focused project-row interaction test file (12 tests) and app typecheck passed.
- **Screenshot:** the upstream bug report already contains reproducible DOM/CSS evidence; no additional screenshot was created during this aggregate pass.

## Codex Fast mode persistence

- **Upstream feedback:** [get-bb/bb#3403](https://github.com/get-bb/bb/issues/3403) is the primary bug tracker. [get-bb/bb#3401](https://github.com/get-bb/bb/issues/3401#issuecomment-5617155199) is retained only as historical context: it is a closed, not-planned SDK feature request rather than the bug's tracking issue.
- **Fork implementation:** [fix/codex-fast-mode-toggle](https://github.com/hxy91819/bb/tree/fix/codex-fast-mode-toggle) at [`0e41dc3a3`](https://github.com/hxy91819/bb/commit/0e41dc3a3b0b36dbed01a489fea9b259935ac48d), adapted on [fix/codex-fast-mode-toggle-aggregate-compat](https://github.com/hxy91819/bb/tree/fix/codex-fast-mode-toggle-aggregate-compat) at [`b613a8b73`](https://github.com/hxy91819/bb/commit/b613a8b73a024fdae2033fe627b7a60594bc3f79) to preserve the aggregate's migration lineage without importing unrelated upstream commits.
- **Background:** disabling Fast without sending another message only changed the main composer's local selection. Returning to the thread restored the saved fast tier. The Codex adapter also omitted the explicit reset for the default tier.
- **Change:** persist the toggle through the thread-update API, SDK and CLI; refresh execution-option subscribers; send explicit `serviceTier: null` to Codex for the default tier.
- **Validation:** focused app/server/CLI/contract/provider tests and typechecks passed on the source fix. The aggregate-compatible source passed the focused database migration (62), app (103), server (94), and Codex provider (39) tests. In an isolated source web app, disable, navigation without sending, reload and re-enable passed. A real follow-up completed with explicit null in both resume and turn-start provider requests. Secret scans of changed files and the new commit passed.
- **Screenshot:** browser screenshots and raw bridge recordings remain local because they include machine paths and model-catalog details; the upstream comment includes sanitized wire evidence.
- **Integration status:** cherry-picked into `local/aggregate` as `ef60100bce75a5a4597aaa9748eb58dd6a5cdf47`; this pass does not create an upstream PR.

## Local aggregate startup sequencing repair

- **Tracking context:** [get-bb/bb#3403](https://github.com/get-bb/bb/issues/3403) remains the Fast-mode bug's primary tracker. No separate upstream issue was created for this deployment-only follow-up, and this entry must not be read as a second product report for #3403.
- **Fork implementation:** [fix/local-aggregate-server-startup](https://github.com/hxy91819/bb/tree/fix/local-aggregate-server-startup) at [`5d2d3c1cc`](https://github.com/hxy91819/bb/commit/5d2d3c1cc86b8e82610a78cf371713510a4144c6), packaged as `07443ddfce39d1a4230a36187c3eb8d604c30656`.
- **Background:** a retained `starting` thread caused startup recovery to wait for a host-backed provision before the server could become healthy; the daemon that satisfies that provision is started only after server health succeeds.
- **Change:** bind the HTTP listener first, then run the same recovery sweep in the background with its existing error reporting.
- **Validation:** the original local data directory reproduced the pre-fix clean exit before listening. With the change, the source server reached `/health` while the retained thread's recovery continued; server startup diagnostics (4 tests) and server typecheck passed.
- **Integration status:** packaged as a deployment compatibility repair only; no upstream PR was opened.
