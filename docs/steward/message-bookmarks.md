# 会话消息书签插件：选中文字加书签，按项目分组查看，点击跳回原消息

更新：2026-10-16

## 路线

- [x] 阶段 1：核心 `feature/thread-message-navigation`，`BbNavigate.toThread` 支持 `experimental_messageSeq`（f7b53a6004）
- [x] 阶段 2：独立插件 `~/code/bb-plugin-bookmarks`（选区菜单加书签、侧栏底部与全页列表、CLI），dev 实例已验收（ecd59a4）
- [ ] 阶段 3：分支登记 `.fork/branches`，聚合打包发布，部署后在本机 BB 安装插件，补测真实 assistant 选区菜单 ← 打包中（最近线程 thr_46e4spvtt7）

## 关键决策

- 2026-10-15 跳转靠核心扩展 `toThread` 的 `experimental_messageSeq`，与命令面板会话搜索共用实现。原因：插件无路由访问，不做 hash hack。影响：阶段 1、2。
- 2026-10-15 插件做成仓库外独立本地插件，只依赖公开 SDK。原因：用户选择。影响：阶段 2、3。
- 2026-10-15 定位粒度到消息，不高亮句子；选区菜单只覆盖 assistant 回复，用户消息用整条消息按钮。原因：现有 API 能力。影响：阶段 2。

## 用户待办

| 状态 | 事项 | 为什么只能用户做 | 挡住 | 提出 |
| --- | --- | --- | --- | --- |
| 待办 | 打包完成后在 BB 外用 local-aggregate-deploy 部署新聚合版（已同意） | 重启 BB 服务须由 BB 外 Agent 执行 | 阶段 3 | 2026-10-15 |
| 已完成 | 是否为插件建 GitHub 仓库（hxy91819/bb-plugin-bookmarks）并推送 | 对外发布需用户确认 | 不挡 | 2026-10-15 |
