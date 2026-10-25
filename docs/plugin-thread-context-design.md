# 通用线程创建上下文、列表贡献与团队活动查询实施契约

状态：设计交付，尚未实现。源码核对基线为 `desktop-v0.46.0`（`4c87fdec7b7effc022ff2ee31ec95c0a09c9ee62`）。本文给下一阶段实现者提供唯一推荐方案与行为验收，不宣称下述新接口已可用。公开 API 的使用说明随实现进入 Plugin Guide；本文保留设计理由、共同调用路径和验收契约，不成为第二份接口手册。

## 1. 已确定的产品约定与设计边界

用户已确定：独立团队插件复用原生创建与现有 thread-list；人工创建时附带客户端选择的身份；受信团队自选身份；首个完成初始化者为唯一管理员，管理员只负责创建后续成员；成员可修改自己的姓名和预设头像；memberId 固定；Agent 能查询团队工作进展且控制上下文占用。团队插件计划独立发布为 `hxy91819/bb-team`，本阶段不创建仓库、不生成头像、不实现产品代码。

**“归属成员”不是“真实创建者”或“实际操作者”。** 线程保存固定 memberId；显示时连接成员当前资料。人工新建与人工 fork 取本次提交快照，Agent 子线程可以由插件继承 parentThreadId 的归属。没有上下文且没有可继承关系的线程保留未归属。既有线程不凭标题、机器、模型或插件 origin 猜身份。活动报告统一称“归属该成员的 BB 工作进展”，不作考勤或人工操作审计。

本轮父线程已裁决：活动查询使用有界事实与无状态游标；列表采用 app-wide useData 加纯投影；身份使用持久默认加窗口覆盖；时区自动预填并沿普通插件 settings 修改，管理员权限仍只用于创建成员。这些是本轮确定约定，具体实现仍未落地。

本体负责收集上下文、校验、调用贡献者、原子保存、通用查询和列表贡献宿主。插件负责成员、继承策略、标签内容、分组定义和查询解释口径。不开辟账号认证、密码、邮箱注册、通用权限系统、任意请求中间件或独立 AI 服务。

## 2. 源码事实与落点

以下是当前行为，不是拟新增能力。链接相对本设计文件；符号是阅读入口。

| 事实                                                                           | 仓库证据及影响                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create/fork 的 pluginMetadata 只接受 origin=plugin，并要求 originPluginId      | [threads.ts](../packages/server-contract/src/api/threads.ts)：`createThreadRequestSchema`、`forkThreadRequestSchema`。保留原有校验；不能借改 origin 表示团队身份。                                                                                                                                                                                                                                                                                                                                       |
| 浏览器和后端插件 SDK 自动补插件归因                                            | [plugin-bound-sdk.ts](../apps/app/src/lib/plugin-bound-sdk.ts)、[plugin-api.ts](../apps/server/src/services/plugins/plugin-api.ts)：`withPluginThreadAttribution` 调用；[app-contract.ts](../packages/plugin-sdk/src/app-contract.ts)：`PluginBoundThreadsArea`、`NewThreadRequest`。                                                                                                                                                                                                                    |
| 根编辑器与插件编辑器复用同一提交实现                                           | [RootComposeView.tsx](../apps/app/src/views/RootComposeView.tsx)：`handleSubmit`；[NewThreadComposer.tsx](../apps/app/src/components/promptbox/NewThreadComposer.tsx)：`submitDraft`；[PluginNewThreadComposer.tsx](../apps/app/src/components/plugin/PluginNewThreadComposer.tsx)：`handleSubmit`。插件组件只回调请求，插件仍决定 filing/attribution。                                                                                                                                                  |
| 创建服务已经集中，fork 是适配器                                                | [base.ts](../apps/server/src/routes/threads/base.ts)：create/fork routes；[thread-fork.ts](../apps/server/src/services/threads/thread-fork.ts)：`createThreadForkFromRequest` → [thread-create.ts](../apps/server/src/services/threads/thread-create.ts)：`createThreadFromRequest` → `createPendingThreadAndAttemptFirstDispatch`。                                                                                                                                                                     |
| thread row 与一个 namespace 的初始 metadata 已经原子写入                       | [thread-create-helpers.ts](../apps/server/src/services/threads/thread-create-helpers.ts)：`createThreadRecord` → [threads.ts](../packages/db/src/data/threads.ts)：`createThread`，immediate transaction 内调用 `insertThreadPluginMetadata`；通知在事务之后。扩展内部输入为多个 namespace 即可。                                                                                                                                                                                                        |
| metadata 是现成独立表，不需要成员列                                            | [schema.ts](../packages/db/src/schema.ts)：`threadPluginMetadata`，主键 `(threadId, pluginId)`，删除线程 cascade；[thread-plugin-metadata.ts](../packages/db/src/data/thread-plugin-metadata.ts)：定向批读、插入、patch。                                                                                                                                                                                                                                                                                |
| 插件已有独立 SQLite、迁移、RPC、实时通知                                       | [backend-contract.ts](../packages/plugin-sdk/src/backend-contract.ts)：`PluginStorage.database/migrate`、RPC、realtime；数据库 handle 按加载代际管理，WAL、busy_timeout 5000，迁移 append-only。                                                                                                                                                                                                                                                                                                         |
| thread-list 是 bundled 插件，没有另一份 core 内置完整列表                      | [app.tsx](../plugins/thread-list/app.tsx)：`experimental_threadList`；[api_to_audit.md](api_to_audit.md)：同名条目；[preferences.ts](../plugins/thread-list/shared/preferences.ts)：project/chronological/machine 三种组织模式。                                                                                                                                                                                                                                                                         |
| 树、环境聚合、排序、拖拽和触摸已有实现                                         | [project-thread-groups.ts](../plugins/thread-list/app/model/project-thread-groups.ts)、[machine-thread-groups.ts](../plugins/thread-list/app/model/machine-thread-groups.ts)、[ProjectList.tsx](../plugins/thread-list/app/list/ProjectList.tsx)、[useSectionThreadDnd.ts](../plugins/thread-list/app/dnd/useSectionThreadDnd.ts)、[sidebarTouchSensor.ts](../plugins/thread-list/app/dnd/sidebarTouchSensor.ts)、[ThreadRow.tsx](../plugins/thread-list/app/rows/ThreadRow.tsx)。贡献者不重建这些行为。 |
| 现有元数据列表只接受已知 threadIds；线程列表没有 metadata/member/date 活动过滤 | [threads.ts](../packages/server-contract/src/api/threads.ts)：`pluginThreadMetadataListRequestSchema`、`threadListQuerySchema`、`threadEventsQuerySchema`；事件查询只有单线程 sequence/types/order/limit。不能靠现有 list API 高效完成成员跨线程日期查询。                                                                                                                                                                                                                                               |
| 事件带时间和线程内序号，但会被剪裁/改写                                        | [schema.ts](../packages/db/src/schema.ts)：`events`；[events.ts](../packages/db/src/data/events.ts)：`listStoredEventRows`；[event-rewrite-generation.ts](../packages/db/src/data/event-rewrite-generation.ts)、[event-output-truncation.ts](../packages/db/src/data/event-output-truncation.ts)。只能证明保留的证据。                                                                                                                                                                                   |
| fork 会复制来源的历史事件，保留原 createdAt                                    | [thread-fork-history.ts](../apps/server/src/services/threads/thread-fork-history.ts)：copyForkSourceHistory/selectInheritedForkEventRows；[events.ts](../packages/db/src/data/events.ts)：copyStoredThreadEventsInTransaction。活动统计必须排除继承片段，否则会把 A 的历史重复算到新归属 B。                                                                                                                                                                                                             |

## 3. 推荐创建接口

### 3.1 最小形状

以下名称均为**拟新增**；所有新增 public member、导出类型与 wire 字段以 `experimental_` 起名。复用现有 JsonValue/JsonObject、Standard Schema、ThreadCreateOrigin、ThreadOriginKind 等术语与型别，不另造“团队创建请求”。

| 接口                                                                                    | 精确职责                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.experimental_threadCreationContext.register({ capture })`                          | 每插件、每前端加载代际一个贡献者，host 绑定 pluginId；`capture()` **同步**返回 `JsonValue \| undefined`，只读取本客户端选择。返回 disposer，卸载也自动注销。同步快照避免跨 await 后身份漂移。                                                                   |
| create/fork/`NewThreadRequest.experimental_pluginContext?: Record<pluginId, JsonValue>` | 只承载提交快照，与 origin 完全独立；省略规范化为 `{}`。可显式传空对象，表示已经收集且没有贡献。普通 SDK/CLI 不推断浏览器身份。                                                                                                                                  |
| `bb.experimental_threadCreationContext.register({ input, prepare })`                    | 每插件一个后端处理器；input 为验证该插件上下文的 Standard Schema。`prepare` 收到 typed `context`（有/无的判别联合）、规范化创建描述、自己的 legacy seed、自己的 parent/source metadata、AbortSignal；异步返回 `JsonObject \| null`，只产生本插件初始 metadata。 |

规范化描述只包含 `projectId, origin, originPluginId, originKind, parentThreadId, sourceThreadId, startedOnBehalfOf`，缺席的关系用 null；这些字段完成本体现有关系校验后再提供。不把原始完整 prompt、其他插件上下文、其他 namespace 的 metadata 或可写 request 交给处理器。parent/source 读取只限对应线程和当前 pluginId；handler 需要其他资料时可用已有 SDK 定向读取。输出是新增键集合，null 表示不贡献；不允许 handler 修改线程核心字段或给别的 pluginId 写入。

旧 `pluginMetadata` 仍按旧规则变成 originPluginId 的 seed；新增结果与 seed 按顶层键合并。任何重复键（即使值相同）报 `plugin_context_metadata_conflict`，不按加载顺序覆盖。无新贡献时，旧调用行为完全相同。处理器通过看到自己的 seed 主动避让；团队插件自行拥有 `memberId`，其他插件的 seed 不受影响。

### 3.2 前端共同路径与身份时点

新增内部 `captureThreadCreationContext` 统一读取注册表并 deep-clone/校验 JSON。`NewThreadComposer.submitDraft` 在置 submitting 后、清草稿前调用；收集失败不清草稿。`useCreateThread`、手动 fork、浏览器 plugin-bound SDK 的 spawn/fork 均使用同一个 `withThreadCreationContext`：字段不存在才捕获，已存在则原样传递。因此编辑器 → hook → SDK 不会重复采集；插件经 RPC 转发也保持快照。原生入口必须使用这一路径，不提供团队专用按钮或复制编辑器。

快照发生在用户最终提交时，不在打开创建页面时。collector 不包含网络等待；身份选择 UI 预先完成成员读取。提交开始后切换身份，只影响下一次提交；每窗口维护自己的有效选择，不能在异步 handler 内读取全局“当前成员”。未选择身份时贡献者返回 undefined，UI 可以提示选择，但本期不强迫用户选择或阻断原生创建。

`NewThreadComposer` 已有 `clearIfCurrentMatches/restoreIfEmpty`，保持附件、mention 和用户提交后新输入的草稿。handoff 编辑器也使用同一恢复规则。已知未提交失败时恢复原草稿，再次点击是新提交，重新捕获选择；网络结果未知时不自动重发创建 POST，告知检查列表后显式重试。当前 schema 没有创建幂等键，**本期不承诺 exactly-once、不新增持久化幂等账本**。SDK/CLI 调用者若自行重试须原样复用上下文以保持归属，但可能得到两个线程；首次 dispatch 的重试不再次运行创建贡献者，不改变已保存归属。

### 3.3 后端执行、原子性和失败

1. 在 `createThreadFromRequest` 的公共路径完成现有项目、origin、parent/source 与请求校验；快照当前已启用后端注册代际。
2. 对每个已注册处理器调用 prepare，包括请求中没有该插件 context 的情况，以支持继承。请求带有未注册、停用或未知 pluginId 的 context 时明确失败 `plugin_context_unavailable`，不静默丢失显式归属。请求没有该 key 且插件停用时没有处理器，原生行为恢复。
3. 宿主验证每个 namespace 的输入，再并行执行独立 prepare，全部完成后统一验证输出；注册次序不得影响结果。复用 [plugin-hook-registry.ts](../apps/server/src/services/plugins/plugin-hook-registry.ts) 的隔离/日志及现有 10 秒 decision timeout 约定。handler 抛错、超时、非法输出或冲突使创建失败，无 thread row。
4. pluginId 由注册宿主绑定。上下文是受信会话提交的自述数据，不是认证凭据；HTTP/CLI 可以显式构造它，不能宣传为防冒名。JSON 边界复用 [plugin-metadata.ts](../packages/domain/src/plugin-metadata.ts) 的严格校验和每 namespace 256 KiB 限制；新增上下文 map 限制 32 namespaces、总编码 256 KiB。metadata 输出每 namespace 沿用 256 KiB，新增贡献总量限制 1 MiB；旧 seed 单独保留原限额。超限返回命名错误，无截断。
5. 所有 await、插件 SQLite 查询与 RPC 在核心写事务外完成。prepare 必须无持久化副作用；不要先在插件 DB 登记“创建了线程”，也不要试图做跨 SQLite 事务。后台生成、首消息派发仍由现有路径执行。
6. 写入前同步核对加载代际仍有效；注销中止 signal，迟到结果丢弃，返回 `plugin_context_changed`。事务中无 await；已经提交后的停用不回滚线程。前端过时代际收集同样失败，下一次新提交重新收集。
7. 将 [thread-create-request.ts](../apps/server/src/services/threads/thread-create-request.ts) 的内部单 namespace 改为规范化列表，沿 createThreadRecord 传入 DB。`createThread` 的同一 immediate transaction 插入线程与所有非空 metadata；任何一个 insert 失败整笔回滚。thread-created/插件 lifecycle event 只能在 commit 后发布，订阅者首次读取即可见全量初始 metadata。
8. 当前 `createPendingThreadAndAttemptFirstDispatch` 在建行之后派发失败会 mark deleted。这种后续失败继续保留既有语义：线程及 metadata 同生同灭/一起软删除，不能声称整个 provisioning 也在事务内。环境准备的既有副作用不在新的原子性承诺中。

### 3.4 创建调用与支持表

| 入口                              | 源码路径/适配点                                                                                                                                                                                                                                                 | 上下文及团队规则                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 根创建页面                        | RootComposeView → NewThreadComposer → useCreateThread → sdk.threads.spawn                                                                                                                                                                                       | 提交采集当前成员。                                                                                                                           |
| 侧栏按钮、快捷键、命令面板        | [SidebarNavigationModel.tsx](../apps/app/src/components/sidebar/SidebarNavigationModel.tsx) 的 new-thread action；[AppLayout.tsx](../apps/app/src/components/layout/AppLayout.tsx) 的 `thread.new` → root compose                                               | 打开入口不采集；最终提交走上行。保持项目/placement 选择逻辑。                                                                                |
| 分屏新建                          | SidebarNavigationModel 的 `PLACEHOLDER_SPLIT_CONTENT`，pane 中的 root composer                                                                                                                                                                                  | 每 pane 草稿保持原行为，共用创建 helper；不得在每 pane 注册一个全局 collector。                                                              |
| 复用 SDK NewThreadComposer 的插件 | PluginNewThreadComposer → onSubmit → 浏览器 SDK 或插件 RPC → 后端 SDK                                                                                                                                                                                           | NewThreadRequest 透传 map；旧插件 origin 仍为自身，团队 metadata 另存。插件主动丢弃字段不在“自动恢复”承诺内，Guide 要求原样转发。            |
| 插件直接浏览器 spawn/fork         | plugin-bound-sdk → 通用 collector helper → 原 SDK                                                                                                                                                                                                               | 无显式 map 时采集；显式 map 不补、不覆盖；origin 自动补齐规则不变。                                                                          |
| 人工 fork                         | [useForkThreadFromMessage.ts](../apps/app/src/hooks/useForkThreadFromMessage.ts) 实际调用 spawn(originKind=fork)，不经过 NewThreadComposer；fork endpoint 经 thread-fork 适配                                                                                   | 必须单独接入 helper。归属本次成员，sourceThread 不是 parent，不自动继承来源成员。                                                            |
| provider handoff                  | [ThreadDetailPromptArea.tsx](../apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx)：createHandoffThread → useCreateThread；[thread-handoff-request.ts](../packages/client-core/src/prompt/thread-handoff-request.ts)：buildThreadHandoffCreateRequest | 当前是普通新线程，prompt 提及旧线程；没有 sourceThreadId/parentThreadId。取本次选择，不伪造 fork/来源关系。                                  |
| Agent 子线程                      | [spawn.ts](../apps/cli/src/commands/thread/spawn.ts)：--parent-self/--parent-thread；[workflows service](../plugins/workflows/src/service.ts)：SDK spawn；服务端统一 create                                                                                     | 有显式成员优先，否则团队 handler 继承真实 parentThreadId 的 memberId；无父归属则未归属。CLI origin=cli 不是人工/Agent 的可靠鉴别。           |
| Agent fork                        | SDK fork、[CLI fork](../apps/cli/src/commands/thread/fork.ts)、[side-chat](../plugins/side-chat/server.ts)                                                                                                                                                      | 现有 fork 使用 source 关系；本期没有 context 就未归属，不能偷当 parent 继承。seed-only fork 的 startedOnBehalfOf 表示 Agent 也不改变此约定。 |
| CLI/SDK 明确归属                  | packages/sdk/src/areas/threads.ts 的 spawnJson/forkJson；CLI spawn/fork                                                                                                                                                                                         | 新增 `--experimental-plugin-context <json>`，与 SDK 同 schema；CLI 不读浏览器选择，插件可提供 team 命令便捷构造。                            |
| 自动化/旧客户端                   | [automations run](../plugins/automations/src/run.ts)、任意无浏览器 backend SDK                                                                                                                                                                                  | handler 仍运行；无 map 且无真实 parent 则未归属，不能使用最近一个人的选择。                                                                  |

web/desktop 与紧凑浏览器都运行 apps/app，具有相同 collector 与插件列表能力。紧凑布局沿用抽屉、触摸行操作和导航关闭，不强加桌面分屏。**本基线原生 mobile 是 WebView 壳**：[ProfileWebViewScreen.tsx](../apps/mobile/src/screens/webview/ProfileWebViewScreen.tsx) 的 ShellWebView 加载 buildShellUrl；壳里的 Web App 因此支持同一插件 UI/创建流程。原生通知、连接设置、后台 native SDK 不运行前端注册者，按无浏览器请求处理；不新增 native bridge/daemon wire，不声称独立 React Native slot 已存在。

## 4. 可组合的列表贡献

### 4.1 归属公共 SDK，现有 thread-list 消费

选择公共 frontend SDK 的注册/消费契约，**不是** bb-team 与 bundled thread-list 私下 import/RPC 的插件间协议。原因是列表的运行时注册和跨插件卸载由宿主管理，替代列表也能选择消费同样贡献；独立仓库不依赖 bundled 插件源码版本。thread-list 仍拥有布局、preferences、排序和移动实现。

拟新增 `app.slots.experimental_threadListGrouping`、`app.slots.experimental_threadRowDecoration`，及列表消费者 `experimental_useThreadListContributions`。沿用 [app-contract.ts](../packages/plugin-sdk/src/app-contract.ts) 的 `PluginThreadActionRegistration<Data>` 范式：注册 `{ id, title, useData?, projection }`（行贡献使用 `item`），`useData({threadIds})` 是宿主每个注册 app-wide 调用一次的 React hook；纯同步 projection/item 只读取线程和 Data，不发请求、不调用 hook。宿主绑定 pluginId、挂载插件上下文、隔离单项异常，并在停用/重载时卸载 collector；参考 [thread-action-registry.tsx](../apps/app/src/lib/thread-actions/thread-action-registry.tsx) 的 `ThreadActionCollector`、`ThreadActionCollectorBoundary`。插件在 useData 内使用已有 useRpc/useRealtime/useSdk 与 React effect cleanup 管理自己的数据，不公开 getSnapshot/subscribe 缓存协议。

行贡献的 threadIds 为可见行的去重集合；所选分组的 threadIds 则是当前列表候选根线程集合，必须在分组/窗口化之前取得，否则折叠或视口外成员会分错组。多列表消费时宿主合并集合；隐藏列表不贡献需求，未选分组不请求逐线程数据。集合去重、批量发布沿用 action collector 方式，不逐行挂载 useData。插件按 `experimental_listPluginMetadata` 的 200 IDs 批次读取自己的 namespace，缓存及 realtime 失效通过现有 hooks 完成；分组和标签可复用插件自己的查询 key，无需宿主再管理第二份 cache。useData 返回显式 loading/ready/error，未加载不能被投影成未归属。

分组 `projection({thread,data})` 返回 `{ status: "ready", group: { key, label, avatar } | null }` 或 `{ status: "loading" | "error" }`，输入为公共 PluginSidebarThread 中的根线程，avatar 为 `{src,alt} | null`。null 表示确实没有分组；宿主保留单独未分组桶，loading/error 时列表仍可访问且显示状态。行 `item({thread,data})` 返回 `{ text, accessibleLabel, avatar: { src, alt } | null } | null`，宿主在标题旁的统一附加区域渲染。src 使用插件随包同源资产 URL；宿主负责一行有界标签、头像尺寸、主题和无障碍，不接收整行 React 替换。多项按完整 `<pluginId>/<id>` 排序组合；单项失败只移除该项，保留状态、标题、快捷键和操作按钮。

最小分组组合语义：多个插件可注册多个可选组织提供者；用户**一次选择一个主组织模式**，它与 pinned、现有父子树、环境聚合、read-status 分层组合。实现落在 bundled thread-list 的组归属投影与行附加区域，而不是重写树引擎：从现有 [ProjectList.tsx](../plugins/thread-list/app/list/ProjectList.tsx) 的 `buildGroupSectionItem`/模式数据准备提取私有共同投影入口，归一化稳定 group key/label 与根归属，交还现有 buildProjectThreadGroups、排序及各模式渲染器。project、machine、chronological 均经过这个入口；machine 与外部成员分组是最先验证的两个真实 adapter。chronological 的 custom sections、项目/机器特殊操作和 pinned 仍为私有 adapter 的职责，不塞进公开贡献型别，也不为了统一形式替换 `ActiveSidebarModeSections` 的现有选择分支。

共同验收边界是组归属投影、namespaced key、加载/失败、附加行展示及原有树消费，不是要求每个内建模式伪装成第三方插件。已有 provider icon 继续由原控件渲染；它是 provider 状态展示，不是本次成员附加信息，强制搬进新注册表没有第二个真实调用需求。已有 ThreadRow 在三模式与新增模式下使用同一附加区域，才是本次行贡献的共享落点。折叠、布局、排序、DnD、ProjectThreadItem 和内部 atoms 均不外泄到 SDK。

### 4.2 树、排序、拖拽与 preferences

| 行为           | 推荐契约                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 组织选择       | 现有 organizationMode 接受三旧值及插件 `<pluginId>/<id>`；现有 thread-list RPC/CLI preferences 路径读写，新值有校验。默认仍 chronological，安装团队插件不自动改偏好。                                                                            |
| group key      | 宿主编码 `(pluginId, registrationId, groupKey)`，不拼接未经转义的分隔符；姓名更改不换 key，团队使用 memberId。                                                                                                                                   |
| 嵌套           | 先建立 parent 树，以每棵根的 group 放置整树，子线程保留实际自身标签；跨成员子线程不会被复制或拆散。pinned 的现有置顶投影保持。                                                                                                                   |
| 环境聚合       | 在组内复用现有环境聚合；禁止跨成员组折叠为同一环境行。树中子节点仍服从树，不凭环境重挂父级。                                                                                                                                                     |
| 排序/隐藏/折叠 | 复用比较器、窗口化、reveal 与 group rollup；增加 namespaced group 状态的 KV preferences（顺序、折叠、隐藏），不新增核心表。不覆盖既有 project/section/machine 偏好。                                                                             |
| 拖拽/移动      | 现有 thread/section 重排、nest、移入分屏、触摸传感器沿用。派生的成员组标题是只读 drop target；跨成员组拖拽不暗改 memberId，也不吞掉原有 move 菜单。组内原先可重排的位置继续按既有 sortKey/父子变更工作；不支持的位置显示与原模式一致的拒绝反馈。 |
| 停用/重载      | 所选提供者缺席时临时回退 chronological，保存原选择和折叠数据，恢复后重用；其行标签消失，原列表仍可用。贡献失败隔离为缺席，不隐藏整个列表。                                                                                                       |

不选整列表替换：会复制拖拽/移动维护成本；不选 DOM 拦截：无法保证生命周期与可访问性；不选插件间私有协议：外部安装者无法获得稳定版本边界。

## 5. bb-team 插件实施契约

### 5.1 数据和身份操作

使用 `bb.storage.database()` 的插件本地 SQLite；插件自己 append-only migrate，不读取 bb.db 路径、不导入 @bb/db 或 server 内部模块。最小表：

- `members(member_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`；ID 由服务端生成，永不复用，显示名允许同名。
- `team(singleton INTEGER PRIMARY KEY CHECK(singleton=1), admin_member_id TEXT NOT NULL REFERENCES members(member_id))`。一个团队对应一个 BB server 的插件实例。

`initialize({displayName,avatarId})` 用同步 immediate transaction：检查 singleton → 插入首成员 → 插入唯一 team 行。两个并发初始化仅先 commit 者成功；失败方收到 `already_initialized` 和选择现有身份的入口，不自动再建成员，不产生孤儿行。不另存 isAdmin 多份状态。团队 timezone 是普通插件设置，单一来源为 `bb.settings.define` 的字符串字段，使用 experimental_schema 校验 IANA 时区，后端缺省 UTC。初始化界面预填 `Intl.DateTimeFormat().resolvedOptions().timeZone`，允许直接确认或修改，检测失败则显示 UTC；已有保存值优先，不以每个访问者的浏览器时区覆盖团队设置。首成员初始化成功后，界面沿相同 settings 写入路径保存所确认值；设置写入失败明确显示已创建成员、时区尚未保存，可单独重试，不能宣称跨库原子提交或再次创建成员。并发初始化失败方不自动写时区。后续通过现有插件 settings UI/CLI/SDK 路径修改，任何已有 BB 设置访问者均可修改，不新增管理员设置权限。变更只影响之后开始的查询如何解析日期，不改事件 UTC 时间；设置 onChange 驱动显示刷新。

RPC/CLI/SDK 共享插件 service：`initialize`、`members.resolve/list/get`、`members.create`、`members.updateSelf`、`identity.validate`、`activity.query/details`。管理员 create 以显式 `actorMemberId` 与 singleton 比较；普通成员只能在自选身份口径下修改自己资料，不能创建新身份。该检查是受信团队协作规则，不是登录鉴权，持有 BB 会话者能自述另一个 ID。displayName trim 后 1–80 字符，avatarId 必须命中随包清单；本期不增加成员删除、合并、转让管理员或改归属操作。

客户端身份按 BB server/profile 的稳定作用域键分区，分两层：localStorage 保存持久默认 memberId，sessionStorage 保存本窗口覆盖（含显式未归属 null）。有效选择优先级为“本窗口覆盖（包括 null）→ 持久默认 → 未选择”；窗口首次读取默认后固定成本窗口值，使其他窗口修改默认不会切走当前身份。默认选择动作“记住此身份”同时写持久默认和本窗口；“仅本窗口使用”只写窗口覆盖；“恢复默认”移除覆盖并重新取当前持久默认。清除本窗口选择写显式 null，不删除其他窗口/持久默认；“忘记默认身份”才删持久默认且清本窗口选择，其他已打开窗口保持各自覆盖。新开或通常重开浏览器用持久默认，刷新恢复窗口覆盖；浏览器会话恢复若恢复 sessionStorage，则继续该覆盖，界面显示其为窗口选择。不做跨设备身份同步，也不使用服务端全局 KV 表示当前人。

[browser-storage.ts](../apps/app/src/lib/browser-storage.ts) 已有 local/session 读取及 fallback；其 `createTabScopedStorage.setItem` 同时写两层，不能直接用来实现“仅本窗口”操作。独立插件用浏览器存储与自己的小型 hook 实现上述优先级，不导入 app 内部模块。存储不可用时仅在当前窗口内存保留并明确提示无法记住，不声称跨会话持久。恢复的 ID 必须向服务端验证，无效时提示重选，不能把本窗口错误扩散删除其他窗口。CLI `bb team identity select/show/clear` 使用调用端本地持久配置、按 server 分区；SDK 明确传 memberId。浏览器选择不偷偷同步成 CLI 身份。

界面用已有 navPanel/settings/sidebar footer 能力提供初始化、选择、修改、管理员创建；保留原生 New Thread。预设生成头像随包发布，清单存固定 avatarId → asset URL，UI 显示和 CLI 列举同一清单。本阶段不生成资产。更新资料 commit 后发布 `members.changed`，所有窗口重新定向读取成员；重连重新查询，不能依赖一次性 signal。历史线程 metadata 只存 `{memberId}`，不复制姓名/头像。

团队 prepare：显式有效 memberId 优先；没有 context 时仅继承真实 parent 的 memberId；都没有返回 null。显式不存在成员失败，不能落成未归属。成员不删除保证 prepare 后 core commit 之间 ID 仍有效，姓名变化不影响 ID 快照。停用保留插件 DB 与 metadata；再次启用重新读取。卸载清数据属于另一次显式操作，本期不附带执行。

### 5.2 Agent 活动查询：事实层与上下文预算

创建上下文足以关联线程归属；**不足以识别每条消息的人工操作者**。现有事件有 turn、Agent/tool 输出与部分 initiator 信息，没有可信团队 memberId 的逐消息身份记录。第一版不为发送/编辑/重试每条消息附加 team context：这将增加所有输入链、历史兼容和审计语义成本，仍不能把自选身份变成认证身份。留待明确的下一版需求。

查询步骤：按 memberId 或名称解析 → 明确日期/时区 → 在服务器过滤归属和时间内事件 → 返回紧凑可引用事实 → 当前 Agent 解释总结。名称精确匹配仍可能同名；零结果明确 not_found，多结果返回有界候选 ID/显示名供用户选择，模糊搜索也不能自行选第一个。更名后历史归属仍由 ID 连接；旧名称不作为隐藏别名自动认领。

建议命令：`bb team activity --member <id-or-name> --date YYYY-MM-DD [--project <id>] [--limit N] [--max-chars N] [--cursor C] --json`；详情 `bb team activity details --thread <id> --date YYYY-MM-DD ...`。`today` 由插件服务端按已保存的 timezone 设置与请求开始时的 now 解析，响应回显 date/timezone/from/to/asOf。区间 `[当地当天00:00,次日00:00)` 转 UTC，不能简单加 24 小时（DST）。事件记录时间使用核心 events.createdAt，不是自然语言中声称的时间。插件 cursor 保存首次解析的 memberId、date、timezone、UTC 范围和核心 cursor；继续分页沿用它们。期间修改时区只改变新查询，同一 cursor 不重新解释 today；显式传入相冲突过滤条件返回 cursor_query_mismatch。

插件输出默认 20 个线程、完整序列化响应最多 8000 Unicode 字符；上限 100/24000，最小 max-chars 为 2048，不足以容纳 envelope 时明确拒绝参数。详情默认 20 个证据、8000 字符；姓名解析默认 10 个候选。预算含 envelope、cursor、标题和错误，不只是正文；单项过长裁剪 excerpt 且标明 `excerptTruncated`，至少能输出一项及有效继续位置。插件使用核心每项的 cursorAfter，在最后实际输出项处生成 nextCursor；不得直接使用已取回但尚未输出的页尾位置而跳项。输出始终含 `totalThreads/totalEvidence`（本页查询时计算的匹配总数，不是全程冻结总数）、`returned`、`nextCursor`、`hasMore`、`truncated`、`coverage`。因用户预算未输出的项以游标继续；CLI 文本与 JSON 同预算，不自动递归翻完所有页。用户选定的字符预算与团队措辞留在插件，核心只负责自己的硬响应上限与通用事实。

事实投影以 [provider-event.ts](../packages/domain/src/provider-event.ts) 的真实事件为依据：已接受输入 `turn/input/accepted`、完成回合 `turn/completed` 的成功/失败状态、`item/completed` 中 Agent 回复/命令执行/fileChange/toolCall 的有界摘要。请求/排队不等于执行，tool 调用不等于成功，Agent 说“已完成”仅标记为 Agent 陈述；可验证命令结果单独标记。默认跳过思考文本、delta、全量工具输出和 diff。标题只作定位；线程的 updatedAt/createdAt 不算进展证据。每条证据含 threadId、eventId、sequence、事件时间、种类与状态；展示真实 thread 路由并保留 event 定位键，不编造尚不存在的事件锚点 URL。

### 5.3 必须新增的通用查询能力

现有单线程 events/list 与 metadata 批读不足以在服务器先筛成员和日期；全线程 list 后 JS 过滤和插件私读本体 DB 都不接受。唯一推荐是新增核心只读 `sdk.threads.experimental_activity`（插件绑定 SDK 默认自己的 pluginId）及 `bb thread experimental-activity`，由 team RPC/CLI 共享 service 调用；不做插件增量日志副本。

请求是判别联合：

- `mode: "summary"`：`metadata: {pluginId, key, equals}`，key 只允许单个顶层键，equals 只允许 JSON scalar；`from/to` 为 UTC ms，`projectId` 可缺省，`limit/cursor`。
- `mode: "details"`：同样 metadata/date 约束加一个 `threadId`，按该线程的事件序号分页返回证据投影。团队总是使用 `{pluginId: 自身, key: "memberId", equals: 固定ID}`；详情不能绕过归属筛选。

JSON key 经参数化路径处理，无任意 SQL/JSONPath。复用元数据 schema 与公共线程访问过滤，默认包括归属的 archived/hidden 工作线程、排除 deleted 线程，响应明确口径。每次请求都重新做访问与过滤校验，cursor 不是授权凭据。summary SQL 用 metadata → threads → events 定向 JOIN/WHERE，事件时间 `>=from AND <min(to,asOf)`，限定可报告事件种类，COUNT/GROUP BY 在 DB 内完成；所有符合条件的旧线程都可被选到。details 也在 DB 限定 threadId、日期、类型与序号范围后才提取有界 payload；不把所有历史拉进插件内存。

核心最小投影：summary 返回 threadId、有界标题、lastActivityAt、按事实种类/状态的计数，以及至多 3 条最近证据定位和短 excerpt；details 每项返回 eventId/threadId/sequence/createdAt、事件或 item 种类、可观察状态及短 excerpt。复用第 5.2 节的事件白名单，计数分别命名为 acceptedInputs/completedTurns/各 item 状态数，不能称为成果数；父报告与子结果是两条证据，不自动当成两份成果。未知或缺失结果标记 unknown，不生成业务总结。SQL 使用 json_extract/substr 提取允许字段，不返回完整 data；命令只含名称/exitCode/有界结果片段，文件变化只含有界路径/状态，省略 diff。核心每页默认 20、最多 100 项，单 excerpt 最多 512 Unicode 字符、标题最多 200 字符，序列化响应硬上限 256 KiB。达到字节上限在完整项边界结束；每项有 cursorAfter，响应有 nextCursor/hasMore/truncated 和实时 COUNT 总数，不能把 limit 后的条数说成总数。参数与 cursor 限额保证一项及 envelope 可放入响应。插件可进一步缩小用户输出预算，但不能放大核心上限。

**推荐无状态 keyset cursor，不保存查询结果。** 第一页在一次短读事务内取当前时间 asOf、计数和 limit+1 个候选；后续页各自读取当前数据。summary 按 `threadId ASC`（固定二进制比较）排序，以最后已输出 threadId 继续；lastActivityAt 仅展示、不作排序键，避免继续活动让线程来回移动。只纳入 `threads.createdAt < asOf` 的线程及上面的事件时间范围。details 首次还取该线程当前 MAX(sequence) 为 throughSequence，按 `sequence ASC`，继续条件 `lastSequence < sequence <= throughSequence`；已有 `(thread_id, sequence)` 唯一索引正好支持。时间不单调也不会破坏事件顺序，响应仍回显真实 createdAt。两种模式不先物化全结果，没有总项数门槛、TTL、LRU 或全局状态账本。

cursor 为版本化、有长度上限的编码值，携带 mode、asOf、throughSequence（仅 details）、最后位置和标准化过滤条件摘要；校验 mode、namespace/key/value、projectId、threadId、from/to 与访问作用域一致，拒绝超长、非法位置和查询不匹配。limit 是分页大小，允许下页调整，不参与过滤摘要。核心按每项已知排序键生成 cursorAfter；插件只包装它，不理解核心编码。相同代码版本/数据库下重启可继续，不依赖内存缓存；不兼容 cursor 版本返回明确错误并要求重新开始，不自行从第一页拼接旧结果。

一致性限度依据源码明确为实时分页：[events.ts](../packages/db/src/data/events.ts) 的 append 可使用调用方 createdAt，当前 events 只有每线程 sequence，**没有全库持久化递增 ingestion 高水位**。summary 的 asOf 是时间上界，不伪称冻结数据库；通常晚于 asOf 的新事件/线程不进入旧查询，但回填早时间的事件、已有线程改归属或同毫秒边界可能改变候选与计数。新出现的匹配 threadId 在游标之后会被看到，之前则本轮略过；客户端重新查询可看到。固定 ID 顺序避免因 lastActivityAt 更新导致同一 ID 反复翻出。details 的 throughSequence 排除正常追加，即使其 createdAt 回填到旧日期；事件删除/剪裁使未读项消失，改写可能替换或重用已有 sequence，使已读项变动或新增项落在游标之前。本期允许这些变化，不做逐页 rewrite generation 再验证、不声称无漏项或可重复读。

每页在新查询中排除已删除或已不符合归属的行，不从缓存继续输出旧内容；总数随本页读取重新计算。coverage 固定回显 retained-events/live-pagination、asOf/throughSequence 及上述变化限制；能从当前数据确认的缺口附原因，不能声称检测到了全部中途变化。插件显示“截至此时间范围内、当前保留的证据；翻页期间数据可能变化”，按 ID 汇总同一次响应，不把各页 total 相加。更名只更新展示，memberId 不变；日期/时区固定在插件 cursor。选择这个语义是因为需求是有界事实与可继续查询，不是不可变导出或审计快照。

核心模型只需现有 threads/thread_plugin_metadata/events，不增加团队表、操作者列或 daemon wire。查询计划落地时评估两个与查询直接相关的通用索引：metadata `(plugin_id, thread_id)` 和 events `(thread_id, created_at, sequence)`，已有 metadata 主键和 event sequence/type 索引的列顺序不同；details 序号分页可先复用现有唯一索引，summary 日期过滤是否需要新索引以 EXPLAIN 和代表数据量为准。通过 Drizzle schema 生成迁移与 snapshot，不手写 snapshot；以 EXPLAIN 与有旧线程的大数据集验证。只新增实测确有需要的索引，不能为了“零迁移”接受全库读取。若需要迁移，范围仅为经查询计划证明的索引；创建上下文本身无需核心表迁移。

core 内部提取共享 `listActivityEvidence` 定向读取/投影模块，summary/details、现有单线程事件 route 可共用底层范围条件构造，避免团队专用 SQL；现有 events API 的原始事件响应契约不改变。落点：server-contract threads、SDK threads、server threads route/service、DB data/events 与 metadata 查询、CLI thread 命令。公开 SDK 符号在 Plugin Guide 登记。

fork 的复制历史不是该 fork 新做的工作。现有复制不带统一来源字段，但 `INHERITED_EVENT_TYPES` 不复制 thread/identity；第一版对 originKind=fork 的活动证据保守限制为本线程首次 `thread/identity` 之后的 sequence（[thread-lifecycle.ts](../apps/server/src/services/threads/thread-lifecycle.ts) 负责写 identity）。没有本地 identity 或边界已被清理时标记 coverage 不完整，不把前缀按 createdAt 归给新成员；普通线程不施加该过滤。验收覆盖同日 fork、多级 fork 和来源已删除场景。以后若要精确报告启动前请求，需要另增持久化来源边界，不凭 providerThreadId=null 或时间戳猜测。

不建插件增量索引的理由：thread.created 信号不是可回放日志，停用期间会漏，补偿仍需核心定向查询；还要处理改写、删除和双库一致性。本方案停启后直接查询现存 metadata/events，不必回放全库。历史未归属线程、停用时创建的无归属线程不能倒推成员；已归属线程停用期间的活动重新启用后仍可查。剪裁/删除的证据不恢复，`coverage` 明确“当前保留事件”，已知缺口显示 incomplete/原因；未发现缺口也不宣称历史完整。

### 5.4 Skill 发现与 provider 支持边界

仅打包一个 `skills/team-activity/SKILL.md`。建议短 description：`查询成员归属的 BB 工作进展、日期活动与线程证据；使用 bb team activity。` 正文按需教 Agent 解析歧义、日期、预算和证据，完整正文目标不超过 1500 字符，详细参数留 CLI help。不注册 native tool 集合，不向 agent instructions 注入名单、历史或正文。命令经 `bb.cli` 注册，SDK/RPC/CLI 调用同一 query service。

| 实际链路                                    | 已核对能力与边界                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server skill catalog → host staging         | [injected-skills.ts](../apps/server/src/services/skills/injected-skills.ts)：discoverPluginSkillIds/resolveSkillCatalogEntries；[host injected-skills](../apps/host-daemon/src/injected-skills.ts)：stageInjectedSkillSources，按 treeHash staging。已有 skill transport 可复用，无新 daemon wire。catalog 的 name/description/path 有常驻上下文成本，不能称免费。                                      |
| Codex                                       | [bridge.ts](../plugins/provider-codex/src/bridge/bridge.ts)：skills/configure → skills/extraRoots/set，交给 provider 原生发现。代码证明 roots 传递，不证明每个外部版本实际 token 数；验收捕获请求验证未注入完整正文。                                                                                                                                                                                   |
| Claude Code                                 | [session-params.ts](../plugins/provider-claude-code/src/session-params.ts)：buildClaudeSkillConfigParams 把 roots 配成 local plugins；使用原生 skill 加载路径，实际正文触发以支持版本运行验证。                                                                                                                                                                                                         |
| Pi                                          | [bridge.ts](../plugins/provider-pi/src/bridge/bridge.ts)：skills/configure；[rpc-session.ts](../plugins/provider-pi/src/bridge/rpc-session.ts)：--skill；[turn-input.ts](../plugins/provider-pi/src/bridge/turn-input.ts)：显式选择转 /skill。必须验证自动发现与显式选择两条路，不能只凭命令转换声称自动命中。                                                                                          |
| ACP                                         | [session-params.ts](../packages/provider-bridge-acp/src/session-params.ts)：buildAcpSkillsInstructions 实际将每个 name/description/绝对路径写入 instructions，要求匹配时读取 SKILL.md。这是文本目录而非原生 lazy registry；正文按需读取依赖目标 agent 的文件读取和 shell/CLI 能力。                                                                                                                     |
| 不支持 skill roots/文件或 shell 的 provider | [runtime-provider-process.ts](../packages/agent-runtime/src/runtime-provider-process.ts) 与 [bridge-protocol-adapter.ts](../packages/agent-runtime/src/bridge-protocol-adapter.ts) 只提供配置传递；bridge-protocol-adapter 在 `handshake.skills.configure` 未声明时返回 noop，不能赋予目标执行能力。最小替代为用户显式附加短查询指令/命令输出，或使用已支持 CLI 的 provider；不为此常驻新增一串 tools。 |

[plugin-commands-skill.ts](../apps/server/src/services/plugins/plugin-commands-skill.ts) 已生成命令发现 skill；其短 catalog 条目也占上下文。团队 skill 专注自然语言触发，不把同一完整说明重复写进自动生成发现正文。启停后新会话/下一次配置刷新移除或加入发现条目；已经进入旧会话上下文的文字不能撤回，命令必须明确返回插件不可用，而不是使用旧资料。运行验收报告 provider/版本与实际发现成本，不承诺所有第三方 ACP agent 同等能力。

## 6. 版本、实施切分与文档归属

先交付 BB 通用能力，再交付独立 bb-team；设计不是可以安装的插件。BB 实现需同步 [app-contract.ts](../packages/plugin-sdk/src/app-contract.ts)、[backend-contract.ts](../packages/plugin-sdk/src/backend-contract.ts)、对应导出/宿主绑定与测试 harness；[surfaces.ts](../plugins/plugin-api-docs/src/surfaces.ts) 的创建、列表和活动能力卡及符号清单；[api_to_audit.md](api_to_audit.md) 记录稳定条件和原生调用者。CLI 新旗标/命令同步 [cli-guide-and-skill.md](cli-guide-and-skill.md) 指定发现面。本文不替代这些交付。

团队包声明 `engines.bbPluginSdk` 的实际首个支持版本下限，并固定开发依赖版本、锁文件；`engines.bb` 同时指明已验证 BB 版本。当前 [sdk-compat.ts](../apps/server/src/services/plugins/sdk-compat.ts) 在同 major 会按 floor 接受较新版本，不能只凭严格上界保证 ABI；插件启动时同时检查需要的 experimental 方法，缺失则显示不兼容并不注册半套创建/列表功能。当前稳定版尚不包含拟新增接口，不能声称 desktop-v0.46.0 原版可用。具体首发版本号由实现提交决定，不虚构未来版本。

发布插件 semver tag 与编译产物，建议安装固定 tag `git:https://github.com/hxy91819/bb-team.git@vX.Y.Z`（示意，发布时替换实际版本），升级不移动旧 tag；构建使用公开 plugin SDK，不导入 bundled thread-list/@bb 内部路径。头像及清单随包，SQLite 数据目录不打包。安装/禁用、数据保留、WebView 边界、CLI 身份与活动口径写入插件自身 README/skill；API 接口说明只维护 Plugin Guide。

下一阶段可闭合为三项：A 创建链/多 namespace 原子写入及原生入口支持表；B 列表注册消费与原生三模式回归；C 通用活动查询和公共 SDK/CLI。每项同时交 Guide、audit、行为测试，均在 BB 分支；然后独立 bb-team 实现成员、头像、身份、标签/分组、短 skill 和有界查询。最后两仓库联合验收安装、版本拒绝与启停，审查后分别提交/push。本阶段不执行这些实现任务。

## 7. 行为验收表

以下为下一阶段必须执行的行为测试，不是本阶段已通过。相同创建表驱动覆盖所有支持入口；DB 测试用真实内存连接与 migrate，不 mock 数据库。UI 在 web/desktop/紧凑浏览器及原生 WebView 选择代表旅程；新增紧凑抽屉按项目规则验证 iOS Safari、app-root 和延迟实现行为。

| ID  | 设置与动作                                                        | 可观察结果 / 测试边界                                                                                                             |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| C01 | A 成员在每个支持入口人工创建，提交前由 B 切回 A                   | metadata memberId=A；origin 保持原入口，原生 SDK/服务路由表驱动。                                                                 |
| C02 | 打开页面选 A，发送时选 B；prepare 等待时再选 A                    | 本次 B、下一次 A；同步 collector/UI 集成。                                                                                        |
| C03 | 两窗口分别 A/B，同时提交同项目                                    | 各自 metadata 正确，无全局选择串扰；两个独立客户端。                                                                              |
| C04 | 两插件同时贡献，包含插件来源 legacy seed                          | 两 namespace 与线程同时出现；seed 未重叠键保留，originPluginId 不变。                                                             |
| C05 | 同 namespace seed 重叠、非法 JSON、无效成员、超限                 | 明确错误且无线程；直接 SDK/HTTP 也受校验。                                                                                        |
| C06 | collector 抛错或后端 prepare 超时/失败                            | 原草稿、附件、mention 可恢复，提交后的新输入不被覆盖；没有部分 metadata。                                                         |
| C07 | 第二 namespace insert 故障                                        | 同事务线程和首 namespace 都不存在；真实 DB rollback。                                                                             |
| C08 | prepare 期间停用/重载，旧 Promise 迟到                            | 本次失败且无迟到写入，下一次不带已停用 context 的创建成功。                                                                       |
| C09 | 停用后新建；再次启用                                              | 原生流程可用，既有成员/metadata 保留，无重复注册。                                                                                |
| C10 | 已提交后 dispatch 失败、延迟发送、provider retry                  | 遵循现有 soft-delete/queue 语义；不重跑归属、不因重试身份变化。                                                                   |
| C11 | 网络响应丢失后调用方重试                                          | 不自动重发；显式重试的重复可能公开说明，复用请求 map 不改变成员。                                                                 |
| C12 | A 父线程的无 context Agent child；A 来源人工 fork 选 B            | child=A，fork=B，fork 没有被误挂 parent；source/parent DB 核对。                                                                  |
| C13 | Agent fork 无 context、无父自动化、旧客户端                       | 无归属；有 parent 的自动化按插件继承；core 不复制其他插件 metadata。                                                              |
| C14 | provider handoff 与分屏新建                                       | 本次成员、草稿恢复正确；handoff 保持现有普通新线程关系。                                                                          |
| C15 | 旧 pluginMetadata API、无插件、插件直调/RPC 转发                  | 既有成功/错误契约不变；新 helper 恰好采集一次，不污染 sendMessage/pluginSubmission。                                              |
| M01 | 两个初始化事务竞争，包括首事务回滚                                | 恰好一 admin、无孤儿成员；失败者可选择已创建身份；回滚者不占管理员。                                                              |
| M02 | 普通成员创建后续成员、管理员创建、修改他人                        | 普通成员创建拒绝；admin 创建成功；updateSelf 只更新请求选择身份，说明自选身份不等于认证。                                         |
| M03 | 历史线程 A，A 改名/头像；两个客户端在线与断线重连                 | thread metadata 不改，所有旧线程与分组显示新资料；ID/key 不变。                                                                   |
| M04 | 初始化自动读取浏览器时区，确认/修改；无效 timezone、非清单 avatar | 合法值走普通 settings 保存，读取失败预填 UTC；非法值在对应边界拒绝，无需空白时区必填步骤。                                        |
| M05 | 非管理员经 settings UI/CLI/SDK 修改时区，已有查询继续分页         | 修改成功，不需要 adminMemberId；事件 UTC 不变；旧 cursor 保留旧时区/范围，新查询使用新值；管理员仍只控制创建成员。                |
| M06 | 默认 A；刷新、关闭重开、新窗口；窗口 B 选“仅本窗口”               | 跨重开恢复持久默认 A，B 刷新保留覆盖但不改默认，其他打开窗口不切身份；按 server/profile 隔离。                                    |
| M07 | 窗口显式未归属、恢复默认、忘记默认、无效 ID、禁用存储             | null 覆盖优先；各清除动作符合第 5.1 节，不误删其他窗口；无效 ID 提示重选，存储失败如实提示不能持久。                              |
| M08 | 并发初始化失败方、首成员成功但时区写入失败                        | 失败方不改时区；成功成员不回滚/重复创建，可单独重试普通设置写入。                                                                 |
| L01 | 同时启用两分组/三标签提供者                                       | 组织选择均可发现，标签组合顺序稳定，原状态/标题/行操作保留。                                                                      |
| L02 | A 根下面 B 子线程，同环境另有 B 根                                | 树不拆不复制；标签真实；环境不跨根组聚合。                                                                                        |
| L03 | 切组织、改名、隐藏/折叠、刷新、多客户端 preference 更新           | namespace 不冲突，组 key 稳定；沿用 thread-list RPC/CLI 同步。                                                                    |
| L04 | 鼠标/触摸拖拽、nest、pin、move、拖入分屏                          | 原行为/禁用条件一致；跨成员组不隐式改归属；紧凑导航关闭正常。                                                                     |
| L05 | useData/projection 抛错、停用、重载；两个列表消费同一注册         | 每注册只有一个 app-wide collector；单项隔离、卸载清理；列表回退可操作，恢复原选择。                                               |
| L06 | 未装 team 时三种内建模式，排序/未读/section/窗口化                | 原 baseline 行为不回归；三模式与插件共用组投影/行附加边界测试表，私有模式操作保持，不要求改成通用树引擎。                         |
| L07 | 折叠/视口外有不同成员根、 metadata 加载中、滚动显示新行           | 分组 useData 覆盖候选根，标签按可见行批读且每批至多 200 IDs；loading 不计为未归属，无每行 RPC。                                   |
| Q01 | 小A 当天有 accepted input、命令成功、Agent 陈述；小B 无活动       | A 返回对应证据且区分陈述/结果；B 返回 0 和覆盖口径，不说 B 没工作。                                                               |
| Q02 | 昨天创建的 A 线程今天继续，今天只 rename 的线程                   | 旧线程被纳入；只改标题不算工作证据；不能用 createdAt/updatedAt 筛进展。                                                           |
| Q03 | UTC 边界、团队本地零点、DST 的 23/25 小时日                       | 半开区间，无相邻日期重复/漏事件；响应回显 UTC 范围与 IANA timezone。                                                              |
| Q04 | 同名小A、模糊匹配、改名后按固定 ID 查                             | 歧义返回有界候选，不能任取一个；改名不丢历史关系。                                                                                |
| Q05 | 多页、单项超长、核心取回多于插件预算、超过一万匹配项              | 核心响应不超过 256 KiB；插件满足用户字符预算；游标从最后实际输出项继续，无全结果门槛/提前物化，未输出项不跳过。                   |
| Q06 | summary 翻页时正常新增、回填早时间、改名、改归属、删除            | 固定 threadId 顺序，正常晚于 asOf 的事件排除；回填/改归属按游标前后规则可见或略过，总数可变且 coverage 明示；新查询反映当前状态。 |
| Q14 | details 首次后正常追加（含早时间）、删除/改写并重用序号；服务重启 | 正常追加超 throughSequence 不入旧查询；删除不复活，改写按实时分页限制处理；同版本重启可继续，无缓存 TTL 依赖。                    |
| Q15 | cursor 换成员/项目/日期/mode、非法版本/长度；仅换 limit           | 过滤不匹配和非法 cursor 明确拒绝；换 limit 可继续；每页重新访问校验，不把 cursor 当授权。                                         |
| Q07 | 摘要选择 threadId 请求详情、伪造不属该成员 ID                     | 前者仅返回当日有界证据和真实定位键，后者无越过过滤结果；无整日志/diff。                                                           |
| Q08 | 插件停用期间旧归属线程继续、期间新建无归属线程                    | 重启查到旧归属线程期间活动；新线程不倒推成员；无事件副本回放。                                                                    |
| Q09 | 剪裁、缺失工具结果、只有 Agent 宣称成功                           | coverage/证据级别真实，不能补造结果或声称人工操作已知。                                                                           |
| Q10 | 每个受支持 provider 新会话只问无关问题，再问活动                  | 首回合仅短发现项及宿主必要目录开销；按需读取 skill，再 CLI；无常驻工具集合/名单/历史。                                            |
| Q11 | ACP 目标无文件读取或 shell；插件停用后旧会话查询                  | 明确能力不可用及最小替代，不自动注入完整资料或增加 AI 服务。                                                                      |
| Q13 | A 今天有完成事件，B 今天 fork，随后自己继续；多级 fork            | B 只统计 fork 自身 identity 后的工作，来源事件不重复计入；边界缺失显式 incomplete。                                               |
| Q12 | 大量其他成员/年份事件，按 A/一天/项目查询                         | SQL 定向过滤/聚合，EXPLAIN 使用目标索引；插件无全库 list/filter 和内部 DB 依赖。                                                  |
| V01 | 老 BB/缺 experimental 方法、匹配版本、禁用再安装                  | 不兼容有清楚提示；兼容版可安装；停用保数据，原生列表/创建可用。                                                                   |
| V02 | SDK、CLI、RPC 分别操作成员与查询同一数据                          | 共享 service 相同校验/预算/结果；CLI 身份不污染浏览器。                                                                           |

## 8. 我自行引入的决定

本轮父线程裁决列在第 1 节；下表保留创建阶段未变的推荐，并只列本轮需由实现者遵守的具体取舍，不把已裁决事项重新当作待选方案。

| 决定                                                                           | 原因                                                   | 影响                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------- |
| 同步 capture、异步 prepare，collector 每插件一个                               | 明确提交瞬间身份并避免多 pane 重复注册                 | 插件先加载身份资料；提交快照不受之后选择影响。                      |
| 冲突键拒绝、显式 context 对已停用插件报错                                      | 避免按加载顺序悄悄改归属                               | 已有无 context 调用不变；旧请求须重新提交才能移除失效贡献。         |
| 无身份允许未归属，Agent fork 不从 source 继承                                  | 保留原生可用性，守住 parent/source 区分                | 人工未选择时不会被强制创建身份；以后扩展继承策略须插件明确实现。    |
| 不增加创建幂等账本；不自动重发未知结果                                         | 现有创建无幂等契约，避免扩大接口与数据模型             | 显式重试可能重复，验收必须披露；不宣称 exactly-once。               |
| 一次一个主组织模式、成员组只读；私有 adapter 接入共同组投影                    | 复用现有交互，避免多维列表/归属编辑器                  | 三模式与插件共用真实投影边界，现有模式专用操作不外泄。              |
| 分组按候选根需求加载，行标签按可见行加载                                       | 只加载可见行会错分未展开根                             | useData 为 app-wide，复用批读和 hooks；不要求外部缓存生命周期协议。 |
| team 按 server；持久默认加窗口覆盖，显式 null 表示未归属                       | 将父线程确定的跨会话记忆与多窗口独立落到明确优先级     | 临时窗口选择不写默认；CLI 单独记忆，不跨设备同步。                  |
| 时区存普通 settings，缺省 UTC，首成员创建后单独保存确认值                      | 沿用现有配置路径，避免团队表再保存一份或跨库原子性承诺 | 非管理员可修改；设置失败单独重试，未来查询用新时区。                |
| summary 按 threadId、details 按 sequence 游标；asOf 加 details throughSequence | 使用现有稳定键与每线程高水位，无需全局账本             | 正常追加有明确边界；删除/回填/改写允许改变后续页，coverage 明示。   |
| 顶层 scalar metadata 交集过滤、核心有界事实、插件用户预算                      | 满足真实查询缺口，保持本体通用                         | 具体投影和限额见第 5 节；索引仅在 SQL 计划证明需要时增加。          |
| 每项返回 cursorAfter，插件在最后输出项继续                                     | 核心分页大小可能超过最终字符预算                       | 插件不会跳过已取回但未输出的项，不需缓存剩余页。                    |
| 不追踪逐消息操作者                                                             | 自选身份不能证明实际人，创建上下文只用于归属           | 查询报告工作进展，不做审计/考勤；额外消息上下文留下一版。           |

## 9. 冲突、待裁决与本阶段验证

- 现有创建代码写着“creation is unhooked”，指当前只在 dispatch admission hook 决策；本设计增加的是 metadata preparation，不替代 admission、不改 dispatch hook。实现时需更新这些过时注释/契约说明，遵守本仓库注释规则。
- 现有 thread-list organizationMode 为封闭 enum，hiddenGroups 只认内建前缀，不能仅添加 UI 选项；preferences schema、存储解析、RPC/CLI 与测试须同步扩展。
- 当前没有通用创建 collector、初始多 namespace 输出、可加成行标签/分组注册或 activity 查询。已有 NewThreadComposer、metadata 表与 batch read 可以复用，不能把推荐当作现成能力。
- 原生 mobile 已用 WebView；handoff 不是 fork；CLI origin 也不能证明实际操作者。上述事实覆盖可能来自旧文档或直觉的相反假设。
- 现有 thread action 已提供 app-wide useData/纯 item，browser-storage 的 tab-scoped setter 会同时写 localStorage；新增列表贡献复用前者范式，身份窗口临时选择不能直接套用后者 setter。现有事件没有全局 ingestion 高水位，因此活动查询明确为实时分页，不承诺全结果快照。
- 原任务“避免不必要的迁移”仍成立：创建与成员不需核心表迁移；新活动范围查询只增加实际 SQL 计划证明需要的索引。没有 server/daemon wire 改动，因此不需要提升 HOST_DAEMON_PROTOCOL_VERSION；若实现改变 wire，必须另行评估并遵守版本规则。

本轮按父线程裁决替换了先前的全结果快照、外部 cache 协议和时区/身份约束；未改变第 3 节创建契约，创建实现由独立线程负责。当前没有阻塞设计交付、需要父线程裁决的问题。第 8 节为推荐实现选择，父线程可核实；如果将“创建网络重试必须恰好一次”“多维同时分组”“真实人工操作者审计”升级为硬需求，需要单独扩大范围，不能把本契约误当已经覆盖。

本阶段验证只包括直接阅读上述调用链、路径/符号复核、需求覆盖与一致性复核、`git diff --check`、新增 publish range 的内容/身份隐私检查；没有运行产品测试，也不声称第 7 节已通过。只交付本设计文件；父线程维护工作簿与分支登记。
