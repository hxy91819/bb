# BB 插件迁出与维护收敛

日常功能定位和升级时同步外置插件，以[功能维护与插件更新索引](../feature-index.md)为入口。本文保留迁出决定与验收历史，不维护另一份当前版本或活跃分支清单。

本轮用户授权：2026-10-17 采纳插件可行性与淘汰建议，授权实现、建仓库及选择仓库组织；随后明确把现有团队、书签、图标插件也统一迁入集合。后续明确授权替换当前 BB 服务，并使用 upgrade-resume 准备线程恢复。

## 维护位置

业务插件统一维护在 [hxy91819/bb-plugins](https://github.com/hxy91819/bb-plugins)。插件成员与安装名以该仓库 `.bb/plugins.json` 为准；BB 核心聚合输入仍只以本仓库 `.fork/branches` 为准。

新增个性化行为先核对公开插件扩展点。已有插槽能实现时使用小型附加插件；必须改变原生列表交互时才维护列表插件副本。共享协议、原生正确性与原子创建等能力留在公共实现。不要仅为七行 warning 过滤复制整个 provider。

## 本轮决定

- 团队、书签、图标保留已有插件 ID 和存储格式，迁入同一仓库；旧仓库保留历史并指向新维护位置。
- 侧栏与 ACP 定制使用独立 ID，避免占用内置插件保留 ID；迁移复制既有偏好和 customAgents，保留 acp-* provider ID。
- 原生侧聊保留，退出 `/side` 专用 typeahead；移动排队保留原生长按菜单，退出第二按钮及附带 ghost 样式；未配置的 Codex home bindings 退出聚合。
- DSH 注册和自定义 fork 策略归 ACP 插件；resume/config、steer 投递及 checkpoint/history/probe 属于共享协议，保留独立核心分支。
- 账号池 fallback 保留在现有账号池插件。其 hub、凭据和配置由该插件持有，普通附加插件没有等价调用契约，复制账号池将增加维护。
- 头像宽度修复回到列表贡献功能分支。过时缓解与独立设计分支结束活跃维护；纯设计项不再作为产品输入聚合。
- 去掉已发布的 Codex home wire 字段后，daemon 协议版本提升到 235，超过此前发布的 234。

## 本次盘点结果

本节记录 2026-10-17 的收敛决定；后续活跃分支只维护 `.fork/branches`。原有 43 条产品输入收敛为 29 条，17 条退出、3 条共享能力替代分支加入。

| 原分支或功能                                                                                                           | 本次处理         | 后续位置与原因                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| 团队、消息书签、ACP 图标                                                                                               | 迁入集合         | `team`、`bookmarks`、`acp-profile-icons`，保留 ID、存储和历史；旧三仓库已归档  |
| `feature/thread-project-label`、`feature/sidebar-date-groups`、`fix/sidebar-parent-row-hover-archive`                  | 迁出             | 集合 `thread-list-extras`；个性化侧栏布局、分组与操作                          |
| `fix/thread-project-label-width`                                                                                       | 随标签迁出       | 集合列表组件；不再独立维护核心补丁                                             |
| `feature/dsh-acp-provider`                                                                                             | 拆分             | DSH 注册归集合 `acp-extensions`；resume/config 修复归共享核心                  |
| `feature/acp-custom-fork`、`feature/custom-acp-fork`、`feature/custom-acp-checkpoint-fork`、`fix/acp-checkpoint-probe` | 拆分并合并职责   | agent 声明和自定义探测策略归集合；bridge、checkpoint 与历史设置归共享核心      |
| `feature/acp-custom-agent-icon`                                                                                        | 迁出             | 集合 `acp-profile-icons`；provider 图标插槽已足够                              |
| `fix/acp-mid-turn-steering`                                                                                            | 替换             | 独立 `fix/acp-steering-delivery`；共享协议投递和时间线必须一致                 |
| `fix/leading-thread-avatar-layout`                                                                                     | 收回基础分支     | `feature/plugin-thread-list-contributions`；通用行装饰布局属于贡献 API         |
| `feature/side-chat-command`、`fix/side-chat-main-composer`                                                             | 淘汰             | 移除 `/side` 专用补全，保留原生侧聊入口与聚焦修复                              |
| `feature/mobile-queue-action`                                                                                          | 淘汰             | 移除常驻第二按钮，保留原生长按 Queue/Steer                                     |
| `feature/codex-home-bindings`                                                                                          | 淘汰             | 未配置的额外 home 映射与整条 wire/UI 维护链退出                                |
| `feature/child-report-delivery`、`fix/acp-mid-turn-steering-design`                                                    | 结束活跃维护     | 纯设计资料留在归档历史，不参与产品聚合；其他尚未登记的通知候选不在本次删除范围 |
| `fix/empty-long-timeline`、`fix/mobile-display-options`                                                                | 结束活跃维护     | 过时历史分支只留归档，不重新加入聚合                                           |
| `fix/pool-ai-fallback`                                                                                                 | 保留现有插件实现 | `plugins/account-pool`；另起插件会复制池 hub、凭据和配置                       |
| `fix/codex-compaction-warning`                                                                                         | 保留小补丁       | 七行 warning 过滤；复制整个 Codex provider 增加维护成本                        |

以下能力保留在核心或其原有插件，保持各自可提交上游的分支：

| 能力                 | 保留的分支                                                                                                                                                                                 | 原因                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| ACP 会话与模型正确性 | `fix/acp-resume-config-options`、`fix/acp-steering-delivery`、`feature/acp-checkpoint-fork`、`fix/acp-model-config-error`、`fix/acp-model-discovery-errors`、`fix/acp-skills-prompt-paths` | 公共 bridge、协议和运行状态必须由原生与插件共用             |
| 插件公共扩展         | `feature/plugin-thread-context`、`feature/plugin-thread-list-contributions`、`feature/thread-activity-query`、`feature/thread-message-navigation`                                          | 原子创建、SQL 查询和消息定位需要服务端/共享 UI 的正式扩展点 |
| 原生交互正确性       | `fix/sidebar-touch-navigation`、`fix/sidebar-new-thread-project`、`fix/provider-icon-hitbox`、`fix/side-chat-open-focus`、`fix/mobile-add-to-chat`、`fix/plugin-overlay-recovery`          | 修复核心已有控件和生命周期；附加插件无法可靠替换            |
| 全局产品行为         | `feature/hidden-providers`、`feature/child-turn-author`、`feature/browser-remote-editor`                                                                                                   | 选择器策略、通知来源事实及浏览器配置需共享核心状态          |
| 渲染和安全           | `feature/mermaid-elk-layout`、`fix/markdown-table-breakout`、`fix/vite-cve-2026-39363`、`fix/dependency-security`                                                                          | 公共渲染路径或依赖漏洞修复                                  |
| 基础运行与维护       | `fix/local-aggregate-server-startup`、`fix/official-catalog-date-utc`、`fix/environment-switch-auto-continue`、`fix/git-fixture-isolation`                                                 | 启动、目录解析、自动继续和测试隔离属于原有实现              |

## 交付进度

- [x] 核对并记录迁移前 refs，保留并发工作现场。
- [x] 提取五个插件；既有三个 ID 不变，列表/ACP 使用新 ID。
- [x] 拆出共享 ACP 分支，保留回放记录、服务端回归与可选真实适配器验收。
- [x] 五包独立构建、622 项测试、类型/格式/lint/依赖审计通过；全新实例的正常迁移和书签失败回退通过。
- [x] 仅安装生产依赖且禁用安装脚本后，五个插件仍能独立构建；lockfile 未改。
- [x] 插件集合独立审查通过；公开仓库、首轮 CodeQL 和全历史密钥扫描完成，零告警。
- [x] 既有团队、书签、图标安装源已迁移；旧三仓库已加迁移指引并归档。
- [x] 核心全仓类型检查、受影响包测试和独立源码实例 UI 验收通过。
- [x] 核心独立审查通过，正式分支已推送并核对远端 SHA。
- [x] 权威清单收敛至 29 条产品分支；20 条旧远端分支已删除并保留归档 tag；聚合产品树与已验证候选一致。
- [x] 本机侧栏已切换到 `thread-list-extras`，偏好读回一致，内置列表停用；团队保持原停用状态。
- [x] ACP 会话空闲后已切换到 `acp-extensions`，配置、provider ID 和原有会话读回一致；五插件运行迁移完成。
- [x] 发布受检聚合包并替换当前 BB 服务；实际包身份、健康、机器连接、插件状态与持久化设置核验通过。

## 接续与验证

集合检查证据见 [迁移与回退 CI](https://github.com/hxy91819/bb-plugins/actions/runs/39006098137)。20 个被替代或历史分支已在个人远端保全为 `archive/plugin-extraction-20261017/<原分支名>` tag；替代分支验收并推送后，旧活跃远端分支已用 SHA lease 删除。其他任务的本地工作树和未提交改动保留。

全仓类型检查共 102 项任务通过；前端 5,722 项、服务端 3,465 项测试通过，见 [核心 CI 各独立 job](https://github.com/hxy91819/bb-plugins/actions/runs/39007709103)。该 run 的失败 job 是已修复的临时 UI 夹具准备；核心类型与两个整包测试 job 均成功。三个重建 ACP 分支分别在自身依赖树通过类型与测试，见 [独立分支 CI](https://github.com/hxy91819/bb-plugins/actions/runs/39008073663)。另有 8 个受影响包测试、11 项维护脚本测试通过，两轮独立审查均无 P0/P1。

[源码 UI 与公开 Git 集合冷安装](https://github.com/hxy91819/bb-plugins/actions/runs/39009007741) 已通过：真实点击侧栏父子线程、项目标签与日期分组、发送字面 `/side`、触屏长按打开 Queue 并读回实际队列；截图已人工读取。移动端使用 Chromium 触屏仿真，未运行 iOS Simulator。精确受检源码保留在 `archive/plugin-extraction-20261017/verified-source`，最终聚合产品树保持一致。临时源码验收工作流与辅助脚本不进入集合长期维护。

集合仓库的 README 和 docs/migration.md 是实际安装与迁移入口。迁移脚本先保存配置；已登记 Git 来源的书签切换后核对数量与首条 ID；本地路径移动保留启用状态。测试使用独立实例与合成数据，用户库与迁移回执不进入 Git。

2026-10-17 已确认所有 ACP 会话空闲并完成本机运行迁移：`acp-extensions` 从集合 `plugins/provider-acp` 正常运行，原内置 `provider-acp` 已停用。两项自定义 agent 配置、8 个全局 `acp-*` provider ID、本机可用的 Amp/Devin/DSH 与原有会话均经迁移前后读回核对。五个插件的本机安装源至此全部迁入集合，团队继续保持原停用状态。后续 ACP 配置使用 `bb plugin config acp-extensions`；旧内置插件配置仍保留供回退。迁移没有重启或替换 BB 服务。

随后已按新增授权，通过独立 systemd 任务完成当前 BB 服务替换，使用 [fork-v0.46.0-20261017.1](https://github.com/hxy91819/bb/releases/tag/fork-v0.46.0-20261017.1)，源码 `914916f11bb632b5d3151ecd117a277cebe7ca6c`。[发布 CI](https://github.com/hxy91819/bb/actions/runs/39039677317) 四个平台、实际解包运行及 SDK 验证全部通过，11 个资产发布齐全。本机包与公开 SHA256 一致；切换前已冷备份数据库并保留旧安装包。切换后 Server、Daemon、机器连接正常，未发生服务自动重启；ACP 配置、侧栏选择与偏好、书签数量均经真实接口读回确认一致。

本次线程由用户手动继续，自动续跑未成功：停服时 Provider 先退出，只产生 `provider_process_exited` 错误，没有 `host-daemon-restarted` 线程中断记录。原批次因此等待，用户继续后按新请求跳过。已在独立 [upgrade-resume 插件修复](https://github.com/hxy91819/bb-plugin-upgrade-resume/commit/ce75b89364c60cb7609b0742ed48c05772f8a640)：对已准备且 Server 进程已改变的批次，接受发生于当前 Server 启动前的结构化 Provider 退出事件；保留人工停止、新请求、已完成和排队工作的排除规则。修复已构建并热重载，18 项测试及类型、格式检查通过，回归在原生产代码上确认失败。没有再次重启当前服务，修复后的实际重启续跑仍待后续升级验收。

后续 BB 侧按 fork-maintenance.md 验证并推送；服务切换按 local-aggregate-deploy，通过独立 systemd 任务执行并在恢复后核验。

## 用户待办

无。五个插件的迁移及当前 BB 服务替换均已完成。

## 2026-10-19 原生 Codex 多账号恢复

用户随后明确要求退出账号池，恢复 `Codex` 与 `Codex · L` 两个原生入口。此前“未配置所以退出聚合”的判断不再适用；重新纳入 `feature/codex-home-bindings`，使用原生 Codex 插件的 `homeBindings` 配置独立 home，不复制原生 provider，也不由额度面板注册入口。绑定登录、执行、模型、额度与技能均跟随所选 home，现有 `auth.json` 软链继续由 Codex 读取和刷新；两个入口共用原生插件的记忆开关。

重新引入 host options wire 字段时，daemon 协议从已发布的 235 提升至 236。功能分支登记与推送不等于运行服务已经升级；安装包替换和双入口运行验收需按部署流程完成后才能记为生效。
