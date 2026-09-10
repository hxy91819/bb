# Local Aggregate Upstream Feedback

This document records the upstream feedback associated with independently maintained and pending local-aggregate changes. It is a contribution log, not the authoritative specification backlog: new specifications belong in the personal fork at `hxy91819/bb`.

## Vite 6.4.1 CVE remediation

- **Upstream feedback:** [get-bb/bb#1780](https://github.com/get-bb/bb/issues/1780#issuecomment-5612021454)
- **Feature worktree:** `fix/vite-cve-2026-39363` at `abe95aefe02d11250060ad81d9a3f74d3494e556`; it is pending aggregate packaging and has not been published to the fork.
- **Background:** the lockfile resolves Vite 6.4.1 through `@ladle/react` and Vitest 3, while CVE-2026-39363 affects Vite 6.0.0 through 6.4.1 when its dev-server WebSocket is network-exposed.
- **Proposal:** add scoped pnpm overrides for `@ladle/react>vite` and `vitest@3>vite` at 6.4.3, retaining the direct Vite 8 dependency and package major versions.
- **Validation:** dependency-path commands on current upstream confirm the Vite 6.4.1 resolutions; the local lockfile patch resolves those paths to Vite 6.4.3. No network-exposed exploit was run.
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
