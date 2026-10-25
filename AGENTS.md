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
- New public plugin API members (`@get-bb/plugin-sdk/app` exports, `app.slots.*` methods, or `BbPluginApi` properties) require an `experimental_` prefix and an entry in [docs/api_to_audit.md](docs/api_to_audit.md) describing behavior, stabilization criteria, and the core callers that use the same path. Stabilization includes the audit, a project-wide rename, and removal of the entry.
- Plumbing only bb's own first-party plugins may call, and that is not meant to become public API, uses an `internal_DO_NOT_USE_` prefix instead of `experimental_`, with an entry in [docs/api_to_audit.md](docs/api_to_audit.md) that names its only callers.
- A plugin API that performs a core action must be the path core uses for that action. Extract core's implementation and route core's controls, shortcuts, and the API through it; never add a parallel plugin-only path. When several surfaces host the action, they share that implementation and one contract test table run against every surface. If core cannot use the API, it is not ready to ship.
- The Plugin Guide is the only plugin API documentation. Add new surfaces to `plugins/plugin-api-docs/src/surfaces.ts` with their SDK symbols.

## Data Access

- Use targeted `WHERE`/`JOIN` queries instead of loading all rows and filtering in JavaScript. Add indexes only when required by the query.
- Change Drizzle schemas and regenerate migrations/snapshots; never edit snapshot JSON manually.
- Never mock the database in tests. Use `createMigratedConnection()` from `@bb/db/testing`, a real SQLite database copied from a template built once by the real migrations. Call `migrate(db)` directly only when testing migrations or an on-disk database.

## UI

- Use sanctioned typography tokens instead of arbitrary `text-[Npx]` classes.
- Touch-editable controls must compute to at least 16 CSS px at every viewport width, including PWA and plugin panels. Use the shared input typography token with cascade protection against later plugin utilities. Verify emitted CSS and focus/type with host and plugin styles loaded; report iOS Simulator/device verification separately from desktop browser emulation. Preserve user pinch zoom in the viewport configuration.
- Derive theme colors from `--canvas`/`--ink` or other derived tokens; never use achromatic `oklch(L 0 0)` literals. Mix opaque steps in `oklch` and translucent steps in `oklab`. See `apps/app/src/components/ui/theme.css` and `theme.test.ts`.
- Never use CSS `@scope`; it causes severe WebKit style-recalculation costs. Confine styles with zero-specificity `:where(<roots>)` descendant and compound selector arms, as implemented in `packages/plugin-build/src/scope-plugin-utilities.ts`.
- Use the shared persistent responsive drawer for compact slide-out menus, pickers, popovers, and dialogs. Avoid modal primitives that add `inert` or `aria-hidden` to the app root. Start the transform before heavy content; realize content after two animation frames with a timeout fallback, then retain it. Verify representative drawers in iOS Simulator Safari and test app-root and deferred-realization behavior.

## Build And Test

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
- Never tail the production bb connect gate (`bb-connect`) with `wrangler tail` or the dashboard's live logs. Attaching or detaching a tail resets its Durable Objects and drops every connected tunnel. Instead, query stored Workers Logs or the Cloudflare GraphQL Analytics API (`httpRequestsAdaptiveGroups`, `durableObjectsInvocationsAdaptiveGroups`), and reproduce with `wrangler tail --env staging` against `bb-connect-staging`.

<!-- fork-maintenance:start -->

## Fork 维护

本仓库是个人 fork（远端 `origin` = hxy91819/bb，上游 `upstream` = get-bb/bb）。目标只有三个：每个改动是独立、可直接提给上游的分支；方便本机聚合打包；能纳入上游稳定版。完整流程见 [docs/fork-maintenance.md](docs/fork-maintenance.md)，不要引入领域分支、补丁登记表或冻结清单；`security/baseline` 是唯一的安全基线例外。维护脚本与完整文档以 `origin/fork-tooling` 为准；安全入口未包含文档时用 `git show origin/fork-tooling:docs/fork-maintenance.md` 读取，在 tooling worktree 中执行维护脚本。

- 根目录永远检出 `main`，个人 fork 的默认分支也设为 `main`：它等于 `fork-base/<tag>`（上游稳定 tag + `security/baseline`），普通 clone 和 BB 默认 worktree 因此包含安全修复。`origin/HEAD` 指向 `origin/main`；`scripts/fork-base` 同步远端 main 与干净的本地 main。不在根目录写产品代码；可以从已同步的 main 拉独立分支。
- 业务优先使用公开插件扩展点；迁移旧插件或核对淘汰决定时读 [插件迁出说明](docs/steward/plugin-extraction.md)，日常维护位置以功能索引为准。
- 新功能/修复：在 `fork-tooling` 的 worktree 中用 `scripts/fork-worktree <name>`，从 `fork-base/<base>`（基线 tag + `security/baseline`）拉 `feature/<name>` 或 `fix/<name>`；只有依赖另一 fork 分支时才叠在它上面。完成后推送到 `origin`，并在 `fork-tooling` 分支的 `.fork/branches` 登记一行。
- 安全基线：`security/baseline` 是所有 worktree 与聚合的唯一安全祖先，收纳已验收的安全修复及其必需的代码/测试适配；修复分支仍作为上游 PR 材料保留。安全修复完成后先合入 `security/baseline`、推送并运行 `scripts/fork-base --base <tag>` 更新 `fork-base/<tag>` 和 main；main 换 tag 可 force-with-lease，其他分支普通推送。新 worktree 默认从 main / origin/main 创建，也可显式选 fork-base；禁止从裸 tag、aggregate 或上游默认分支创建。已有 worktree 用 `git merge fork-base/<tag>` 后重新 `pnpm install --frozen-lockfile && pnpm prune`。
- 聚合打包：在 `fork-tooling` 的独立 worktree 中运行 `scripts/fork-package`，一条命令完成聚合、验证、提升、构建、发布 tag，串行执行，不要手工拆开并行；聚合只提升到 `aggregate` / `origin/aggregate`，根目录 main 保持安全基线。分支与上游冲突 → 回该分支 rebase 修复；分支之间冲突 → 在聚合 worktree 里只合并两边，rerere 记住。产品修复不写进聚合的 merge 提交。
- 发布收尾：功能、修复及影响安装产物的依赖改动完成必要验证与适用的 review 后，默认在整项任务最后统一执行 [发布流程](docs/fork-maintenance.md#3-发布预编译聚合包)，完成聚合、推送、tag 触发流水线及 Release 核验；已有持续授权，无需另问是否打包。纯规则与文档改动、已有发布的复用和用户明确要求不发布的处理以该流程为准；分支推送或清单登记完成不等于产品已发布。
- 上游反馈：分支就是 PR 材料；向 get-bb/bb 提 issue/评论/PR 前必须经用户逐项确认，状态记在 `.fork/branches`。
- 会停止、重启或替换当前 BB 服务的操作需要用户明确授权，使用 [local-aggregate-deploy](.bb/skills/local-aggregate-deploy/SKILL.md)。允许从 BB 线程内发起并在恢复后完成核验；停服到重新启动及失败回退由独立于目标服务的 systemd 任务执行，线程恢复使用 upgrade-resume 插件。不需要重启服务的 provider 配置、账号绑定和 dispatch alias 修改可由 BB 线程在用户已授权范围内直接完成并验证。

<!-- fork-maintenance:end -->
