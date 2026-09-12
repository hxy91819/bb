# Codebase Guidelines

## Task Completion

- Carry the requested change through implementation, relevant verification, and fixes for failures it causes. Continue authorized, reversible local work without asking for approval at each step; ask when a missing user decision blocks progress.
- Match verification to the change. Once relevant checks pass, broaden or repeat them only for new changes, failures, or unresolved concerns.
- Read the linked guidance when its topic applies to the task.

## Code And Contracts

- Code comments are forbidden, except for semantic tool directives and Plugin SDK declaration comments.
- When renaming a domain concept, search project-wide for stale names in variables, files, query keys, constants, tests, and docs; TypeScript only catches type references.
- Parse and validate data at system boundaries, then pass typed values internally. Restrict `unknown` and `as X` casts to genuinely unknowable boundaries and narrow immediately.
- Keep one-off types local; share types only for real cross-package contracts.
- Optional or nullable fields must represent meaningful absence. Fill defaults once at the server boundary and pass explicit values through internal routes, commands, and persisted events.
- Delete accepted-but-ignored route or command fields, or implement them end to end. Document route and command behavior when it is non-obvious.

## Server And Daemon

- The server owns product policy: defaults, instructions, manager behavior, tool lists, and thread behavior. The host daemon owns host-local primitives, provider translation, runtime/session management, and workspace execution.
- Return raw host-local data from the daemon; assemble product behavior on the server. Move responsibility across this boundary only when the change requires it.
- Increment `HOST_DAEMON_PROTOCOL_VERSION` for changes to server/daemon wire fields, including their types, requiredness, defaults, or meaning, unless compatibility with the previously shipped daemon is deliberately preserved and tested. This covers session payloads, WebSocket messages, and host RPC commands/results. Shared TypeScript builds do not verify compatibility with enrolled machines; the version bump triggers their update.

## CLI And Plugin API

- Every end-user feature must also be usable through the SDK and `bb` CLI; ship and document these surfaces with the UI.
- For changes to CLI commands/flags or user-facing configuration (env vars, `.bb/` workspace files, settings), update the discoverable surfaces listed in [docs/cli-guide-and-skill.md](docs/cli-guide-and-skill.md).
- New public plugin API members (`@get-bb/plugin-sdk/app` exports, `app.slots.*` methods, or `BbPluginApi` properties) require an `experimental_` prefix and an entry in [docs/api_to_audit.md](docs/api_to_audit.md) describing behavior and stabilization criteria. Stabilization includes the audit, a project-wide rename, and removal of the entry.
- The Plugin Guide is the only plugin API documentation. Add new surfaces to `packages/plugin-api-map/src/surfaces.ts` with their SDK symbols.

## Data Access

- Use targeted `WHERE`/`JOIN` queries instead of loading all rows and filtering in JavaScript. Add indexes only when required by the query.
- Change Drizzle schemas and regenerate migrations/snapshots; never edit snapshot JSON manually.
- Never mock the database in tests. Use `createConnection(":memory:")` and `migrate(db)`.

## UI

- Use sanctioned typography tokens instead of arbitrary `text-[Npx]` classes.
- Derive theme colors from `--canvas`/`--ink` or other derived tokens; never use achromatic `oklch(L 0 0)` literals. Mix opaque steps in `oklch` and translucent steps in `oklab`. See `apps/app/src/components/ui/theme.css` and `theme.test.ts`.
- Never use CSS `@scope`; it causes severe WebKit style-recalculation costs. Confine styles with zero-specificity `:where(<roots>)` descendant and compound selector arms, as implemented in `packages/plugin-build/src/scope-plugin-utilities.ts`.
- Use the shared persistent responsive drawer for compact slide-out menus, pickers, popovers, and dialogs. Avoid modal primitives that add `inert` or `aria-hidden` to the app root. Start the transform before heavy content; realize content after two animation frames with a timeout fallback, then retain it. Verify representative drawers in iOS Simulator Safari and test app-root and deferred-realization behavior.

## Build And Test

- Run resource-heavy local builds, full-package tests, and source app launches through `scripts/run-resource-isolated -- <command>`; use `--profile package` for the serialized local aggregate build. Treat scope refusal or an OOM exit as a failed check. Keep only one scoped verification or package job active at a time.
- Use Turbo for builds, typechecks, and tests so upstream dependencies run first: `pnpm exec turbo run <task> --filter=@bb/<pkg>`. Use the package's actual name for other scopes. Bypass orchestration only for deliberate investigation; do not invoke package scripts or raw `tsc` routinely.
- Generated modules are gitignored: `packages/templates/src/generated/`, `packages/plugin-build/src/generated/`, and `packages/plugin-sdk/bundled-types/`. Never commit them or add a `--check` mode. New generated modules need Turbo tasks with explicit inputs, outputs, and consumer dependencies.
- If a plugin cannot resolve `@get-bb/plugin-sdk`, run `pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk`.
- Test plausible failure modes; avoid trivial getters/setters and framework wiring. Pipe slow test output to a file and inspect it.
- Build Vitest projects with `sharedWorkerProjects` from `vitest.shared.ts`. Node tests share workers (`isolate: false`); DOM tests and files/helpers that mutate worker-global state receive isolated workers. Restore any global state a test changes.

## Issues, Pull Requests, And Debugging

- When filing issues, follow [docs/filing-issues.md](docs/filing-issues.md): reproduce first, check for duplicates, and include versions, copy-pasteable steps, verbatim expected/actual output, commit-permalink evidence, and what you ruled out. Add evidence to an existing issue when applicable.
- Use [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md): root cause, change, verification that demonstrates the fix, and `Fixes #N` when applicable.
- End every agent-created issue and PR body with `> AGENT GENERATED`.
- Ground debugging in observed state: logs, database queries, server APIs, or CLI output. For dev ports, data directories, entity IDs, and the local QA launcher, see [docs/debugging-and-qa.md](docs/debugging-and-qa.md).

<!-- open-source-fork-maintenance:start -->
## 本地聚合分支

当前 bb 项目根目录检出的 `local/aggregate` 是用于本地打包和体验的集成分支。
默认基线是最新匹配的 `desktop-v*` 稳定 tag，不是 `origin/main` 尖端。
`origin/main` 上未进该 tag 的提交视为未发布债务，除非用户明确选择跟主干。
不要从聚合分支创建上游 PR。验证后的聚合提交必须推送到个人 fork 的
`local/aggregate`，以便另一环境可直接取得相同的已聚合源码；不得推送到上游。

上游回馈的背景、方案、fork 引用、验证与截图状态见
[docs/local-aggregate-upstream-feedback.md](docs/local-aggregate-upstream-feedback.md)。

当前纳入的独立改动如下：

| 独立分支 | 上次打包源提交 | 上次打包聚合提交 | 上游回馈 | 目的 |
| --- | --- | --- | --- | --- |
| `feature/mermaid-elk-layout` | `5bff15cf8` | `a3c82d3cf` | [#3382](https://github.com/get-bb/bb/issues/3382) | 为 BB Mermaid 渲染注册并默认启用 ELK 布局 |
| `fix/vite-cve-2026-39363` | `348102680` | `63d1cc8bd` | [#1780](https://github.com/get-bb/bb/issues/1780#issuecomment-5612021454) | 将 `@ladle/react` 与 Vitest 3 的传递 Vite 解析固定到 6.4.3 |
| `fix/codex-fast-mode-toggle` | `7c844315b` | `028ede08c` | [#3403](https://github.com/get-bb/bb/issues/3403) | 保存 Fast 开关、作为新线程默认；wire 上 default 仍用上游的 null reset |
| `fix/local-aggregate-service-tier-migration` | `b0e8bbd4b` | `23b71a546` | [#3403](https://github.com/get-bb/bb/issues/3403) | 兼容旧 Fast 列及其较晚迁移时间戳，使 canonical Fast 与 UI 设置迁移完整重放 |
| `fix/local-aggregate-server-startup` | `09240c134` | `8043c3b0e` | [#3403](https://github.com/get-bb/bb/issues/3403) | 本地打包部署时先监听再恢复遗留线程，避免 host daemon 尚未启动造成启动死锁 |
| `feature/dsh-acp-provider` | `5e6149955` | `3f32fb27b` | [hxy91819/bb#2](https://github.com/hxy91819/bb/issues/2) | ACP 分组模型、session/resume，以及 DeepSeek Harness |
| `feature/recent-explicit-work-sequence` | `ea76da09d` | `898cb1440` | [#1614](https://github.com/get-bb/bb/issues/1614#issuecomment-5611939177) | 用 server 持有的 promotion sequence 做跨设备 Recent activity 排序 |
| `fix/markdown-table-breakout` | `8ce604e1d` | `461c11481` | [hxy91819/bb#3](https://github.com/hxy91819/bb/issues/3) | 宽表留在正文栏内滚动，溢出时用全屏展开阅读 |

维护规则：

1. 项目根目录的工作区必须永久停留在 `local/aggregate`；不得在这里切换到功能或修复分支，也不得在这里编写可回流的产品代码。聚合维护文档、登记表和脚本是唯一例外。
2. 每项后续功能或修复（包括其测试）开始前，必须创建或复用一个独立的 `feature/*` 或 `fix/*` 分支，并为该分支创建独立 worktree；不得在项目根目录实施。
3. 独立 worktree 负责开发、测试、提交、`$autoreview` 收尾和发布；该分支在 `$autoreview` 报告无 accepted/actionable findings 之前不算已验证。聚合分支只通过 `git cherry-pick -x <commit>` 引入已验证提交。已完成且已验证的 source 分支和 `local/aggregate` 均须以非强制推送发布到个人 fork；不得推送到上游。
4. 每个本地 `feature/*`、`fix/*` worktree 默认纳入聚合，并在 [config/local-aggregate-features.json](config/local-aggregate-features.json) 记录其上游回馈 issue。每次引入或移除改动时，更新上表和登记表，并保留 `-x` 的来源行以便追溯。该登记表是每个特性上次打包源提交、聚合提交和上游回馈的权威记录。
5. 上游同步和本地打包必须调用 [open-source-fork-maintenance](.bb/skills/open-source-fork-maintenance/SKILL.md)：先检查新增分支、源提交变化、上游变化及每个回馈 issue 的采纳信号，向用户呈现维护建议并请求决定。默认把受影响的 feature/fix 分支 rebase 到最新 `desktop-v*` 稳定 tag 并验证，再按该 tag 重建聚合；`origin/main` 上未进 tag 的提交只作为债务报告。若用户明确不 rebase，可以继续以当前本地基线增量打包，并保留未同步上游的状态。
6. 本地体验、构建或打包必须从当前项目根目录启动，验证通过后才可替换本机正在运行的 source 服务。以该服务为目标的打包、替换或替换后健康/回退验证必须调用 [local-aggregate-deploy](.bb/skills/local-aggregate-deploy/SKILL.md)；普通构建、测试和单纯聚合不调用它。另一环境可从 fork 的 `local/aggregate` 取得相同聚合源码，但仍须在该环境安装依赖并构建；不要把独立功能 worktree 直接当作日常体验版本。
7. 聚合层出现问题时，优先在相应独立分支修复并以新的提交重新引入；不要在聚合分支写无法回流的产品代码。
<!-- open-source-fork-maintenance:end -->
