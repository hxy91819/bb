# 功能维护与插件更新索引

修改功能或排查问题时，先按关键词找到维护仓库，再读该目录的 `AGENTS.md`、README 和实际源码。表中列的是维护边界，不是版本清单；插件成员以集合的 `.bb/plugins.json` 为准，核心活跃分支以本仓库 `.fork/branches` 为准。新增功能、改变职责、插件 ID 或迁仓时，在同一任务中同步本索引；当前版本和安装路径从目标实例实时读取。

## 按功能找维护位置

本次迁出的五个业务插件统一在 [hxy91819/bb-plugins](https://github.com/hxy91819/bb-plugins)，升级续跑在 [hxy91819/bb-plugin-upgrade-resume](https://github.com/hxy91819/bb-plugin-upgrade-resume)；已有的 Account Limits 和 Usage 继续使用各自仓库。BB 本体、公共 SDK 与仍随 BB 打包的插件在 [hxy91819/bb](https://github.com/hxy91819/bb)。旧团队、书签、图标仓库保留历史，当前实现使用集合仓库。

| 功能关键词                                                              | 应改的位置                                                                                                                                                                       | 边界与入口                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 团队、成员、Admin、身份头像、线程归属、成员活动                         | 集合 [`plugins/team`](https://github.com/hxy91819/bb-plugins/tree/main/plugins/team)，ID `team`                                                                                  | `src/members.ts`、`src/thread-list.ts`、`server.ts`、`app.tsx`；历史验收见[团队工作簿](steward/team-collaboration.md)                              |
| 会话书签、选中文字、收藏、右侧常驻书签、书签中英文                      | 集合 [`plugins/bookmarks`](https://github.com/hxy91819/bb-plugins/tree/main/plugins/bookmarks)，ID `bookmarks`                                                                   | `server.ts`、`app.tsx`、`contract.ts`、`i18n.ts`；历史验收见[书签工作簿](steward/message-bookmarks.md)                                             |
| ACP 图标、provider 头像、图标主题色                                     | 集合 [`plugins/acp-profile-icons`](https://github.com/hxy91819/bb-plugins/tree/main/plugins/acp-profile-icons)，ID `acp-profile-icons`                                           | `server.ts`、`app.tsx` 及该目录 README 的图标规范；原生图标点击区域错误归 BB                                                                       |
| 侧栏项目名、日期分组、项目标签宽度、移动端列表、父子行操作、侧栏偏好    | 集合 [`plugins/thread-list`](https://github.com/hxy91819/bb-plugins/tree/main/plugins/thread-list)，安装名 `thread-list`，ID `thread-list-extras`                                | `app/rows/ThreadRow.tsx`、`app/model/`、`shared/preferences.ts`；新定制先用贡献插槽，避免继续复制列表                                              |
| 自定义 ACP agent、DSH 注册、能力声明与探测、fork 策略、AGY 用量桥接     | 集合 [`plugins/provider-acp`](https://github.com/hxy91819/bb-plugins/tree/main/plugins/provider-acp)，安装名 `acp`，ID `acp-extensions`                                          | `src/configured-agents.ts`、`src/agents.ts`、`src/probe-capabilities.ts`、`src/usage-bridge.ts`；设置用 `bb plugin config acp-extensions`          |
| BB 升级、重启后恢复线程、升级继续消息、恢复批次                         | [`bb-plugin-upgrade-resume`](https://github.com/hxy91819/bb-plugin-upgrade-resume)，ID `upgrade-resume`                                                                          | `src/recovery.ts`、`src/store.ts`、`src/server.ts`；插件记录与续跑，实际服务替换走[部署技能](../.bb/skills/local-aggregate-deploy/SKILL.md)        |
| 订阅额度看板、Account Limits、多来源/账号池额度展示、重置预测、每周节奏 | [`bb-plugin-account-limits`](https://github.com/hxy91819/bb-plugin-account-limits)，ID `account-limits`                                                                          | 该仓库 README 与架构说明；读取公共额度接口，不注册可执行 agent，也不改变账号或模型路由                                                             |
| 本地 token 用量、费用估算、Usage 采集与报表                             | [`bb-plugin-usage`](https://github.com/hxy91819/bb-plugin-usage)，ID `usage`                                                                                                     | 使用个人 fork 的安装来源与发布说明；token/费用与订阅剩余额度是两个不同 owner                                                                       |
| 账号池、Codex 凭据文件导入、`--auth-file`、额度路由、AI fallback        | 本仓库 [`plugins/account-pool`](../plugins/account-pool)                                                                                                                         | `src/cli.ts`、`src/credentials.ts`、`src/operations.ts`、`src/hub.ts`；这是随 BB 打包的现有插件，随 BB 升级                                        |
| ACP resume/config、steer 投递、checkpoint/history、协议翻译、模型错误   | 本仓库 [`packages/provider-bridge-acp`](../packages/provider-bridge-acp)、[`packages/agent-runtime`](../packages/agent-runtime)、[`apps/server`](../apps/server)                 | 多个 agent 和原生界面共用的协议与状态修复；在 `.fork/branches` 对应核心分支维护，外置插件调用公共路径                                              |
| 原生触屏导航、输入框焦点、Add to chat、Queue/Steer、overlay 生命周期    | 本仓库 [`apps/app`](../apps/app) 及对应的 [`plugins/thread-list`](../plugins/thread-list)                                                                                        | 修复实际承载交互的公共控件；只影响外置列表定制的布局与偏好时回到集合                                                                               |
| 插件扩展点、创建上下文、列表贡献、活动查询、消息定位、常驻插件标签                    | 本仓库 [`packages/plugin-sdk`](../packages/plugin-sdk)、[`packages/sdk`](../packages/sdk)、[`apps/server`](../apps/server)、[`apps/app`](../apps/app)、[`apps/cli`](../apps/cli) | 公共扩展及 CLI/SDK/UI 共用实现；API 契约与用法以 Plugin Guide 为准                                                                                 |
| Codex/Claude/Pi provider 本身、provider 选择器、公共额度接口            | 本仓库 [`plugins`](../plugins) 及实际公共界面                                                                                                                                    | 在既有 provider 插件和公共实现修复；独立 ACP 适配器本身的登录、模型和技能注入归适配器仓库，如 [cursor-acp](https://github.com/hxy91819/cursor-acp) |
| Mermaid、Markdown、依赖漏洞、server/daemon、wire 协议、环境切换后继续   | 本仓库对应 `apps/`、`packages/` 与 `.fork/branches` 分支                                                                                                                         | “切换环境后继续”属于核心，与上面的“升级重启后续跑”分开维护                                                                                         |
| fork 分支、聚合、SDK 供应、打包发布、部署规则、本索引                   | 本仓库 `fork-tooling` 的 [`docs/fork-maintenance.md`](fork-maintenance.md)、[`scripts`](../scripts)、[部署技能](../.bb/skills/local-aggregate-deploy/SKILL.md)                   | 根目录 `main` 是聚合入口，维护分支是规则与索引的源；其他机器读取远端 `fork-tooling`，避免使用旧聚合里的旧规则                                      |

原生 Codex 多 home 入口（`Codex`、`Codex · L`）由内置 `provider-codex` 与核心参数传递共同实现，聚合输入为 `feature/codex-home-bindings`；保留要求见 `.fork/branches`。

`/side` 主输入框快捷入口与原生侧聊入口一起保留。移动端使用原生长按 Queue/Steer，不恢复常驻第二排队按钮。迁出决定、旧分支映射和验收历史见[插件迁出说明](steward/plugin-extraction.md)。

## 升级时同步外置插件

已授权的 BB 升级、环境更新和插件维护任务，默认同时检查上表中已安装的外置插件，有新版本就更新到目标 BB 可兼容、CI 已通过的最新提交。单独发布 BB 安装包时交付插件来源与兼容性信息；有目标实例更新授权时继续完成安装与验收，不另问是否顺带更新插件。

### 先辨认来源与更新内容

1. 用 `bb status --json`、`bb plugin list --json` 和 `bb plugin source <id> --json` 确认目标实例、实际来源和启停状态。私有保存更新前的源码 commit、配置、ACP provider ID、侧栏选择与偏好、书签数量和首条 ID，以及可回退的源码位置。运行路径和用户数据不写入本索引或 Git。
2. 按实际安装通道查询涉及仓库的远端 `main` 或最新兼容 Release 及对应 CI。比较 commit 与插件目录的实际差异，不能只看 `package.json.version`；同一版本号可能已有新的修复。集合只拉取一次，再处理其中已安装且有变化的成员；只有文档变化时记录已核对，无需重载业务插件。
3. 按目标 BB 的版本、实际 SDK 和插件 `engines`、README、供应记录确认兼容性。集合的 `bb-runtime.json` 是构建基线，可能早于待部署 BB；保留各插件 lockfile 的 SDK URL/integrity，使用匹配本机平台、tag 和 source 的基线包构建。不要把构建基线自动改成最新 BB 包，也不要用同版本的上游 npm SDK 替换 fork SDK。

### 按安装类型执行

| 实际来源                                            | 更新方式                                                                                                                                                                     | 完成凭据                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 跟踪分支或版本范围的 `git:` / `npm:`                | 用 `bb plugin outdated --json` 核对候选，再逐个执行 `bb plugin update <id> --yes`，等待更新任务结束                                                                          | `bb plugin source <id> --json` 的 resolved commit/版本已前进，目标插件状态与更新前一致      |
| `path:`，工作树干净且可快进到该仓库的已验证 `main`  | `git fetch origin main` 后 `git merge --ff-only --no-autostash origin/main`，按仓库 README 安装锁定依赖并构建；只对已启用且代码变化的插件执行 `bb plugin reload <id> --json` | 本地 commit 与选定远端一致，构建成功，重载结果及实际接口读回通过；原停用插件继续停用        |
| `path:`，有他人改动、开发分支或不能快进             | 保留原工作树，在稳定目录建立独立干净 checkout，构建后用 `bb plugin install path:<新插件目录> --yes --json` 移动同 ID 的安装来源                                              | source 已切换且 ID、启停状态、设置、secrets、schedules、数据库和 KV 保留；原源码留作回退    |
| `path:`，来源是解压的 Release 归档、没有 Git 工作树 | 从索引对应仓库检查最新兼容 Release，校验资产与 SHA256，在新的稳定目录解压，按其 README 准备后用 `bb plugin install path:<新插件目录> --yes --json` 移动同 ID 来源            | 核对版本、源码来源回执与新路径，保留原路径及配置数据；不对归档目录执行 `git pull`           |
| `builtin:`                                          | 随目标 BB 的已验证运行包更新                                                                                                                                                 | 包的 `release.json.source` 和实际加载状态一致；账号池和内置 provider 等无需从旧独立仓库另装 |
| 固定 Git tag/commit 或精确 npm 版本                 | 核对是否为用户保留的固定版本及可用新版本；普通更新命令不会移动固定来源。需要换来源时使用保留配置与存储的已验证迁移流程，不能把 `remove` 当作无损升级                         | 明确记录实际版本和迁移结果；不能安全迁移或暂不兼容时报告原因，不能记为“已更新”              |

`bb plugin update --all` 会跳过本地路径和内置插件，不能代替这份检查。当前迁出的五个插件和续跑插件允许使用稳定本地 checkout；路径本身不提供远端更新通道。首次从旧 ID/旧仓库迁移时，先读集合的 [docs/migration.md](https://github.com/hxy91819/bb-plugins/blob/main/docs/migration.md)，只对实际需要迁移的插件执行脚本；后续普通更新保留新 ID，不重跑首次迁移。

### 与服务切换一起收尾

- 旧 BB 能加载的新插件在停服前完成更新；`upgrade-resume` 先更新并确认后台服务运行，最后才 `prepare` 恢复批次。只兼容新 BB 的插件先准备好源码和构建，在新服务可用后继续更新；未完成时保留明确的待办原因。
- 更换或重载 `acp-extensions` 前确认 ACP 会话空闲，避免中断正在执行的任务。保持 `acp-*` provider ID、customAgents 和其余配置；旧内置 `provider-acp`、`thread-list` 的停用状态不因升级而恢复。
- 更新失败时回到已保存的源码 commit 或原路径并按原启停状态加载，保留迁移回执和用户数据；若版本含数据库迁移，按插件自己的迁移/回退契约处理。
- 验收读回插件状态、关键配置、书签数据、侧栏偏好和 ACP provider，核对恢复批次实际结果。交付各仓库/插件的更新前后 commit/版本、更新结果及尚未完成的项目。只有 BB 包已换新、插件源码仍旧，不能宣称整个环境更新完成。
