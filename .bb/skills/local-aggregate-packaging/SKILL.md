---
name: local-aggregate-packaging
description: 审计、重建并部署本地 local/aggregate；用于特性分支、上游更新或本机服务需要重新打包时。
---

# Local aggregate packaging

用于本仓库的本地聚合版本。它维护 `local/aggregate`，不创建上游 PR、不推送聚合分支，且不把独立 worktree 当作日常体验版本。

开始时读取 `config/local-aggregate-features.json`，并运行：

```bash
git fetch origin --prune --tags
node scripts/local-aggregate-status.mjs
```

该命令会检查：

- 当前是否位于 `local/aggregate`、是否有会阻塞打包的已跟踪修改；
- 每个登记特性的上次打包源提交与聚合提交、源分支是否新增提交或历史被改写；
- 每个特性登记的上游回馈 issue、反馈后的回复和关联 PR 是否已合并；
- 当前本地 `feature/*`、`fix/*` 分支中是否出现待登记、默认纳入的分支；
- 最新稳定版标签、其相对上次聚合基线的变化，以及自上次聚合基线以来 `origin/main` 的提交。

把结果用简体中文告知用户：分开列出特性分支变化、新发现分支、上游变化及其可能影响，以及每个回馈 issue 的维护建议。所有本地 `feature/*`、`fix/*` worktree 默认纳入聚合；新发现的分支不需要询问是否纳入。确认打包阶段后，已提交且验证通过的分支要登记并打包；尚有未提交改动或验证未完成的分支标记为未就绪，留待下一次打包，并在结果中说明。无论发现何种变化，都先询问用户选择是否同步上游、rebase 或开始打包；不要直接 rebase、重建聚合、重启服务或推送。

每个特性都必须在登记表的 `upstreamIssues` 中记录已提交的上游 issue 或补充评论。issue 关闭、关联 PR 合并或出现替代方案时，先比较其可观察行为、存储语义和验证覆盖，再建议用户保留、迁移或退役本地分支；不会仅根据状态自动删除或停止维护。

## 同步策略

默认顺序是**先独立分支，后聚合分支**。

上游更新可能影响现有特性时，推荐在各自独立 worktree 中把每个受影响的 `feature/*` 或 `fix/*` 分支 rebase 到 `origin/main`，解决产品冲突并在该 worktree 验证。随后重建聚合并重新验证。这样冲突和产品修复仍属于功能分支，聚合历史不会成为唯一的修复来源。

如果用户明确选择不 rebase，继续以当前 `local/aggregate` 基线增量打包。此时不得把新的 `origin/main` 提交写为已集成基线，最终结果必须列出尚未同步的上游提交和由此产生的维护债务。

不要把“只 rebase `local/aggregate`”当作日常同步策略；这会让功能分支长期落后，且把产品冲突困在集成层。只有用户明确要求临时集成试验时才可以这样做，并在结果中说明它没有替代源分支同步。

rebase 会改写已发布分支：在执行前说明受影响分支和新旧提交；若需要推送改写后的历史，另行取得用户对 `git push --force-with-lease` 的明确同意。缺少独立 worktree 时，先创建或恢复该分支的 worktree，不能在项目根目录 rebase 源分支。

详细执行和部署边界见 [references/workflow.md](references/workflow.md)。只有在用户确认其相应阶段后才读取并执行其中的写操作。

## 完成条件

一次完整的重新打包只有在以下条件全部满足后才完成：

1. 登记表记录了每个已纳入特性的最新源提交、聚合提交和上游回馈 issue；
2. 聚合通过与变更相称的验证，且从项目根目录构建；
3. 若用户要求更新本机服务，已按本机私有配置构建、重启并完成健康检查；
4. `AGENTS.md` 的人工概览与机器可读登记表一致。

不要输出或提交 `config/local-aggregate-web.json` 中的私有路径、地址、端口、令牌或数据。
