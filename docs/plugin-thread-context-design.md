# 通用线程创建上下文、列表贡献与团队活动查询实施契约

状态：设计交付，尚未实现。源码核对基线为 `desktop-v0.46.0`（`4c87fdec7b7effc022ff2ee31ec95c0a09c9ee62`）。本文给下一阶段实现者提供唯一推荐方案与行为验收，不宣称下述新接口已可用。公开 API 的使用说明随实现进入 Plugin Guide；本文保留设计理由、共同调用路径和验收契约，不成为第二份接口手册。

## 1. 已确定的产品约定与设计边界

用户已确定：独立团队插件复用原生创建与现有 thread-list；人工创建时附带客户端选择的身份；受信团队自选身份；首个完成初始化者为唯一管理员，管理员只负责创建后续成员；成员可修改自己的姓名和预设头像；memberId 固定；Agent 能查询团队工作进展且控制上下文占用。团队插件计划独立发布为 `hxy91819/bb-team`，本阶段不创建仓库、不生成头像、不实现产品代码。

**“归属成员”不是“真实创建者”或“实际操作者”。** 线程保存固定 memberId；显示时连接成员当前资料。人工新建与人工 fork 取本次提交快照，Agent 子线程可以由插件继承 parentThreadId 的归属。没有上下文且没有可继承关系的线程保留未归属。既有线程不凭标题、机器、模型或插件 origin 猜身份。活动报告统一称“归属该成员的 BB 工作进展”，不作考勤或人工操作审计。

本体负责收集上下文、校验、调用贡献者、原子保存、通用查询和列表贡献宿主。插件负责成员、继承策略、标签内容、分组定义和查询解释口径。不开辟账号认证、密码、邮箱注册、通用权限系统、任意请求中间件或独立 AI 服务。

## 2. 源码事实与落点

以下是当前行为，不是拟新增能力。链接相对本设计文件；符号是阅读入口。

| 事实 | 仓库证据及影响 |
| --- | --- |
| create/fork 的 pluginMetadata 只接受 origin=plugin，并要求 originPluginId | [threads.ts](../packages/server-contract/src/api/threads.ts)：`createThreadRequestSchema`、`forkThreadRequestSchema`。保留原有校验；不能借改 origin 表示团队身份。 |
| 浏览器和后端插件 SDK 自动补插件归因 | [plugin-bound-sdk.ts](../apps/app/src/lib/plugin-bound-sdk.ts)、[plugin-api.ts](../apps/server/src/services/plugins/plugin-api.ts)：`withPluginThreadAttribution` 调用；[app-contract.ts](../packages/plugin-sdk/src/app-contract.ts)：`PluginBoundThreadsArea`、`NewThreadRequest`。 |
| 根编辑器与插件编辑器复用同一提交实现 | [RootComposeView.tsx](../apps/app/src/views/RootComposeView.tsx)：`handleSubmit`；[NewThreadComposer.tsx](../apps/app/src/components/promptbox/NewThreadComposer.tsx)：`submitDraft`；[PluginNewThreadComposer.tsx](../apps/app/src/components/plugin/PluginNewThreadComposer.tsx)：`handleSubmit`。插件组件只回调请求，插件仍决定 filing/attribution。 |
| 创建服务已经集中，fork 是适配器 | [base.ts](../apps/server/src/routes/threads/base.ts)：create/fork routes；[thread-fork.ts](../apps/server/src/services/threads/thread-fork.ts)：`createThreadForkFromRequest` → [thread-create.ts](../apps/server/src/services/threads/thread-create.ts)：`createThreadFromRequest` → `createPendingThreadAndAttemptFirstDispatch`。 |
| thread row 与一个 namespace 的初始 metadata 已经原子写入 | [thread-create-helpers.ts](../apps/server/src/services/threads/thread-create-helpers.ts)：`createThreadRecord` → [threads.ts](../packages/db/src/data/threads.ts)：`createThread`，immediate transaction 内调用 `insertThreadPluginMetadata`；通知在事务之后。扩展内部输入为多个 namespace 即可。 |
| metadata 是现成独立表，不需要成员列 | [schema.ts](../packages/db/src/schema.ts)：`threadPluginMetadata`，主键 `(threadId, pluginId)`，删除线程 cascade；[thread-plugin-metadata.ts](../packages/db/src/data/thread-plugin-metadata.ts)：定向批读、插入、patch。 |
| 插件已有独立 SQLite、迁移、RPC、实时通知 | [backend-contract.ts](../packages/plugin-sdk/src/backend-contract.ts)：`PluginStorage.database/migrate`、RPC、realtime；数据库 handle 按加载代际管理，WAL、busy_timeout 5000，迁移 append-only。 |
| thread-list 是 bundled 插件，没有另一份 core 内置完整列表 | [app.tsx](../plugins/thread-list/app.tsx)：`experimental_threadList`；[api_to_audit.md](api_to_audit.md)：同名条目；[preferences.ts](../plugins/thread-list/shared/preferences.ts)：project/chronological/machine 三种组织模式。 |
| 树、环境聚合、排序、拖拽和触摸已有实现 | [project-thread-groups.ts](../plugins/thread-list/app/model/project-thread-groups.ts)、[machine-thread-groups.ts](../plugins/thread-list/app/model/machine-thread-groups.ts)、[ProjectList.tsx](../plugins/thread-list/app/list/ProjectList.tsx)、[useSectionThreadDnd.ts](../plugins/thread-list/app/dnd/useSectionThreadDnd.ts)、[sidebarTouchSensor.ts](../plugins/thread-list/app/dnd/sidebarTouchSensor.ts)、[ThreadRow.tsx](../plugins/thread-list/app/rows/ThreadRow.tsx)。贡献者不重建这些行为。 |
| 现有元数据列表只接受已知 threadIds；线程列表没有 metadata/member/date 活动过滤 | [threads.ts](../packages/server-contract/src/api/threads.ts)：`pluginThreadMetadataListRequestSchema`、`threadListQuerySchema`、`threadEventsQuerySchema`；事件查询只有单线程 sequence/types/order/limit。不能靠现有 list API 高效完成成员跨线程日期查询。 |
| 事件带时间和线程内序号，但会被剪裁/改写 | [schema.ts](../packages/db/src/schema.ts)：`events`；[events.ts](../packages/db/src/data/events.ts)：`listStoredEventRows`；[event-rewrite-generation.ts](../packages/db/src/data/event-rewrite-generation.ts)、[event-output-truncation.ts](../packages/db/src/data/event-output-truncation.ts)。只能证明保留的证据。 |
| fork 会复制来源的历史事件，保留原 createdAt | [thread-fork-history.ts](../apps/server/src/services/threads/thread-fork-history.ts)：copyForkSourceHistory/selectInheritedForkEventRows；[events.ts](../packages/db/src/data/events.ts)：copyStoredThreadEventsInTransaction。活动统计必须排除继承片段，否则会把 A 的历史重复算到新归属 B。 |

## 3. 推荐创建接口

### 3.1 最小形状

以下名称均为**拟新增**；所有新增 public member、导出类型与 wire 字段以 `experimental_` 起名。复用现有 JsonValue/JsonObject、Standard Schema、ThreadCreateOrigin、ThreadOriginKind 等术语与型别，不另造“团队创建请求”。

| 接口 | 精确职责 |
| --- | --- |
| `app.experimental_threadCreationContext.register({ capture })` | 每插件、每前端加载代际一个贡献者，host 绑定 pluginId；`capture()` **同步**返回 `JsonValue \| undefined`，只读取本客户端选择。返回 disposer，卸载也自动注销。同步快照避免跨 await 后身份漂移。 |
| create/fork/`NewThreadRequest.experimental_pluginContext?: Record<pluginId, JsonValue>` | 只承载提交快照，与 origin 完全独立；省略规范化为 `{}`。可显式传空对象，表示已经收集且没有贡献。普通 SDK/CLI 不推断浏览器身份。 |
| `bb.experimental_threadCreationContext.register({ input, prepare })` | 每插件一个后端处理器；input 为验证该插件上下文的 Standard Schema。`prepare` 收到 typed `context`（有/无的判别联合）、规范化创建描述、自己的 legacy seed、自己的 parent/source metadata、AbortSignal；异步返回 `JsonObject \| null`，只产生本插件初始 metadata。 |

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

| 入口 | 源码路径/适配点 | 上下文及团队规则 |
| --- | --- | --- |
| 根创建页面 | RootComposeView → NewThreadComposer → useCreateThread → sdk.threads.spawn | 提交采集当前成员。 |
| 侧栏按钮、快捷键、命令面板 | [SidebarNavigationModel.tsx](../apps/app/src/components/sidebar/SidebarNavigationModel.tsx) 的 new-thread action；[AppLayout.tsx](../apps/app/src/components/layout/AppLayout.tsx) 的 `thread.new` → root compose | 打开入口不采集；最终提交走上行。保持项目/placement 选择逻辑。 |
| 分屏新建 | SidebarNavigationModel 的 `PLACEHOLDER_SPLIT_CONTENT`，pane 中的 root composer | 每 pane 草稿保持原行为，共用创建 helper；不得在每 pane 注册一个全局 collector。 |
| 复用 SDK NewThreadComposer 的插件 | PluginNewThreadComposer → onSubmit → 浏览器 SDK 或插件 RPC → 后端 SDK | NewThreadRequest 透传 map；旧插件 origin 仍为自身，团队 metadata 另存。插件主动丢弃字段不在“自动恢复”承诺内，Guide 要求原样转发。 |
| 插件直接浏览器 spawn/fork | plugin-bound-sdk → 通用 collector helper → 原 SDK | 无显式 map 时采集；显式 map 不补、不覆盖；origin 自动补齐规则不变。 |
| 人工 fork | [useForkThreadFromMessage.ts](../apps/app/src/hooks/useForkThreadFromMessage.ts) 实际调用 spawn(originKind=fork)，不经过 NewThreadComposer；fork endpoint 经 thread-fork 适配 | 必须单独接入 helper。归属本次成员，sourceThread 不是 parent，不自动继承来源成员。 |
| provider handoff | [ThreadDetailPromptArea.tsx](../apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx)：createHandoffThread → useCreateThread；[thread-handoff-request.ts](../packages/client-core/src/prompt/thread-handoff-request.ts)：buildThreadHandoffCreateRequest | 当前是普通新线程，prompt 提及旧线程；没有 sourceThreadId/parentThreadId。取本次选择，不伪造 fork/来源关系。 |
| Agent 子线程 | [spawn.ts](../apps/cli/src/commands/thread/spawn.ts)：--parent-self/--parent-thread；[workflows service](../plugins/workflows/src/service.ts)：SDK spawn；服务端统一 create | 有显式成员优先，否则团队 handler 继承真实 parentThreadId 的 memberId；无父归属则未归属。CLI origin=cli 不是人工/Agent 的可靠鉴别。 |
| Agent fork | SDK fork、[CLI fork](../apps/cli/src/commands/thread/fork.ts)、[side-chat](../plugins/side-chat/server.ts) | 现有 fork 使用 source 关系；本期没有 context 就未归属，不能偷当 parent 继承。seed-only fork 的 startedOnBehalfOf 表示 Agent 也不改变此约定。 |
| CLI/SDK 明确归属 | packages/sdk/src/areas/threads.ts 的 spawnJson/forkJson；CLI spawn/fork | 新增 `--experimental-plugin-context <json>`，与 SDK 同 schema；CLI 不读浏览器选择，插件可提供 team 命令便捷构造。 |
| 自动化/旧客户端 | [automations run](../plugins/automations/src/run.ts)、任意无浏览器 backend SDK | handler 仍运行；无 map 且无真实 parent 则未归属，不能使用最近一个人的选择。 |

web/desktop 与紧凑浏览器都运行 apps/app，具有相同 collector 与插件列表能力。紧凑布局沿用抽屉、触摸行操作和导航关闭，不强加桌面分屏。**本基线原生 mobile 是 WebView 壳**：[ProfileWebViewScreen.tsx](../apps/mobile/src/screens/webview/ProfileWebViewScreen.tsx) 的 ShellWebView 加载 buildShellUrl；壳里的 Web App 因此支持同一插件 UI/创建流程。原生通知、连接设置、后台 native SDK 不运行前端注册者，按无浏览器请求处理；不新增 native bridge/daemon wire，不声称独立 React Native slot 已存在。

## 4. 可组合的列表贡献

### 4.1 归属公共 SDK，现有 thread-list 消费

选择公共 frontend SDK 的注册/消费契约，**不是** bb-team 与 bundled thread-list 私下 import/RPC 的插件间协议。原因是列表的运行时注册和跨插件卸载由宿主管理，替代列表也能选择消费同样贡献；独立仓库不依赖 bundled 插件源码版本。thread-list 仍拥有布局、preferences、排序和移动实现。

拟新增 `app.slots.experimental_threadListGrouping`、`app.slots.experimental_threadRowDecoration`，及列表消费者 `experimental_useThreadListContributions`。注册形状为 `{ id, title, getSnapshot, subscribe }`：getSnapshot 同步返回不可变、引用稳定的描述，subscribe 返回 disposer；插件通过现有 RPC/realtime 在共享 cache 更新后通知。注册表负责 pluginId 前缀、代际注销和单贡献者异常隔离。渲染回调不发请求；按当前列表 threadIds 批量读 metadata，沿用 `experimental_listPluginMetadata` 的 200 IDs 批次上限，缓存按 namespace/ID 去重，新增或失效的 ID 才补读，不逐行 RPC。注册时可声明所需 metadata namespace 为自己的 pluginId，宿主消费 hook 统一批读并提供给投影函数，未加载状态显式标识，不把加载中误当未归属。

分组 snapshot 含稳定 group key、显示名、可选头像描述及同步 `groupForRoot(thread, ownMetadata)`；返回 key 或 null。行 snapshot 含 `decorate(thread, ownMetadata)`，返回 `{ text, accessibleLabel, avatar: { src, alt } | null } | null`，注册声明 `placement: "leading" | "trailing"`，默认 trailing。src 使用插件随包同源资产 URL；宿主提供一行有界标签、头像尺寸、主题和无障碍渲染，不接收任意整行 React 替换。内建 provider icon 提取为 leading decoration 适配器，也由同一消费路径渲染；线程活动状态、标题与动作仍由原有专门控件负责。每个位置的贡献按完整 `<pluginId>/<id>` 排序全部组合，单项失败只移除该项，不能影响标题、状态图标、点击区域和动作菜单。

最小分组组合语义：多个插件可以注册多个可选组织提供者；用户**一次选择一个主组织模式**，它与 pinned、现有父子树、环境聚合、read-status 分层组合。第一版不做任意多维 group-by 管线。内建 project/machine/chronological 也改用同一分组描述消费路径，不能仅为 team 在 ProjectList 加 if 分支。内建原有默认排序和 section 规则保留在各自适配器与共享树构造器中。

### 4.2 树、排序、拖拽与 preferences

| 行为 | 推荐契约 |
| --- | --- |
| 组织选择 | 现有 organizationMode 接受三旧值及插件 `<pluginId>/<id>`；现有 thread-list RPC/CLI preferences 路径读写，新值有校验。默认仍 chronological，安装团队插件不自动改偏好。 |
| group key | 宿主编码 `(pluginId, registrationId, groupKey)`，不拼接未经转义的分隔符；姓名更改不换 key，团队使用 memberId。 |
| 嵌套 | 先建立 parent 树，以每棵根的 group 放置整树，子线程保留实际自身标签；跨成员子线程不会被复制或拆散。pinned 的现有置顶投影保持。 |
| 环境聚合 | 在组内复用现有环境聚合；禁止跨成员组折叠为同一环境行。树中子节点仍服从树，不凭环境重挂父级。 |
| 排序/隐藏/折叠 | 复用比较器、窗口化、reveal 与 group rollup；增加 namespaced group 状态的 KV preferences（顺序、折叠、隐藏），不新增核心表。不覆盖既有 project/section/machine 偏好。 |
| 拖拽/移动 | 现有 thread/section 重排、nest、移入分屏、触摸传感器沿用。派生的成员组标题是只读 drop target；跨成员组拖拽不暗改 memberId，也不吞掉原有 move 菜单。组内原先可重排的位置继续按既有 sortKey/父子变更工作；不支持的位置显示与原模式一致的拒绝反馈。 |
| 停用/重载 | 所选提供者缺席时临时回退 chronological，保存原选择和折叠数据，恢复后重用；其行标签消失，原列表仍可用。贡献失败隔离为缺席，不隐藏整个列表。 |

不选整列表替换：会复制拖拽/移动维护成本；不选 DOM 拦截：无法保证生命周期与可访问性；不选插件间私有协议：外部安装者无法获得稳定版本边界。

## 5. bb-team 插件实施契约

### 5.1 数据和身份操作

使用 `bb.storage.database()` 的插件本地 SQLite；插件自己 append-only migrate，不读取 bb.db 路径、不导入 @bb/db 或 server 内部模块。最小表：

- `members(member_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`；ID 由服务端生成，永不复用，显示名允许同名。
- `team(singleton INTEGER PRIMARY KEY CHECK(singleton=1), admin_member_id TEXT NOT NULL REFERENCES members(member_id), timezone TEXT NOT NULL)`。一个团队对应一个 BB server 的插件实例。

`initialize({displayName,avatarId,timezone})` 用同步 immediate transaction：检查 singleton → 插入首成员 → 插入唯一 team 行。两个并发初始化仅先 commit 者成功；失败方收到 `already_initialized` 和选择现有身份的入口，不自动再建成员，不产生孤儿行。不另存 isAdmin 多份状态。团队 IANA timezone 初始化必填并验证；本期不做时区更改，避免同一日期报告口径漂移。

RPC/CLI/SDK 共享插件 service：`initialize`、`members.resolve/list/get`、`members.create`、`members.updateSelf`、`identity.validate`、`activity.query/details`。管理员 create 以显式 `actorMemberId` 与 singleton 比较；普通成员只能在自选身份口径下修改自己资料，不能创建新身份。该检查是受信团队协作规则，不是登录鉴权，持有 BB 会话者能自述另一个 ID。displayName trim 后 1–80 字符，avatarId 必须命中随包清单；本期不增加成员删除、合并、转让管理员或改归属操作。

客户端每个窗口保存当前 memberId，按 BB server/profile 分区；复用 [browser-storage.ts](../apps/app/src/lib/browser-storage.ts) 的 tab-scoped 存储思路。首次窗口选择已有成员，刷新恢复并向服务端验证；另一窗口更换身份不覆盖本窗口。关闭窗口后的跨会话选择恢复属于存储能力允许的范围，不能以服务端全局 KV 当作当前用户。CLI `bb team identity select/show/clear` 使用调用端本地配置、按 server 分区；SDK 明确传 memberId。浏览器选择不偷偷同步成 CLI 身份。

界面用已有 navPanel/settings/sidebar footer 能力提供初始化、选择、修改、管理员创建；保留原生 New Thread。预设生成头像随包发布，清单存固定 avatarId → asset URL，UI 显示和 CLI 列举同一清单。本阶段不生成资产。更新资料 commit 后发布 `members.changed`，所有窗口重新定向读取成员；重连重新查询，不能依赖一次性 signal。历史线程 metadata 只存 `{memberId}`，不复制姓名/头像。

团队 prepare：显式有效 memberId 优先；没有 context 时仅继承真实 parent 的 memberId；都没有返回 null。显式不存在成员失败，不能落成未归属。成员不删除保证 prepare 后 core commit 之间 ID 仍有效，姓名变化不影响 ID 快照。停用保留插件 DB 与 metadata；再次启用重新读取。卸载清数据属于另一次显式操作，本期不附带执行。

### 5.2 Agent 活动查询：事实层与上下文预算

创建上下文足以关联线程归属；**不足以识别每条消息的人工操作者**。现有事件有 turn、Agent/tool 输出与部分 initiator 信息，没有可信团队 memberId 的逐消息身份记录。第一版不为发送/编辑/重试每条消息附加 team context：这将增加所有输入链、历史兼容和审计语义成本，仍不能把自选身份变成认证身份。留待明确的下一版需求。

查询步骤：按 memberId 或名称解析 → 明确日期/时区 → 在服务器过滤归属和时间内事件 → 返回紧凑可引用事实 → 当前 Agent 解释总结。名称精确匹配仍可能同名；零结果明确 not_found，多结果返回有界候选 ID/显示名供用户选择，模糊搜索也不能自行选第一个。更名后历史归属仍由 ID 连接；旧名称不作为隐藏别名自动认领。

建议命令：`bb team activity --member <id-or-name> --date YYYY-MM-DD [--project <id>] [--limit N] [--max-chars N] [--cursor C] --json`；详情 `bb team activity details --thread <id> --date YYYY-MM-DD ...`。`today` 由服务端按 team.timezone 与请求开始时的 now 解析，响应回显 date/timezone/from/to/asOf。区间 `[当地当天00:00,次日00:00)` 转 UTC，不能简单加 24 小时（DST）。事件记录时间使用核心 events.createdAt，不是自然语言中声称的时间。

默认 20 个线程、完整序列化响应最多 8000 Unicode 字符；上限 100/24000。详情默认 20 个证据、8000 字符；姓名解析默认 10 个候选。预算含 envelope、cursor、标题和错误，不只是正文；不足以装入下一项时在该项之前结束，并提供 nextCursor。单项过长裁剪 excerpt 且标明 `excerptTruncated`，下一页不因长项永远停住。输出始终含 `totalThreads/totalEvidence`（对应模式的总数）、`returned`、`nextCursor`、`truncated`、`coverage`。CLI 文本与 JSON 同预算；不自动递归翻完所有页，不常驻注入完整成员名单。

事实投影以 [provider-event.ts](../packages/domain/src/provider-event.ts) 的真实事件为依据：已接受输入 `turn/input/accepted`、完成回合 `turn/completed` 的成功/失败状态、`item/completed` 中 Agent 回复/命令执行/fileChange/toolCall 的有界摘要。请求/排队不等于执行，tool 调用不等于成功，Agent 说“已完成”仅标记为 Agent 陈述；可验证命令结果单独标记。默认跳过思考文本、delta、全量工具输出和 diff。标题只作定位；updatedAt/createdAt 不算进展证据。每条证据含 threadId、eventId、sequence、事件时间、种类与状态；展示真实 thread 路由并保留 event 定位键，不编造尚不存在的事件锚点 URL。

### 5.3 必须新增的通用查询能力

现有单线程 events/list 与 metadata 批读不足以在服务器先筛成员和日期；全线程 list 后 JS 过滤和插件私读本体 DB 都不接受。唯一推荐是新增核心只读 `sdk.threads.experimental_activity`（插件绑定 SDK 默认自己的 pluginId）及 `bb thread experimental-activity`，由 team RPC/CLI 共享 service 调用；不做插件增量日志副本。

请求是判别联合：

- `mode: "summary"`：`metadata: {pluginId, key, equals}`，key 只允许单个顶层键，equals 只允许 JSON scalar；`from/to` 为 UTC ms，`projectId` 可缺省，`limit/maxChars/cursor`。
- `mode: "details"`：同样 metadata/date 约束加一个 `threadId`，按事件稳定键分页返回证据投影。团队总是使用 `{pluginId: 自身, key: "memberId", equals: 固定ID}`；详情不能绕过归属筛选。

JSON key 经参数化路径处理，无任意 SQL/JSONPath。复用元数据 schema 与公共线程访问过滤，默认包括归属的 archived/hidden 工作线程、排除 deleted 线程，响应明确口径。这不扩大现有 BB 身份权限。summary SQL 用 metadata → threads → events 定向 JOIN/WHERE，事件时间 `>=from AND <to`，限定可报告事件种类，COUNT/GROUP BY 在 DB 内完成；所有符合条件的旧线程都可被选到。details 也在 DB 限定 threadId、日期、类型，才提取有界 payload；不把所有历史拉进插件内存。SQL 先 LIMIT 候选并用 json_extract/substr 提取有限字段，完整 data 不进入摘要缓存；COUNT 与有界投影共享同一过滤条件。

分页采用**服务端短期只读结果快照**：第一页在一个同步读事务内确定有序摘要或证据投影、精确总数与 asOf；缓存只含有界投影，不缓存原始日志。每份至多 10000 项，5 分钟 TTL，进程内总上限 32 MiB、LRU 淘汰；超过项上限返回 `truncated=true` 和可枚举范围限制，要求缩短日期/项目，不能把可翻完前 10000 项说成全量。cursor 为不透明随机 snapshotId 加位置，绑定标准化查询参数与调用访问域；重用不同过滤参数拒绝。固定排序 summary=`lastActivityAt DESC, threadId ASC`，details=`createdAt ASC, sequence ASC, eventId ASC`。页内按字符预算取完整项，游标推进到下一项。新事件或更名不改变已生成页；新查询可见新数据。TTL/重启/淘汰返回 `activity_cursor_expired`，调用者重查第一页，不能暗自重复旧页。

删除、改写与剪裁：每次返回页前校验该页证据仍可访问且 eventId/线程 rewrite generation、当前归属过滤未变；变更返回 `activity_snapshot_invalidated` 要求重查，不把删掉的资料从缓存继续输出。插件成员姓名仅是当前显示，不进入核心 snapshot 的成员事实；插件可在整个查询会话固定回显 memberId 和首次解析名，并注明新查询刷新姓名。这是稳定分页承诺，不是跨重启永久历史快照。摘要快照须记录相关线程的 rewrite generation 并验证引用事件仍存在；只检查 threadId 存在不足以发现证据被裁剪。

核心模型只需现有 threads/thread_plugin_metadata/events，不增加团队表、操作者列或 daemon wire。查询计划落地时新增两个与查询直接相关的通用索引：metadata `(plugin_id, thread_id)` 和 events `(thread_id, created_at, sequence)`，已有 metadata 主键和 event sequence/type 索引不能替代此范围访问。通过 Drizzle schema 生成迁移与 snapshot，不手写 snapshot；以 EXPLAIN 与有旧线程的大数据集验证。若实测现有索引已满足同等计划，可省对应索引，不能为了“零迁移”接受全库读取。此为新增活动需求带来的索引迁移，创建上下文本身无需核心表迁移。

core 内部提取共享 `listActivityEvidence` 定向读取/投影模块，summary/details、现有单线程事件 route 可共用底层范围条件构造，避免团队专用 SQL；现有 events API 的原始事件响应契约不改变。落点：server-contract threads、SDK threads、server threads route/service、DB data/events 与 metadata 查询、CLI thread 命令。公开 SDK 符号在 Plugin Guide 登记。

fork 的复制历史不是该 fork 新做的工作。现有复制不带统一来源字段，但 `INHERITED_EVENT_TYPES` 不复制 thread/identity；第一版对 originKind=fork 的活动证据保守限制为本线程首次 `thread/identity` 之后的 sequence（[thread-lifecycle.ts](../apps/server/src/services/threads/thread-lifecycle.ts) 负责写 identity）。没有本地 identity 或边界已被清理时标记 coverage 不完整，不把前缀按 createdAt 归给新成员；普通线程不施加该过滤。验收覆盖同日 fork、多级 fork 和来源已删除场景。以后若要精确报告启动前请求，需要另增持久化来源边界，不凭 providerThreadId=null 或时间戳猜测。

不建插件增量索引的理由：thread.created 信号不是可回放日志，停用期间会漏，补偿仍需核心定向查询；还要处理改写、删除和双库一致性。本方案停启后直接查询现存 metadata/events，不必回放全库。历史未归属线程、停用时创建的无归属线程不能倒推成员；已归属线程停用期间的活动重新启用后仍可查。剪裁/删除的证据不恢复，`coverage` 明确“当前保留事件”，已知缺口显示 incomplete/原因；未发现缺口也不宣称历史完整。

### 5.4 Skill 发现与 provider 支持边界

仅打包一个 `skills/team-activity/SKILL.md`。建议短 description：`查询成员归属的 BB 工作进展、日期活动与线程证据；使用 bb team activity。` 正文按需教 Agent 解析歧义、日期、预算和证据，完整正文目标不超过 1500 字符，详细参数留 CLI help。不注册 native tool 集合，不向 agent instructions 注入名单、历史或正文。命令经 `bb.cli` 注册，SDK/RPC/CLI 调用同一 query service。

| 实际链路 | 已核对能力与边界 |
| --- | --- |
| server skill catalog → host staging | [injected-skills.ts](../apps/server/src/services/skills/injected-skills.ts)：discoverPluginSkillIds/resolveSkillCatalogEntries；[host injected-skills](../apps/host-daemon/src/injected-skills.ts)：stageInjectedSkillSources，按 treeHash staging。已有 skill transport 可复用，无新 daemon wire。catalog 的 name/description/path 有常驻上下文成本，不能称免费。 |
| Codex | [bridge.ts](../plugins/provider-codex/src/bridge/bridge.ts)：skills/configure → skills/extraRoots/set，交给 provider 原生发现。代码证明 roots 传递，不证明每个外部版本实际 token 数；验收捕获请求验证未注入完整正文。 |
| Claude Code | [session-params.ts](../plugins/provider-claude-code/src/session-params.ts)：buildClaudeSkillConfigParams 把 roots 配成 local plugins；使用原生 skill 加载路径，实际正文触发以支持版本运行验证。 |
| Pi | [bridge.ts](../plugins/provider-pi/src/bridge/bridge.ts)：skills/configure；[rpc-session.ts](../plugins/provider-pi/src/bridge/rpc-session.ts)：--skill；[turn-input.ts](../plugins/provider-pi/src/bridge/turn-input.ts)：显式选择转 /skill。必须验证自动发现与显式选择两条路，不能只凭命令转换声称自动命中。 |
| ACP | [session-params.ts](../packages/provider-bridge-acp/src/session-params.ts)：buildAcpSkillsInstructions 实际将每个 name/description/绝对路径写入 instructions，要求匹配时读取 SKILL.md。这是文本目录而非原生 lazy registry；正文按需读取依赖目标 agent 的文件读取和 shell/CLI 能力。 |
| 不支持 skill roots/文件或 shell 的 provider | [runtime-provider-process.ts](../packages/agent-runtime/src/runtime-provider-process.ts) 与 [bridge-protocol-adapter.ts](../packages/agent-runtime/src/bridge-protocol-adapter.ts) 只提供配置传递；bridge-protocol-adapter 在 `handshake.skills.configure` 未声明时返回 noop，不能赋予目标执行能力。最小替代为用户显式附加短查询指令/命令输出，或使用已支持 CLI 的 provider；不为此常驻新增一串 tools。 |

[plugin-commands-skill.ts](../apps/server/src/services/plugins/plugin-commands-skill.ts) 已生成命令发现 skill；其短 catalog 条目也占上下文。团队 skill 专注自然语言触发，不把同一完整说明重复写进自动生成发现正文。启停后新会话/下一次配置刷新移除或加入发现条目；已经进入旧会话上下文的文字不能撤回，命令必须明确返回插件不可用，而不是使用旧资料。运行验收报告 provider/版本与实际发现成本，不承诺所有第三方 ACP agent 同等能力。

## 6. 版本、实施切分与文档归属

先交付 BB 通用能力，再交付独立 bb-team；设计不是可以安装的插件。BB 实现需同步 [app-contract.ts](../packages/plugin-sdk/src/app-contract.ts)、[backend-contract.ts](../packages/plugin-sdk/src/backend-contract.ts)、对应导出/宿主绑定与测试 harness；[surfaces.ts](../plugins/plugin-api-docs/src/surfaces.ts) 的创建、列表和活动能力卡及符号清单；[api_to_audit.md](api_to_audit.md) 记录稳定条件和原生调用者。CLI 新旗标/命令同步 [cli-guide-and-skill.md](cli-guide-and-skill.md) 指定发现面。本文不替代这些交付。

团队包声明 `engines.bbPluginSdk` 的实际首个支持版本下限，并固定开发依赖版本、锁文件；`engines.bb` 同时指明已验证 BB 版本。当前 [sdk-compat.ts](../apps/server/src/services/plugins/sdk-compat.ts) 在同 major 会按 floor 接受较新版本，不能只凭严格上界保证 ABI；插件启动时同时检查需要的 experimental 方法，缺失则显示不兼容并不注册半套创建/列表功能。当前稳定版尚不包含拟新增接口，不能声称 desktop-v0.46.0 原版可用。具体首发版本号由实现提交决定，不虚构未来版本。

发布插件 semver tag 与编译产物，建议安装固定 tag `git:https://github.com/hxy91819/bb-team.git@vX.Y.Z`（示意，发布时替换实际版本），升级不移动旧 tag；构建使用公开 plugin SDK，不导入 bundled thread-list/@bb 内部路径。头像及清单随包，SQLite 数据目录不打包。安装/禁用、数据保留、WebView 边界、CLI 身份与活动口径写入插件自身 README/skill；API 接口说明只维护 Plugin Guide。

下一阶段可闭合为三项：A 创建链/多 namespace 原子写入及原生入口支持表；B 列表注册消费与原生三模式回归；C 通用活动查询和公共 SDK/CLI。每项同时交 Guide、audit、行为测试，均在 BB 分支；然后独立 bb-team 实现成员、头像、身份、标签/分组、短 skill 和有界查询。最后两仓库联合验收安装、版本拒绝与启停，审查后分别提交/push。本阶段不执行这些实现任务。

## 7. 行为验收表

以下为下一阶段必须执行的行为测试，不是本阶段已通过。相同创建表驱动覆盖所有支持入口；DB 测试用真实内存连接与 migrate，不 mock 数据库。UI 在 web/desktop/紧凑浏览器及原生 WebView 选择代表旅程；新增紧凑抽屉按项目规则验证 iOS Safari、app-root 和延迟实现行为。

| ID | 设置与动作 | 可观察结果 / 测试边界 |
| --- | --- | --- |
| C01 | A 成员在每个支持入口人工创建，提交前由 B 切回 A | metadata memberId=A；origin 保持原入口，原生 SDK/服务路由表驱动。 |
| C02 | 打开页面选 A，发送时选 B；prepare 等待时再选 A | 本次 B、下一次 A；同步 collector/UI 集成。 |
| C03 | 两窗口分别 A/B，同时提交同项目 | 各自 metadata 正确，无全局选择串扰；两个独立客户端。 |
| C04 | 两插件同时贡献，包含插件来源 legacy seed | 两 namespace 与线程同时出现；seed 未重叠键保留，originPluginId 不变。 |
| C05 | 同 namespace seed 重叠、非法 JSON、无效成员、超限 | 明确错误且无线程；直接 SDK/HTTP 也受校验。 |
| C06 | collector 抛错或后端 prepare 超时/失败 | 原草稿、附件、mention 可恢复，提交后的新输入不被覆盖；没有部分 metadata。 |
| C07 | 第二 namespace insert 故障 | 同事务线程和首 namespace 都不存在；真实 DB rollback。 |
| C08 | prepare 期间停用/重载，旧 Promise 迟到 | 本次失败且无迟到写入，下一次不带已停用 context 的创建成功。 |
| C09 | 停用后新建；再次启用 | 原生流程可用，既有成员/metadata 保留，无重复注册。 |
| C10 | 已提交后 dispatch 失败、延迟发送、provider retry | 遵循现有 soft-delete/queue 语义；不重跑归属、不因重试身份变化。 |
| C11 | 网络响应丢失后调用方重试 | 不自动重发；显式重试的重复可能公开说明，复用请求 map 不改变成员。 |
| C12 | A 父线程的无 context Agent child；A 来源人工 fork 选 B | child=A，fork=B，fork 没有被误挂 parent；source/parent DB 核对。 |
| C13 | Agent fork 无 context、无父自动化、旧客户端 | 无归属；有 parent 的自动化按插件继承；core 不复制其他插件 metadata。 |
| C14 | provider handoff 与分屏新建 | 本次成员、草稿恢复正确；handoff 保持现有普通新线程关系。 |
| C15 | 旧 pluginMetadata API、无插件、插件直调/RPC 转发 | 既有成功/错误契约不变；新 helper 恰好采集一次，不污染 sendMessage/pluginSubmission。 |
| M01 | 两个初始化事务竞争，包括首事务回滚 | 恰好一 admin、无孤儿成员；失败者可选择已创建身份；回滚者不占管理员。 |
| M02 | 普通成员创建后续成员、管理员创建、修改他人 | 普通成员创建拒绝；admin 创建成功；updateSelf 只更新请求选择身份，说明自选身份不等于认证。 |
| M03 | 历史线程 A，A 改名/头像；两个客户端在线与断线重连 | thread metadata 不改，所有旧线程与分组显示新资料；ID/key 不变。 |
| M04 | 初始化无效 timezone、非清单 avatar；客户端记住无效 ID | 边界拒绝、提示重选，不悄悄生成成员。 |
| L01 | 同时启用两分组/三标签提供者 | 组织选择均可发现，标签组合顺序稳定，原状态/标题/行操作保留。 |
| L02 | A 根下面 B 子线程，同环境另有 B 根 | 树不拆不复制；标签真实；环境不跨根组聚合。 |
| L03 | 切组织、改名、隐藏/折叠、刷新、多客户端 preference 更新 | namespace 不冲突，组 key 稳定；沿用 thread-list RPC/CLI 同步。 |
| L04 | 鼠标/触摸拖拽、nest、pin、move、拖入分屏 | 原行为/禁用条件一致；跨成员组不隐式改归属；紧凑导航关闭正常。 |
| L05 | 提供者停用、crash、重载 | 列表回退可操作，其他贡献继续；恢复原选择，无悬挂监听。 |
| L06 | 未装 team 时三种内建模式，排序/未读/section/窗口化 | 原 baseline 行为不回归；内建与插件使用相同消费边界测试表。 |
| Q01 | 小A 当天有 accepted input、命令成功、Agent 陈述；小B 无活动 | A 返回对应证据且区分陈述/结果；B 返回 0 和覆盖口径，不说 B 没工作。 |
| Q02 | 昨天创建的 A 线程今天继续，今天只 rename 的线程 | 旧线程被纳入；只改标题不算工作证据；不能用 createdAt/updatedAt 筛进展。 |
| Q03 | UTC 边界、团队本地零点、DST 的 23/25 小时日 | 半开区间，无相邻日期重复/漏事件；响应回显 UTC 范围与 IANA timezone。 |
| Q04 | 同名小A、模糊匹配、改名后按固定 ID 查 | 歧义返回有界候选，不能任取一个；改名不丢历史关系。 |
| Q05 | 多页、单项超长、完整输出预算、10000 项以上 | 总数/截断/cursor 可见；不超过预算、不卡长项；超快照上限要求缩小范围。 |
| Q06 | 翻页时新增事件、更名、过期/重启、删除或 event rewrite | 快照不重复跳项；新查询见新事件；失效返回明确码而非混用数据。 |
| Q07 | 摘要选择 threadId 请求详情、伪造不属该成员 ID | 前者仅返回当日有界证据和真实定位键，后者无越过过滤结果；无整日志/diff。 |
| Q08 | 插件停用期间旧归属线程继续、期间新建无归属线程 | 重启查到旧归属线程期间活动；新线程不倒推成员；无事件副本回放。 |
| Q09 | 剪裁、缺失工具结果、只有 Agent 宣称成功 | coverage/证据级别真实，不能补造结果或声称人工操作已知。 |
| Q10 | 每个受支持 provider 新会话只问无关问题，再问活动 | 首回合仅短发现项及宿主必要目录开销；按需读取 skill，再 CLI；无常驻工具集合/名单/历史。 |
| Q11 | ACP 目标无文件读取或 shell；插件停用后旧会话查询 | 明确能力不可用及最小替代，不自动注入完整资料或增加 AI 服务。 |
| Q13 | A 今天有完成事件，B 今天 fork，随后自己继续；多级 fork | B 只统计 fork 自身 identity 后的工作，来源事件不重复计入；边界缺失显式 incomplete。 |
| Q12 | 大量其他成员/年份事件，按 A/一天/项目查询 | SQL 定向过滤/聚合，EXPLAIN 使用目标索引；插件无全库 list/filter 和内部 DB 依赖。 |
| V01 | 老 BB/缺 experimental 方法、匹配版本、禁用再安装 | 不兼容有清楚提示；兼容版可安装；停用保数据，原生列表/创建可用。 |
| V02 | SDK、CLI、RPC 分别操作成员与查询同一数据 | 共享 service 相同校验/预算/结果；CLI 身份不污染浏览器。 |

## 8. 我自行引入的决定

| 决定 | 原因 | 影响 |
| --- | --- | --- |
| 同步 capture、异步 prepare，collector 每插件一个 | 明确提交瞬间身份并避免多 pane 重复注册 | 插件先加载身份资料；提交快照不受之后选择影响。 |
| 冲突键拒绝、显式 context 对已停用插件报错 | 避免按加载顺序悄悄改归属 | 已有无 context 调用不变；旧请求须重新提交才能移除失效贡献。 |
| 无身份允许未归属，Agent fork 不从 source 继承 | 保留原生可用性，守住 parent/source 区分 | 人工未选择时不会被强制创建身份；以后扩展继承策略须插件明确实现。 |
| 不增加创建幂等账本；不自动重发未知结果 | 现有创建无幂等契约，避免扩大本阶段接口与数据模型 | 显式重试可能重复，验收必须披露；不宣称 exactly-once。 |
| 公共 SDK 注册列表贡献，一次一个主组织模式，成员组只读 | 复用现有交互，避免变成多维列表/归属编辑器 | 多插件共存、标签组合；不提供跨组拖动改成员。 |
| team 实例按 server、窗口独立身份、timezone 初始化必填 | 避免多人窗口串扰和日期歧义 | 无多团队/管理员转让/时区变更；CLI 单独选择。 |
| 顶层 scalar metadata 过滤加通用 activity 查询，短期快照分页 | 现有 SDK 缺口真实，稳定分页需要固定结果 | BB 增加只读查询与两项查询索引；不增加团队核心表或事件副本。 |
| 活动预算、快照容量/TTL 与短 skill 限额 | 给下一阶段可测试的上下文/资源边界 | 见第 5 节具体限额；超量必须可见，不能自动拉完。 |
| 不追踪逐消息操作者 | 自选身份不能证明实际人，创建上下文只用于归属 | 查询报告工作进展，不做审计/考勤；额外消息上下文留下一版。 |

## 9. 冲突、待裁决与本阶段验证

- 现有创建代码写着“creation is unhooked”，指当前只在 dispatch admission hook 决策；本设计增加的是 metadata preparation，不替代 admission、不改 dispatch hook。实现时需更新这些过时注释/契约说明，遵守本仓库注释规则。
- 现有 thread-list organizationMode 为封闭 enum，hiddenGroups 只认内建前缀，不能仅添加 UI 选项；preferences schema、存储解析、RPC/CLI 与测试须同步扩展。
- 当前没有通用创建 collector、初始多 namespace 输出、可加成行标签/分组注册或 activity 查询。已有 NewThreadComposer、metadata 表与 batch read 可以复用，不能把推荐当作现成能力。
- 原生 mobile 已用 WebView；handoff 不是 fork；CLI origin 也不能证明实际操作者。上述事实覆盖可能来自旧文档或直觉的相反假设。
- 原任务“避免不必要的迁移”仍成立：创建与成员不需核心表迁移；新活动范围查询推荐添加有直接查询依据的索引。没有 server/daemon wire 改动，因此不需要提升 HOST_DAEMON_PROTOCOL_VERSION；若实现改变 wire，必须另行评估并遵守版本规则。

当前没有阻塞设计交付、需要父线程裁决的问题。第 8 节为推荐实现选择，父线程可核实；如果将“创建网络重试必须恰好一次”“多维同时分组”“真实人工操作者审计”升级为硬需求，需要单独扩大范围，不能把本契约误当已经覆盖。

本阶段验证只包括直接阅读上述调用链、路径/符号复核、需求覆盖与一致性复核、`git diff --check`、新增 publish range 的内容/身份隐私检查；没有运行产品测试，也不声称第 7 节已通过。只交付本设计文件；父线程维护工作簿与分支登记。
