# Codebase Guidelines

## Task Completion

- Carry the requested change through implementation, relevant verification, and fixes for failures it causes. Continue authorized, reversible local work without asking for approval at each step; ask when a missing user decision blocks progress.
- Match verification to the change. Once relevant checks pass, broaden or repeat them only for new changes, failures, or unresolved concerns.
- 本仓库是用户自行管理的 fork。改动完成并通过相关验证及适用的 review 后，必须主动提交本任务改动，push 到个人远端 `fork` 的对应分支，并核对远端 SHA；无需再次询问，不得停在未提交或仅本地提交的状态。遵循下方来源分支与聚合维护规则，只提交本任务文件。验证或 push 受阻时明确报告未完成状态；此授权不包含推送上游或部署服务。
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

精确的功能状态、模块、一级来源、聚合映射、依赖、领域适配、规格与反馈角色以
[功能登记表](config/local-aggregate-features.json) 为唯一权威记录；稳定基线、完整补丁顺序和
验证入口由登记的 `config/local-aggregate-trains/*.json` 冻结。不要在本文件复制会过期的 SHA 表。
Provider 是首个两级领域，覆盖规格 #2、#5、#6、#8。后续产品功能按领域进入二级分支；仅独立的聚合维护补丁可直接进入列车。

维护规则：

1. 项目根目录的工作区必须永久停留在 `local/aggregate`；不得在这里切换到功能或修复分支，也不得在这里编写可回流的产品代码。聚合维护文档、登记表和脚本是唯一例外。
2. 每项后续功能或修复（包括其测试）开始前，必须创建或复用一个独立的一级 `feature/*` 或 `fix/*` 来源及 worktree；登记的有序提交定义该功能拥有的补丁，不以完整 ancestry 代替。休眠一级来源不因每个稳定 tag 强制 rebase。
3. 产品功能的一级补丁进入对应的二级领域分支和 worktree；领域层拥有稳定版兼容适配。每项适配必须记录原因、受影响的功能 ID 和来源映射。新增产品行为返回一级来源，不能成为无归属的领域修补。独立的聚合维护补丁可以直接纳入。
4. 一级和领域 worktree 负责实现、相关测试、提交、`$autoreview` 收尾和发布；在 review 无 accepted/actionable findings 前不算已验证。已验证来源、领域、贡献演练、不可变列车引用和候选须按清单发布到个人 fork；移动 ref 的已授权重建使用明确 lease，不得 force-push 上游。
5. [config/local-aggregate-features.json](config/local-aggregate-features.json) 分别记录稳定功能 ID、一级补丁版本、依赖、领域映射、旧打包记录，以及 `specIssue`、`upstreamFeedback`、`relatedIssues`、`disposition` / `reason`。缺少反馈记录 `needs-feedback`，内部修复记录 `internal`。冻结列车锁定稳定 tag/SHA、领域成员、共享依赖、直接补丁和验证入口；打包凭据在源码提交后记录最终 SHA、列车摘要、工具链与产物摘要。
6. 上游同步、领域升级和本地打包必须调用 [open-source-fork-maintenance](.bb/skills/open-source-fork-maintenance/SKILL.md)：先检查一级补丁增量或重写、领域状态、新分支、稳定版变化和反馈采纳信号。升级时保留休眠一级来源，在各二级领域分支适配最新 `desktop-v*` 稳定 tag，再由锁定列车依次组合领域提交和独立维护补丁；不得把已归属领域的一级补丁重新直入列车。`origin/main` 未进 tag 的提交只作为债务。用户明确不升级时可继续当前基线并报告债务。
7. 每次打包前必须先把已验证候选提升为根目录 `local/aggregate` 并推送到个人 fork；候选标签本身不能代替聚合发布。聚合根分支替换及个人 fork 发布无需再次授权；只有最终替换本机正在运行的 BB source 服务需要明确授权。以该服务为目标的打包、替换或替换后健康/回退验证必须调用 [local-aggregate-deploy](.bb/skills/local-aggregate-deploy/SKILL.md)；普通构建、测试和单纯聚合不调用它。另一环境从已聚合的不可变发布引用取得源码后仍须安装依赖并构建；发布、打包和部署状态必须分开记录。
8. 贡献提取只组合目标功能、明确依赖、相关领域适配和测试，不继承完整领域或 aggregate。聚合冲突回到拥有它的一级来源、共享依赖或领域适配修复。上游仅部分采纳时按所选稳定 tag 的实际行为逐项退役，issue 关闭或 trunk 合并不能单独触发移除。
9. fork 上登记的 issue 是本地规格记录；开源回流以上游仓库的 issue 为准。向 get-bb/bb 提交 issue 必须先经用户逐项确认：owner 可把改动归类为个人偏好或部署适配并保留 fork-only，该决定记入 feedback 文档。
<!-- open-source-fork-maintenance:end -->
