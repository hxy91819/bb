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

已登记的独立改动如下（未打包项明确标注；背景关联见登记表）：

| 独立分支 | 上次打包源提交 | 上次打包聚合提交 | 规格／反馈状态 | 目的 |
| --- | --- | --- | --- | --- |
| `feature/automation-auto-marker` | `694dec198` | `fbae7370f` | 个人偏好；规格：[hxy91819/bb#9](https://github.com/hxy91819/bb/issues/9) | 自动化触发的会话在派发时自动加 `[auto]` 前缀 |
| `feature/mermaid-elk-layout` | `e3460182b` | `df1d1972f` | 已反馈；上游：[get-bb/bb#3382](https://github.com/get-bb/bb/issues/3382) | 为 Mermaid 默认启用 ELK，保留 strict 安全配置 |
| `fix/vite-cve-2026-39363` | `42097e0e2` | `52bba2fc3` | 已反馈；上游：[get-bb/bb#1780](https://github.com/get-bb/bb/issues/1780#issuecomment-5612021454) | 固定 Ladle / Vitest 3 的传递 Vite 到 6.4.3 |
| `fix/local-aggregate-server-startup` | `b11109ea3` | `31d189905` | 内部维护 | 先监听再恢复线程，解除 host daemon 启动依赖环 |
| `fix/codex-fast-mode-toggle` | `200adda3e` | `2c63d38e0` | 上游行为分歧；上游：[get-bb/bb#3403](https://github.com/get-bb/bb/issues/3403) | fork 保留切换即保存和新线程 Fast 默认 |
| `feature/recent-explicit-work-sequence` | `0c0cfbe07` | `7f977eae2` | 反馈待更新；规格：[hxy91819/bb#1](https://github.com/hxy91819/bb/issues/1)；上游：[get-bb/bb#1614](https://github.com/get-bb/bb/issues/1614#issuecomment-5611939177) | server 持有的跨设备 Recent activity 排序 |
| `fix/local-aggregate-service-tier-migration` | `934b0800c` | `fa690d3ac` | 内部维护 | 兼容旧 Fast 列和 UI 设置迁移历史 |
| `fix/local-aggregate-recent-sequence-migration` | `c4ba8d541` | `f0aff25a8` | 内部维护 | 保留 Recent 值，补跑被旧时间戳跳过的稳定版迁移 |
| `feature/dsh-acp-provider` | `534713319` | `c4aeed295` | 待反馈；规格：[hxy91819/bb#2](https://github.com/hxy91819/bb/issues/2) | ACP 分组模型、session/resume 与 DeepSeek Harness |
| `fix/acp-fast-mode` | `f82a35506` | `c9d64614b` | 待反馈；规格：[hxy91819/bb#5](https://github.com/hxy91819/bb/issues/5) | 将 Fast/default 应用到 ACP 原生配置 |
| `fix/acp-codex-goal` | `3f755edd4` | `52fc78e04` | 待反馈；规格：[hxy91819/bb#6](https://github.com/hxy91819/bb/issues/6) | ACP Codex goal 状态和受能力约束的 clear |
| `fix/markdown-table-breakout` | `b14e93e3d` | `19b1104a4` | 已反馈；规格：[hxy91819/bb#3](https://github.com/hxy91819/bb/issues/3)；上游：[get-bb/bb#1705](https://github.com/get-bb/bb/issues/1705#issuecomment-5649924011) | 宽表正文栏内滚动、按需全屏展开 |
| `fix/environment-switch-auto-continue` | `4edc38001` | `9ec663a50` | 待反馈；规格：[hxy91819/bb#7](https://github.com/hxy91819/bb/issues/7) | 环境目录切换后单次继续，并安全迁移 Pi session |
| `feature/thread-project-label` | `a268b26c7` | `4da88e8da` | 待反馈；规格：[hxy91819/bb#4](https://github.com/hxy91819/bb/issues/4) | 在线程列表和固定树中显示项目标签 |
| `fix/sidebar-parent-row-hover-archive` | `3aa38d9f7` | `9da5c55d9` | 上游行为分歧；上游：[get-bb/bb#3821](https://github.com/get-bb/bb/issues/3821) | fork 保留父线程行隐藏快捷归档的行为 |
| `fix/sidebar-touch-hover-actions` | `ac8417dac` | `7435b9bef` | 已反馈；上游：[get-bb/bb#3832](https://github.com/get-bb/bb/issues/3832) | 无 hover 的触摸设备不显示快捷归档或收缩线程标题 |
| `fix/local-aggregate-project-row-test-residue` | `12709f8dd` | `85f92ac37` | 内部维护 | 清理已移除 ProjectRow headerActions 契约的旧聚合测试残留 |
| `fix/local-aggregate-migration-history-cleanup` | `e39b496fb` | `4569551b1` | 内部维护 | 移除旧聚合回流的重复迁移文件和倒序 journal 条目 |
| `fix/acp-mid-turn-steering` | `cf5207ff3` | `096d4dcab` | 待反馈；规格：[hxy91819/bb#8](https://github.com/hxy91819/bb/issues/8) | ACP 中原生 mid-turn steer，按实际投递标注 steer/interrupted/queued |
| `feature/side-chat-command` | `7c130e9ec` | `b92da9b86` | 待反馈；规格：[hxy91819/bb#10](https://github.com/hxy91819/bb/issues/10) | 线程输入框 `/side` 命令直接打开 side chat，仅在可 fork 时出现 |
| `feature/sidebar-pinned-new-thread` | `3d4cc28a2` | `bd5fc41da` | 待反馈；规格：[hxy91819/bb#11](https://github.com/hxy91819/bb/issues/11) | New thread 固定在侧栏顶部，其余导航项随线程列表滚动 |
| `fix/sidebar-touch-navigation` | 待打包 | — | 待反馈 | 区分触摸导航与鼠标标题重命名；待打包 |
| `fix/official-catalog-date-utc` | 待打包 | — | 待反馈 | 规范化官方 marketplace 的 UTC 提交日期；待打包 |

Provider 是首个两级试点领域，覆盖规格 #2、#5、#6、#8。其当前一级补丁选择、
依赖、领域映射和稳定版基线以
[config/local-aggregate-features.json](config/local-aggregate-features.json) 为准；
列车选择以登记的 `config/local-aggregate-trains/*.json` 为准。表中旧打包 SHA 仍是
历史 aggregate 记录，不代表当前领域实现。Mermaid 等低耦合补丁仍可直接纳入列车。

维护规则：

1. 项目根目录的工作区必须永久停留在 `local/aggregate`；不得在这里切换到功能或修复分支，也不得在这里编写可回流的产品代码。聚合维护文档、登记表和脚本是唯一例外。
2. 每项后续功能或修复（包括其测试）开始前，必须创建或复用一个独立的一级 `feature/*` 或 `fix/*` 来源及 worktree；登记的有序提交定义该功能拥有的补丁，不以完整 ancestry 代替。休眠一级来源不因每个稳定 tag 强制 rebase。
3. 相关一级补丁可进入独立二级领域分支和 worktree；领域层拥有稳定版兼容适配。每项适配必须记录原因、受影响的功能 ID 和来源映射。新增产品行为返回一级来源，不能成为无归属的领域修补。低耦合补丁可以保持直接纳入。
4. 一级和领域 worktree 负责实现、相关测试、提交、`$autoreview` 收尾和发布；在 review 无 accepted/actionable findings 前不算已验证。已验证来源、领域、贡献演练、不可变列车引用和候选须按清单发布到个人 fork；移动 ref 的已授权重建使用明确 lease，不得 force-push 上游。
5. [config/local-aggregate-features.json](config/local-aggregate-features.json) 分别记录稳定功能 ID、一级补丁版本、依赖、领域映射、旧打包记录，以及 `specIssue`、`upstreamFeedback`、`relatedIssues`、`disposition` / `reason`。缺少反馈记录 `needs-feedback`，内部修复记录 `internal`。冻结列车锁定稳定 tag/SHA、领域成员、共享依赖、直接补丁和验证入口；打包凭据在源码提交后记录最终 SHA、列车摘要、工具链与产物摘要。
6. 上游同步、领域升级和本地打包必须调用 [open-source-fork-maintenance](.bb/skills/open-source-fork-maintenance/SKILL.md)：先检查一级补丁增量或重写、领域状态、新分支、稳定版变化和反馈采纳信号。默认在领域层适配最新 `desktop-v*` 稳定 tag，再由锁定列车构造候选；`origin/main` 未进 tag 的提交只作为债务。用户明确不升级时可继续当前基线并报告债务。
7. 聚合根分支替换及个人 fork 发布无需再次授权；只有最终替换本机正在运行的 BB source 服务需要明确授权。以该服务为目标的打包、替换或替换后健康/回退验证必须调用 [local-aggregate-deploy](.bb/skills/local-aggregate-deploy/SKILL.md)；普通构建、测试和单纯聚合不调用它。另一环境从不可变引用取得源码后仍须安装依赖并构建；发布、打包和部署状态必须分开记录。
8. 贡献提取只组合目标功能、明确依赖、相关领域适配和测试，不继承完整领域或 aggregate。聚合冲突回到拥有它的一级来源、共享依赖或领域适配修复。上游仅部分采纳时按所选稳定 tag 的实际行为逐项退役，issue 关闭或 trunk 合并不能单独触发移除。
9. fork 上登记的 issue 是本地规格记录；开源回流以上游仓库的 issue 为准。向 get-bb/bb 提交 issue 必须先经用户逐项确认：owner 可把改动归类为个人偏好或部署适配并保留 fork-only，该决定记入 feedback 文档。
<!-- open-source-fork-maintenance:end -->
